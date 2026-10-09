"""Infer wall mask from a floorplan image using a trained UNet checkpoint."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from buildingcv.model import build_unet
from buildingcv.rooms import extract_room_interiors_from_wall_mask
from buildingcv.vectorize import merge_wall_segments


def letterbox_rgb(img: np.ndarray, size: int = 512) -> tuple[np.ndarray, dict]:
    h, w = img.shape[:2]
    scale = min(size / h, size / w)
    nh, nw = int(round(h * scale)), int(round(w * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size, 3), 255, dtype=np.uint8)
    top = (size - nh) // 2
    left = (size - nw) // 2
    canvas[top : top + nh, left : left + nw] = resized
    meta = {"scale": scale, "top": top, "left": left, "nh": nh, "nw": nw, "oh": h, "ow": w, "size": size}
    return canvas, meta


def unletterbox_mask(mask: np.ndarray, meta: dict) -> np.ndarray:
    top, left, nh, nw = meta["top"], meta["left"], meta["nh"], meta["nw"]
    crop = mask[top : top + nh, left : left + nw]
    return cv2.resize(crop, (meta["ow"], meta["oh"]), interpolation=cv2.INTER_NEAREST)


def resolve_device(name: str) -> torch.device:
    if name == "mps" and torch.backends.mps.is_available():
        return torch.device("mps")
    if name == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_model(ckpt_path: Path, device: torch.device, encoder: str = "resnet34"):
    model = build_unet(encoder=encoder, encoder_weights=None, classes=1)
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    state = ckpt["model"] if isinstance(ckpt, dict) and "model" in ckpt else ckpt
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    return model, float(ckpt.get("best_iou", 0)) if isinstance(ckpt, dict) else 0.0


@torch.no_grad()
def predict_mask(model, image_bgr: np.ndarray, device: torch.device, size: int = 512, thresh: float = 0.5):
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    boxed, meta = letterbox_rgb(rgb, size)
    tensor = torch.from_numpy(boxed.astype(np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0).to(device)
    logits = model(tensor)
    prob = torch.sigmoid(logits)[0, 0].cpu().numpy()
    binary = (prob >= thresh).astype(np.uint8) * 255
    full = unletterbox_mask(binary, meta)
    return full, prob, meta


def skeletonize(mask: np.ndarray) -> np.ndarray:
    try:
        import cv2.ximgproc as xip
        return xip.thinning(mask)
    except Exception:
        # fallback morphological skeleton
        skel = np.zeros_like(mask)
        element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
        img = mask.copy()
        while True:
            opened = cv2.morphologyEx(img, cv2.MORPH_OPEN, element)
            temp = cv2.subtract(img, opened)
            eroded = cv2.erode(img, element)
            skel = cv2.bitwise_or(skel, temp)
            img = eroded
            if cv2.countNonZero(img) == 0:
                break
        return skel


def mask_to_wall_segments(mask: np.ndarray, min_length: float = 18.0):
    """Extract Hough line segments from wall mask as draft.walls-like dicts."""
    skel = skeletonize(mask)
    lines = cv2.HoughLinesP(
        skel,
        rho=1,
        theta=np.pi / 180,
        threshold=20,
        minLineLength=int(min_length),
        maxLineGap=8,
    )
    walls = []
    if lines is None:
        return walls
    for i, line in enumerate(lines[:, 0, :]):
        x1, y1, x2, y2 = map(float, line)
        length = float(np.hypot(x2 - x1, y2 - y1))
        if length < min_length:
            continue
        orientation = "horizontal" if abs(y2 - y1) <= abs(x2 - x1) else "vertical"
        walls.append({
            "id": f"ml-wall-{i + 1}",
            "start": {"x": round(x1, 1), "y": round(y1, 1)},
            "end": {"x": round(x2, 1), "y": round(y2, 1)},
            "thickness": 8,
            "confidence": 0.86,
            "orientation": orientation,
            "source": "ml-wall-unet",
            "length": round(length, 1),
        })
    return walls


def overlay_mask(image_bgr: np.ndarray, mask: np.ndarray, color=(0, 80, 255), alpha=0.45) -> np.ndarray:
    out = image_bgr.copy()
    tint = np.zeros_like(out)
    tint[:, :] = color
    m = mask > 0
    out[m] = (out[m].astype(np.float32) * (1 - alpha) + tint[m].astype(np.float32) * alpha).astype(np.uint8)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--image", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--thresh", type=float, default=0.5)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    device = resolve_device(args.device)
    model, best_iou = load_model(Path(args.checkpoint), device)

    image = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(args.image)
    mask, _, meta = predict_mask(model, image, device, args.size, args.thresh)
    raw_walls = mask_to_wall_segments(mask)
    walls = merge_wall_segments(raw_walls)
    room_interiors = extract_room_interiors_from_wall_mask(mask)
    overlay = overlay_mask(image, mask)

    mask_path = out_dir / "wall-mask.png"
    overlay_path = out_dir / "wall-overlay.jpg"
    walls_path = out_dir / "walls.json"
    rooms_path = out_dir / "rooms.json"
    cv2.imwrite(str(mask_path), mask)
    cv2.imwrite(str(overlay_path), overlay, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    walls_path.write_text(json.dumps({
        "walls": walls,
        "rawWallCount": len(raw_walls),
        "wallCount": len(walls),
        "meta": meta,
        "bestIouAtTrain": best_iou
    }, indent=2), encoding="utf-8")
    rooms_path.write_text(json.dumps({
        "roomInteriorCandidates": room_interiors,
        "roomInteriorCandidateCount": len(room_interiors),
        "meta": meta,
    }, indent=2), encoding="utf-8")
    print(json.dumps({
        "mask": str(mask_path.resolve()),
        "overlay": str(overlay_path.resolve()),
        "walls": str(walls_path.resolve()),
        "rooms": str(rooms_path.resolve()),
        "wallCount": len(walls),
        "roomInteriorCount": len(room_interiors),
        "wallRatio": round(float((mask > 0).mean()), 4),
        "device": str(device),
        "bestIouAtTrain": best_iou,
    }, indent=2))


if __name__ == "__main__":
    main()
