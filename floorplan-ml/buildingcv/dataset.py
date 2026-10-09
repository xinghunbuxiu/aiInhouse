from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset


class WallMaskDataset(Dataset):
    def __init__(self, manifest_path: Path, split: str = "train"):
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        self.items = manifest.get(split, [])
        self.root = Path(manifest_path).parent

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        item = self.items[idx]
        img = np.array(Image.open(self.root / item["image"]).convert("RGB"), dtype=np.float32) / 255.0
        mask = np.array(Image.open(self.root / item["mask"]).convert("L"), dtype=np.float32)
        mask = (mask > 127).astype(np.float32)
        img = torch.from_numpy(img).permute(2, 0, 1)
        mask = torch.from_numpy(mask).unsqueeze(0)
        return img, mask, item["id"]
