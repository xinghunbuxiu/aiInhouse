"""Extract room interior candidates from a predicted wall mask."""
from __future__ import annotations

import cv2
import numpy as np


def _perimeter_wall_score(wall_mask: np.ndarray, x: int, y: int, w: int, h: int) -> float:
    """Fraction of bbox border pixels adjacent to wall (higher = more enclosed)."""
    if w <= 0 or h <= 0:
        return 0.0
    pad = 2
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(wall_mask.shape[1], x + w + pad)
    y2 = min(wall_mask.shape[0], y + h + pad)
    roi = wall_mask[y1:y2, x1:x2]
    if roi.size == 0:
        return 0.0

    # border ring in local coords
    local_x = x - x1
    local_y = y - y1
    ring = np.zeros(roi.shape, dtype=np.uint8)
    ring[local_y : local_y + h, local_x : local_x + w] = 255
    ring[local_y + 2 : local_y + h - 2, local_x + 2 : local_x + w - 2] = 0
    border = ring > 0
    if not border.any():
        return 0.0
    return float((roi[border] > 0).mean())


def extract_room_interiors_from_wall_mask(
    wall_mask: np.ndarray,
    *,
    min_area: int = 2200,
    min_dim: int = 42,
    max_area_ratio: float = 0.42,
    wall_dilate: int = 3,
    limit: int = 15,
) -> list[dict]:
    """Return roomInteriorCandidate dicts compatible with codex-worker local-draft."""
    h, w = wall_mask.shape[:2]
    image_area = h * w
    if image_area <= 0:
        return []

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    walls = cv2.dilate(wall_mask, kernel, iterations=max(1, wall_dilate // 2))
    free = cv2.bitwise_not(walls)

    # Remove exterior connected to image border
    exterior = free.copy()
    flood = np.zeros((h + 2, w + 2), np.uint8)
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    for sx, sy in seeds:
        if exterior[sy, sx] > 0:
            cv2.floodFill(exterior, flood, (sx, sy), 0)

    num_labels, _labels, stats, _centroids = cv2.connectedComponentsWithStats(exterior, connectivity=8)
    rooms: list[dict] = []
    for label in range(1, num_labels):
        x, y, bw, bh, area = stats[label]
        if area < min_area or bw < min_dim or bh < min_dim:
            continue
        if area > image_area * max_area_ratio:
            continue
        perimeter = _perimeter_wall_score(wall_mask, int(x), int(y), int(bw), int(bh))
        if perimeter < 0.18:
            continue
        fill_ratio = float(area / max(1, bw * bh))
        confidence = float(min(0.86, 0.62 + perimeter * 0.28 + fill_ratio * 0.06))
        rooms.append({
            "id": f"ml-room-interior-{len(rooms) + 1}",
            "x": int(x),
            "y": int(y),
            "width": int(bw),
            "height": int(bh),
            "area": int(area),
            "confidence": round(confidence, 3),
            "source": "ml-wall-mask-room-interior",
            "fillRatio": round(fill_ratio, 3),
            "perimeterWallScore": round(perimeter, 3),
            "strongEdges": 4 if perimeter >= 0.45 else 3,
        })

    rooms.sort(key=lambda item: item["area"], reverse=True)
    return rooms[:limit]
