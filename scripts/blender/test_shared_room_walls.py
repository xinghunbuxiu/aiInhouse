#!/usr/bin/env python3
"""Pure geometry regression tests for shared room edges.

The renderer normally imports Blender modules. Stub those modules so this
small geometry helper can be tested by regular Python in CI without Blender.
"""
import importlib.util
import sys
import types
from pathlib import Path

bpy = types.ModuleType("bpy")
bpy.data = types.SimpleNamespace()
bpy.ops = types.SimpleNamespace()
bpy.context = types.SimpleNamespace()
sys.modules.setdefault("bpy", bpy)

mathutils = types.ModuleType("mathutils")
mathutils.Vector = lambda value: value
sys.modules.setdefault("mathutils", mathutils)

renderer_path = Path(__file__).with_name("aiinhouse_render.py")
spec = importlib.util.spec_from_file_location("aiinhouse_render_tested", renderer_path)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def room(x, y, width, height, name):
    return {"id": name, "x": x, "y": y, "width": width, "height": height}


def check(label, rooms, index, expected):
    actual = renderer.shared_room_wall_sides(rooms, index)
    assert actual == expected, f"{label}: expected {expected}, got {actual}"


def main():
    # Exact shared vertical edge; second room must not emit its west wall.
    adjacent = [room(0, 0, 100, 80, "A"), room(100, 0, 60, 80, "B")]
    check("full vertical shared edge", adjacent, 1, {"west"})
    check("first room owns its edges", adjacent, 0, set())

    # Exact shared horizontal edge.
    horizontal = [room(0, 0, 100, 80, "A"), room(0, 80, 100, 60, "B")]
    check("full horizontal shared edge", horizontal, 1, {"south"})

    # Partial overlap must not remove a whole side and create a gap.
    partial = [room(0, 0, 100, 40, "A"), room(100, 20, 60, 80, "B")]
    check("partial vertical overlap", partial, 1, set())

    # Separated rooms must retain all four sides.
    separated = [room(0, 0, 100, 80, "A"), room(105, 0, 60, 80, "B")]
    check("separated rooms", separated, 1, set())

    # Near-coincident edges within tolerance are treated as the same edge.
    near = [room(0, 0, 100, 80, "A"), room(101, 0, 60, 80, "B")]
    check("near shared edge", near, 1, {"west"})
    print("shared-room-wall regression tests: 5 cases passed")


if __name__ == "__main__":
    main()
