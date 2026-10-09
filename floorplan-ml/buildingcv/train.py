from __future__ import annotations

import argparse
import csv
import json
import random
import time
from datetime import datetime
from pathlib import Path

import torch
import torch.nn as nn
import yaml
from torch.utils.data import DataLoader
from tqdm import tqdm

from buildingcv.dataset import WallMaskDataset
from buildingcv.model import build_unet


def dice_coef(pred: torch.Tensor, target: torch.Tensor, eps: float = 1e-6) -> torch.Tensor:
    pred = torch.sigmoid(pred)
    pred = (pred > 0.5).float()
    inter = (pred * target).sum(dim=(2, 3))
    union = pred.sum(dim=(2, 3)) + target.sum(dim=(2, 3))
    return ((2 * inter + eps) / (union + eps)).mean()


def iou_score(pred: torch.Tensor, target: torch.Tensor, eps: float = 1e-6) -> torch.Tensor:
    pred = torch.sigmoid(pred)
    pred = (pred > 0.5).float()
    inter = (pred * target).sum(dim=(2, 3))
    union = pred.sum(dim=(2, 3)) + target.sum(dim=(2, 3)) - inter
    return ((inter + eps) / (union + eps)).mean()


def resolve_device(name: str) -> torch.device:
    if name == "mps" and torch.backends.mps.is_available():
        return torch.device("mps")
    if name == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def run_epoch(model, loader, criterion, optimizer, device, train: bool):
    model.train(train)
    total_loss = 0.0
    total_iou = 0.0
    total_dice = 0.0
    count = 0
    ctx = torch.enable_grad() if train else torch.no_grad()
    with ctx:
        for images, masks, _ in tqdm(loader, leave=False, desc="train" if train else "val"):
            images = images.to(device)
            masks = masks.to(device)
            logits = model(images)
            loss = criterion(logits, masks)
            if train:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                optimizer.step()
            total_loss += float(loss.item())
            total_iou += float(iou_score(logits, masks).item())
            total_dice += float(dice_coef(logits, masks).item())
            count += 1
    return {
        "loss": total_loss / max(count, 1),
        "iou": total_iou / max(count, 1),
        "dice": total_dice / max(count, 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/wall_unet_mps.yaml")
    ap.add_argument("--resume", default="")
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    random.seed(cfg.get("seed", 42))
    torch.manual_seed(cfg.get("seed", 42))

    dataset_dir = Path(cfg["dataset_dir"])
    manifest = dataset_dir / "manifest.json"
    if not manifest.exists():
        raise FileNotFoundError(f"Missing dataset manifest: {manifest}. Run build_kujiale_wall_dataset.py first.")

    device = resolve_device(cfg.get("device", "mps"))
    train_ds = WallMaskDataset(manifest, "train")
    val_ds = WallMaskDataset(manifest, "val")
    train_loader = DataLoader(
        train_ds,
        batch_size=cfg.get("batch_size", 4),
        shuffle=True,
        num_workers=cfg.get("num_workers", 0),
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=cfg.get("batch_size", 4),
        shuffle=False,
        num_workers=cfg.get("num_workers", 0),
    )

    model = build_unet(cfg.get("encoder", "resnet34"), cfg.get("encoder_weights", "imagenet"), 1)
    model = model.to(device)
    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=float(cfg.get("lr", 3e-4)),
        weight_decay=float(cfg.get("weight_decay", 1e-4)),
    )

    run_dir = Path(cfg.get("runs_dir", "runs")) / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    metrics_path = run_dir / "metrics.csv"
    with metrics_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["epoch", "train_loss", "train_iou", "train_dice", "val_loss", "val_iou", "val_dice", "seconds"])

    start_epoch = 1
    best_iou = 0.0
    patience = int(cfg.get("early_stop_patience", 6))
    stale = 0

    if args.resume:
        ckpt = torch.load(args.resume, map_location=device)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        start_epoch = int(ckpt.get("epoch", 0)) + 1
        best_iou = float(ckpt.get("best_iou", 0.0))
        run_dir = Path(args.resume).parent

    for epoch in range(start_epoch, int(cfg.get("epochs", 30)) + 1):
        t0 = time.time()
        train_metrics = run_epoch(model, train_loader, criterion, optimizer, device, True)
        val_metrics = run_epoch(model, val_loader, criterion, optimizer, device, False)
        elapsed = round(time.time() - t0, 1)
        row = [
            epoch,
            round(train_metrics["loss"], 4),
            round(train_metrics["iou"], 4),
            round(train_metrics["dice"], 4),
            round(val_metrics["loss"], 4),
            round(val_metrics["iou"], 4),
            round(val_metrics["dice"], 4),
            elapsed,
        ]
        with metrics_path.open("a", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(row)
        print(
            f"epoch {epoch}: train iou={train_metrics['iou']:.3f} dice={train_metrics['dice']:.3f} | "
            f"val iou={val_metrics['iou']:.3f} dice={val_metrics['dice']:.3f} ({elapsed}s)"
        )

        payload = {
            "epoch": epoch,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "best_iou": best_iou,
            "val_iou": val_metrics["iou"],
        }
        torch.save(payload, run_dir / "last.pt")
        if val_metrics["iou"] > best_iou:
            best_iou = val_metrics["iou"]
            payload["best_iou"] = best_iou
            torch.save(payload, run_dir / "best.pt")
            stale = 0
        else:
            stale += 1
            if stale >= patience:
                print(f"early stop at epoch {epoch}, best val iou={best_iou:.3f}")
                break

    summary = {
        "run_dir": str(run_dir.resolve()),
        "best_val_iou": round(best_iou, 4),
        "train_count": len(train_ds),
        "val_count": len(val_ds),
        "device": str(device),
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
