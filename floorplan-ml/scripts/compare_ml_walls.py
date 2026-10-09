"""Compare ML wall prediction vs wallCenterLine GT for a few kujiale samples."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch

from buildingcv.infer import load_model, overlay_mask, predict_mask, resolve_device


def wall_mask_from_centerline(path: Path, size_hw: tuple[int, int]) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(path)
    blur = cv2.GaussianBlur(img, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel, iterations=1)
    th = cv2.dilate(th, kernel, iterations=1)
    if th.shape[:2] != size_hw:
        th = cv2.resize(th, (size_hw[1], size_hw[0]), interpolation=cv2.INTER_NEAREST)
    return th


def binary_iou(pred: np.ndarray, gt: np.ndarray) -> float:
    p = pred > 0
    g = gt > 0
    inter = np.logical_and(p, g).sum()
    union = np.logical_or(p, g).sum()
    return float(inter / union) if union else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--data-root", default="../backend/uploads/floorplans/kujiale-3d")
    ap.add_argument("--out", default="../tmp/ml-wall-compare")
    ap.add_argument("--ids", default="")
    ap.add_argument("--limit", type=int, default=6)
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    data_root = Path(args.data_root)
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    device = resolve_device(args.device)
    model, best_iou = load_model(Path(args.checkpoint), device)

    if args.ids.strip():
        ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    else:
        ids = sorted(d.name for d in data_root.iterdir() if (d / "views" / "withoutDimensionLine.jpg").exists())[: args.limit]

    rows = []
    cards = []
    for design_id in ids:
        views = data_root / design_id / "views"
        image_path = views / "withoutDimensionLine.jpg"
        if not image_path.exists():
            image_path = views / "imageUrl.jpg"
        gt_path = views / "wallCenterLine.jpg"
        if not image_path.exists() or not gt_path.exists():
            continue
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        pred, _, _ = predict_mask(model, image, device)
        gt = wall_mask_from_centerline(gt_path, image.shape[:2])
        iou = binary_iou(pred, gt)
        sample_dir = out_root / design_id
        sample_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(sample_dir / "input.jpg"), image)
        cv2.imwrite(str(sample_dir / "pred-mask.png"), pred)
        cv2.imwrite(str(sample_dir / "gt-mask.png"), gt)
        cv2.imwrite(str(sample_dir / "pred-overlay.jpg"), overlay_mask(image, pred, (0, 80, 255)))
        cv2.imwrite(str(sample_dir / "gt-overlay.jpg"), overlay_mask(image, gt, (0, 180, 0)))
        # side-by-side: input | pred | gt
        h = 400
        def resize_h(im):
            s = h / im.shape[0]
            return cv2.resize(im, (int(im.shape[1] * s), h))
        panel = np.hstack([
            resize_h(image),
            resize_h(overlay_mask(image, pred, (0, 80, 255))),
            resize_h(overlay_mask(image, gt, (0, 180, 0))),
        ])
        cv2.imwrite(str(sample_dir / "compare.jpg"), panel)
        rows.append({"id": design_id, "iou": round(iou, 4)})
        cards.append(
            f'<a class="card" href="./{design_id}/compare.jpg">'
            f'<img src="./{design_id}/compare.jpg"/><div>{design_id} · IoU {iou:.3f}</div></a>'
        )
        print(f"{design_id} iou={iou:.3f}")

    avg = float(np.mean([r["iou"] for r in rows])) if rows else 0
    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/><title>ML 墙 vs wallCenterLine</title>
<style>
body{{margin:0;font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}}
.card{{display:block;background:#111827;border:1px solid #1e293b;border-radius:10px;overflow:hidden;color:#93c5fd;text-decoration:none}}
.card img{{width:100%;display:block;background:#fff}}
.card div{{padding:10px}}
.meta{{color:#94a3b8;margin-bottom:16px}}
</style></head><body>
<h1>ML 墙分割 vs wallCenterLine</h1>
<p class="meta">best train IoU={best_iou:.3f} · sample avg IoU={avg:.3f} · 左原图 / 中预测(蓝) / 右真值(绿)</p>
<div class="grid">{''.join(cards)}</div>
</body></html>"""
    (out_root / "index.html").write_text(html, encoding="utf-8")
    (out_root / "summary.json").write_text(json.dumps({"bestTrainIou": best_iou, "avgSampleIou": avg, "rows": rows}, indent=2), encoding="utf-8")
    print(json.dumps({"out": str(out_root.resolve()), "avgSampleIou": avg, "n": len(rows)}, indent=2))


if __name__ == "__main__":
    main()
