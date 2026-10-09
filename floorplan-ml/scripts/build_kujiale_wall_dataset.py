"""Build train/val splits and wall masks from kujiale-3d view pairs."""
from __future__ import annotations

import argparse
import json
import random
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def wall_mask_from_centerline(path: Path, out_size: tuple[int, int] | None = None) -> np.ndarray:
    """Dark strokes on light bg → binary wall mask (uint8 0/255)."""
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(path)
    # adaptive + fixed threshold to catch thin centerlines
    blur = cv2.GaussianBlur(img, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # remove small speckles, thicken slightly for learning signal
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel, iterations=1)
    th = cv2.dilate(th, kernel, iterations=1)
    if out_size is not None and (th.shape[1], th.shape[0]) != out_size:
        th = cv2.resize(th, out_size, interpolation=cv2.INTER_NEAREST)
    return th


def letterbox_rgb(img: np.ndarray, size: int = 512) -> tuple[np.ndarray, dict]:
    h, w = img.shape[:2]
    scale = min(size / h, size / w)
    nh, nw = int(round(h * scale)), int(round(w * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.full((size, size, 3), 255, dtype=np.uint8)
    top = (size - nh) // 2
    left = (size - nw) // 2
    canvas[top : top + nh, left : left + nw] = resized
    meta = {"scale": scale, "top": top, "left": left, "nh": nh, "nw": nw, "oh": h, "ow": w}
    return canvas, meta


def letterbox_mask(mask: np.ndarray, meta: dict, size: int = 512) -> np.ndarray:
    resized = cv2.resize(mask, (meta["nw"], meta["nh"]), interpolation=cv2.INTER_NEAREST)
    canvas = np.zeros((size, size), dtype=np.uint8)
    top, left = meta["top"], meta["left"]
    canvas[top : top + meta["nh"], left : left + meta["nw"]] = resized
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", default="backend/uploads/floorplans/kujiale-3d")
    ap.add_argument("--out", default="floorplan-ml/data/kujiale-wall")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--train-ratio", type=float, default=0.9)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    root = Path(args.data_root)
    out = Path(args.out)
    for split in ("train", "val"):
        (out / split / "images").mkdir(parents=True, exist_ok=True)
        (out / split / "masks").mkdir(parents=True, exist_ok=True)

    ids = sorted(
        d.name
        for d in root.iterdir()
        if d.is_dir() and (d / "record.json").exists()
    )
    samples = []
    for design_id in ids:
        views = root / design_id / "views"
        label = views / "wallCenterLine.jpg"
        inp = views / "withoutDimensionLine.jpg"
        if not inp.exists():
            inp = views / "insideTheWall.jpg"
        if not inp.exists():
            inp = views / "imageUrl.jpg"
        if not label.exists() or not inp.exists():
            continue
        samples.append({"id": design_id, "input": str(inp), "label": str(label)})

    if args.limit > 0:
        samples = samples[: args.limit]

    random.Random(args.seed).shuffle(samples)
    n_train = max(1, int(len(samples) * args.train_ratio))
    splits = {"train": samples[:n_train], "val": samples[n_train:] or samples[-1:]}

    manifest = {"train": [], "val": [], "size": args.size, "count": len(samples)}
    for split, items in splits.items():
        for item in items:
            design_id = item["id"]
            rgb = cv2.imread(item["input"], cv2.IMREAD_COLOR)
            if rgb is None:
                continue
            rgb = cv2.cvtColor(rgb, cv2.COLOR_BGR2RGB)
            mask = wall_mask_from_centerline(Path(item["label"]))
            # align mask to input spatial size first
            if mask.shape[:2] != rgb.shape[:2]:
                mask = cv2.resize(mask, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_NEAREST)
            boxed, meta = letterbox_rgb(rgb, args.size)
            boxed_mask = letterbox_mask(mask, meta, args.size)
            wall_ratio = float((boxed_mask > 127).mean())
            if wall_ratio < 0.005 or wall_ratio > 0.45:
                # skip empty / garbage labels
                continue
            img_path = out / split / "images" / f"{design_id}.png"
            mask_path = out / split / "masks" / f"{design_id}.png"
            Image.fromarray(boxed).save(img_path)
            Image.fromarray(boxed_mask).save(mask_path)
            rec = {
                "id": design_id,
                "image": str(img_path.relative_to(out)),
                "mask": str(mask_path.relative_to(out)),
                "wall_ratio": round(wall_ratio, 4),
                "meta": meta,
            }
            manifest[split].append(rec)

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "out": str(out.resolve()),
                "raw_pairs": len(samples),
                "train": len(manifest["train"]),
                "val": len(manifest["val"]),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
