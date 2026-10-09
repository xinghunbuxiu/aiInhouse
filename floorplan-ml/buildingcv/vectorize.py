"""Merge fragmented wall segments into grid-aligned support lines."""
from __future__ import annotations

import math


def _segment_bounds(seg: dict) -> tuple[float, float, float, float, str]:
    x1 = float(seg["start"]["x"])
    y1 = float(seg["start"]["y"])
    x2 = float(seg["end"]["x"])
    y2 = float(seg["end"]["y"])
    if abs(y2 - y1) <= abs(x2 - x1):
        key = (y1 + y2) / 2
        a, b = min(x1, x2), max(x1, x2)
        return key, a, b, abs(x2 - x1), "horizontal"
    key = (x1 + x2) / 2
    a, b = min(y1, y2), max(y1, y2)
    return key, a, b, abs(y2 - y1), "vertical"


def merge_wall_segments(segments: list[dict], *, axis_tolerance: float = 14, gap_tolerance: float = 24, min_length: float = 28) -> list[dict]:
    horiz: dict[int, list[tuple[float, float]]] = {}
    vert: dict[int, list[tuple[float, float]]] = {}

    for seg in segments:
        key, a, b, length, orientation = _segment_bounds(seg)
        if length < min_length * 0.6:
            continue
        bucket_key = int(round(key / axis_tolerance))
        target = horiz if orientation == "horizontal" else vert
        target.setdefault(bucket_key, []).append((a, b))

    merged: list[dict] = []

    def flush(groups: dict[int, list[tuple[float, float]]], orientation: str):
        idx = 0
        for bucket in sorted(groups):
            spans = sorted(groups[bucket])
            cur_a, cur_b = spans[0]
            for a, b in spans[1:]:
                if a <= cur_b + gap_tolerance:
                    cur_b = max(cur_b, b)
                else:
                    if cur_b - cur_a >= min_length:
                        idx += 1
                        if orientation == "horizontal":
                            y = bucket * axis_tolerance
                            merged.append(_make_seg(idx, orientation, cur_a, y, cur_b, y))
                        else:
                            x = bucket * axis_tolerance
                            merged.append(_make_seg(idx, orientation, x, cur_a, x, cur_b))
                    cur_a, cur_b = a, b
            if cur_b - cur_a >= min_length:
                idx += 1
                if orientation == "horizontal":
                    y = bucket * axis_tolerance
                    merged.append(_make_seg(idx, orientation, cur_a, y, cur_b, y))
                else:
                    x = bucket * axis_tolerance
                    merged.append(_make_seg(idx, orientation, x, cur_a, x, cur_b))

    flush(horiz, "horizontal")
    flush(vert, "vertical")
    return merged


def _make_seg(idx: int, orientation: str, x1: float, y1: float, x2: float, y2: float) -> dict:
    length = math.hypot(x2 - x1, y2 - y1)
    return {
        "id": f"ml-wall-{idx}",
        "start": {"x": round(x1, 1), "y": round(y1, 1)},
        "end": {"x": round(x2, 1), "y": round(y2, 1)},
        "thickness": 8,
        "confidence": 0.88,
        "orientation": orientation,
        "source": "ml-wall-unet",
        "length": round(length, 1),
    }
