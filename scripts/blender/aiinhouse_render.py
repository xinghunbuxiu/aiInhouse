import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOM_COLORS = {
    "living": (0.74, 0.82, 0.92, 1),
    "bedroom": (0.78, 0.72, 0.88, 1),
    "kitchen": (0.70, 0.84, 0.72, 1),
    "bathroom": (0.68, 0.88, 0.88, 1),
    "dining": (0.90, 0.78, 0.58, 1),
    "balcony": (0.66, 0.82, 0.90, 1),
    "space": (0.82, 0.82, 0.78, 1),
}

CATEGORY_ACTIONS = {
    "apply_wall_finish",
    "apply_floor_finish",
    "apply_ceiling_finish",
    "place_lighting",
    "place_cabinet",
    "place_appliance",
    "place_furniture",
    "place_supporting_furniture",
    "place_soft_decor",
    "place_sanitary",
    "place_opening_asset",
}

PROJECT_ROOT = Path(os.environ.get("AIINHOUSE_PROJECT_ROOT", Path(__file__).resolve().parents[2]))


def read_json(path, fallback=None):
    if not path or not Path(path).exists():
        return fallback if fallback is not None else {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def make_mat(name, color, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def resolve_asset_path(value):
    if not value:
        return None
    raw = str(value)
    if raw.startswith("http://") or raw.startswith("https://"):
        return None
    if raw.startswith("/uploads/"):
        path = PROJECT_ROOT / "backend" / raw.lstrip("/")
    elif raw.startswith("uploads/"):
        path = PROJECT_ROOT / "backend" / raw
    else:
        path = Path(raw)
        if not path.is_absolute():
            path = PROJECT_ROOT / raw
    return path if path.exists() else None


def make_texture_mat(name, asset, fallback_color, roughness=0.55):
    pbr = asset.get("pbrTextures") if asset else {}
    texture_path = resolve_asset_path(asset.get("textureUrl") if asset else "")
    if not texture_path and isinstance(pbr, dict):
        texture_path = resolve_asset_path(pbr.get("baseColor") or pbr.get("albedo") or "")
    mat = make_mat(name, fallback_color, roughness)
    if not texture_path:
        return mat

    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if not bsdf:
        return mat

    try:
        image = bpy.data.images.load(str(texture_path))
        tex = nodes.new(type="ShaderNodeTexImage")
        tex.image = image
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    except Exception:
        return mat

    return mat


def hex_to_rgba(value, fallback=(0.8, 0.8, 0.8, 1)):
    raw = str(value or "").strip().lstrip("#")
    if len(raw) != 6:
        return fallback
    try:
        return (
            int(raw[0:2], 16) / 255,
            int(raw[2:4], 16) / 255,
            int(raw[4:6], 16) / 255,
            1,
        )
    except ValueError:
        return fallback


def asset_prop(asset, key, fallback=None):
    if not asset:
        return fallback
    return (asset.get("properties") or {}).get(key, fallback)


def find_step_asset(room, action):
    assembly = room.get("assembly") or {}
    for step in assembly.get("steps") or []:
        if step.get("action") == action and step.get("asset"):
            return step.get("asset")
    return None


def find_step_assets(room, action):
    assembly = room.get("assembly") or {}
    return [
        step.get("asset")
        for step in assembly.get("steps") or []
        if step.get("action") == action and step.get("asset")
    ]


def room_assets(room):
    assets = {
        "wall": find_step_asset(room, "apply_wall_finish"),
        "floor": find_step_asset(room, "apply_floor_finish"),
        "ceiling": find_step_asset(room, "apply_ceiling_finish"),
        "lighting": find_step_asset(room, "place_lighting"),
        "cabinet": find_step_asset(room, "place_cabinet"),
        "appliance": find_step_assets(room, "place_appliance"),
        "furniture": find_step_asset(room, "place_furniture"),
        "supporting_furniture": find_step_assets(room, "place_supporting_furniture"),
        "soft_decor": find_step_assets(room, "place_soft_decor"),
        "sanitary": find_step_assets(room, "place_sanitary"),
        "opening": find_step_asset(room, "place_opening_asset"),
    }

    extra = []
    assembly = room.get("assembly") or {}
    for step in assembly.get("steps") or []:
        asset = step.get("asset")
        if not asset or step.get("action") in CATEGORY_ACTIONS:
            continue
        extra.append(asset)
    assets["extra"] = extra
    return assets


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def add_cube(name, location, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    return obj


def import_model_asset(asset, location, target_size, material=None, name_prefix="asset-model"):
    model_path = resolve_asset_path(asset.get("modelUrl") if asset else "")
    if not model_path:
        return None

    before = set(bpy.context.scene.objects)
    ext = model_path.suffix.lower()
    try:
        if ext in [".glb", ".gltf"]:
            bpy.ops.import_scene.gltf(filepath=str(model_path))
        elif ext == ".obj":
            bpy.ops.import_scene.obj(filepath=str(model_path))
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=str(model_path))
        else:
            return None
    except Exception:
        return None

    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    mesh_objects = [obj for obj in imported if obj.type == "MESH"]
    if not mesh_objects:
        return None

    root = bpy.data.objects.new(f"{name_prefix}-{asset.get('id', 'model')}", None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        obj.parent = root

    min_corner = Vector((float("inf"), float("inf"), float("inf")))
    max_corner = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in mesh_objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            min_corner.x = min(min_corner.x, world.x)
            min_corner.y = min(min_corner.y, world.y)
            min_corner.z = min(min_corner.z, world.z)
            max_corner.x = max(max_corner.x, world.x)
            max_corner.y = max(max_corner.y, world.y)
            max_corner.z = max(max_corner.z, world.z)

    size = max(max_corner.x - min_corner.x, max_corner.y - min_corner.y, max_corner.z - min_corner.z, 0.001)
    scale = max(target_size) / size
    root.scale = (scale, scale, scale)
    root.location = location
    if material:
        for obj in mesh_objects:
            if not obj.data.materials:
                obj.data.materials.append(material)
    return root


def add_cylinder(name, location, radius, depth, material, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    return obj


def room_bounds(room):
    bounds = room.get("bounds") or room
    return {
        "x": float(bounds.get("x", room.get("x", 0)) or 0),
        "y": float(bounds.get("y", room.get("y", 0)) or 0),
        "width": max(float(bounds.get("width", room.get("width", 0)) or 0), 1),
        "height": max(float(bounds.get("height", room.get("height", 0)) or 0), 1),
    }


def collect_rooms(plan):
    rooms = plan.get("rooms") or []
    if not rooms:
        rooms = plan.get("roomPlans") or []
    return rooms


def scene_bounds(rooms):
    if not rooms:
        return {"min_x": 0, "min_y": 0, "max_x": 600, "max_y": 420, "width": 600, "height": 420}

    boxes = [room_bounds(room) for room in rooms]
    min_x = min(box["x"] for box in boxes)
    min_y = min(box["y"] for box in boxes)
    max_x = max(box["x"] + box["width"] for box in boxes)
    max_y = max(box["y"] + box["height"] for box in boxes)
    return {
        "min_x": min_x,
        "min_y": min_y,
        "max_x": max_x,
        "max_y": max_y,
        "width": max(max_x - min_x, 1),
        "height": max(max_y - min_y, 1),
    }


def normalize_point(x, y, bounds, scale=0.025):
    return ((x - bounds["min_x"]) * scale, (y - bounds["min_y"]) * scale)


def point_inside_box(x, y, box, margin=0):
    return (
        box["x"] - margin <= x <= box["x"] + box["width"] + margin
        and box["y"] - margin <= y <= box["y"] + box["height"] + margin
    )


def opening_side(opening, box):
    ox = float(opening.get("x", 0) or 0)
    oy = float(opening.get("y", 0) or 0)
    distances = {
        "west": abs(ox - box["x"]),
        "east": abs(ox - (box["x"] + box["width"])),
        "south": abs(oy - box["y"]),
        "north": abs(oy - (box["y"] + box["height"])),
    }
    return min(distances, key=distances.get)


def find_opening_room(opening, room_boxes):
    ox = float(opening.get("x", 0) or 0)
    oy = float(opening.get("y", 0) or 0)
    size_margin = max(float(opening.get("width", 0) or 0), float(opening.get("height", 0) or 0), 24)
    for room, box in room_boxes:
        if point_inside_box(ox, oy, box, size_margin):
            return room, box

    best = None
    best_distance = float("inf")
    for room, box in room_boxes:
        clamped_x = min(max(ox, box["x"]), box["x"] + box["width"])
        clamped_y = min(max(oy, box["y"]), box["y"] + box["height"])
        distance = math.hypot(ox - clamped_x, oy - clamped_y)
        if distance < best_distance:
            best = (room, box)
            best_distance = distance
    return best


def add_opening_marker(opening, box, bounds, mats, index):
    ox = float(opening.get("x", box["x"] + box["width"] / 2) or 0)
    oy = float(opening.get("y", box["y"] + box["height"] / 2) or 0)
    side = opening_side(opening, box)
    scale = 0.025
    x, y = normalize_point(ox, oy, bounds, scale)
    kind = str(opening.get("kind") or opening.get("type") or "opening").lower()
    is_window = "window" in kind
    major = max(float(opening.get("width", 0) or 0), float(opening.get("height", 0) or 0), 24) * scale
    major = max(major, 0.42 if is_window else 0.30)
    height = 0.48 if is_window else 1.18
    z = 0.95 if is_window else 0.58

    room_x, room_y = normalize_point(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, bounds, scale)
    room_w = box["width"] * scale
    room_h = box["height"] * scale
    if side == "north":
        y = room_y + room_h / 2 + 0.045
        dims = (major, 0.095, height)
    elif side == "south":
        y = room_y - room_h / 2 - 0.045
        dims = (major, 0.095, height)
    elif side == "east":
        x = room_x + room_w / 2 + 0.045
        dims = (0.095, major, height)
    else:
        x = room_x - room_w / 2 - 0.045
        dims = (0.095, major, height)

    cutout_mat = mats["window_cutout"] if is_window else mats["door_cutout"]
    marker_mat = mats["window_glass"] if is_window else mats["door_panel"]
    add_cube(f"{kind}-cutout-{index}", (x, y, z), dims, cutout_mat)

    inset = 0.018
    marker_dims = (max(dims[0] - inset, 0.04), max(dims[1] - inset, 0.04), max(dims[2] - inset, 0.04))
    marker_z = z if is_window else max(0.42, z - 0.08)
    add_cube(f"{kind}-marker-{index}", (x, y, marker_z), marker_dims, marker_mat)


def opening_major_length(opening, scale=0.025):
    return max(float(opening.get("width", 0) or 0), float(opening.get("height", 0) or 0), 24) * scale


def room_openings(plan, box):
    matches = []
    for opening in plan.get("openings") or []:
        ox = float(opening.get("x", 0) or 0)
        oy = float(opening.get("y", 0) or 0)
        margin = max(float(opening.get("width", 0) or 0), float(opening.get("height", 0) or 0), 24)
        if point_inside_box(ox, oy, box, margin):
            matches.append(opening)
    return matches


def add_wall_segment(name, side, center, length, thickness, height, z, material):
    if length <= 0.05 or height <= 0.05:
        return None
    x, y = center
    if side in ["north", "south"]:
        return add_cube(name, (x, y, z), (length, thickness, height), material)
    return add_cube(name, (x, y, z), (thickness, length, height), material)


def add_room_wall(side, room_index, room_center, room_size, openings, bounds, wall_mat):
    scale = 0.025
    wall_height = 2.7
    wall_thickness = 0.08
    x, y = room_center
    w, h = room_size
    horizontal = side in ["north", "south"]
    wall_length = w if horizontal else h
    wall_y = y + h / 2 if side == "north" else y - h / 2 if side == "south" else y
    wall_x = x + w / 2 if side == "east" else x - w / 2 if side == "west" else x

    side_openings = []
    for opening in openings:
        if opening_side(opening, {
            "x": (x / scale) + bounds["min_x"] - (w / scale) / 2,
            "y": (y / scale) + bounds["min_y"] - (h / scale) / 2,
            "width": w / scale,
            "height": h / scale,
        }) != side:
            continue
        ox, oy = normalize_point(float(opening.get("x", 0) or 0), float(opening.get("y", 0) or 0), bounds, scale)
        axis_center = ox - x if horizontal else oy - y
        half = max(opening_major_length(opening, scale), 0.34) / 2
        side_openings.append({
            "opening": opening,
            "start": max(-wall_length / 2 + 0.08, axis_center - half),
            "end": min(wall_length / 2 - 0.08, axis_center + half),
            "center": axis_center
        })

    side_openings = sorted(
        [item for item in side_openings if item["end"] - item["start"] > 0.12],
        key=lambda item: item["start"]
    )

    cursor = -wall_length / 2
    for segment_index, item in enumerate(side_openings):
        if item["start"] > cursor:
            segment_center_axis = (cursor + item["start"]) / 2
            segment_length = item["start"] - cursor
            center = (x + segment_center_axis, wall_y) if horizontal else (wall_x, y + segment_center_axis)
            add_wall_segment(f"{side}-wall-{room_index}-seg-{segment_index}", side, center, segment_length, wall_thickness, wall_height, 0.75, wall_mat)
        cursor = max(cursor, item["end"])

        opening = item["opening"]
        is_window = "window" in str(opening.get("kind") or opening.get("type") or "").lower()
        opening_length = item["end"] - item["start"]
        opening_center_axis = (item["start"] + item["end"]) / 2
        opening_center = (x + opening_center_axis, wall_y) if horizontal else (wall_x, y + opening_center_axis)
        if is_window:
            add_wall_segment(f"{side}-window-sill-{room_index}-{segment_index}", side, opening_center, opening_length, wall_thickness, 0.72, 0.36, wall_mat)
            add_wall_segment(f"{side}-window-head-{room_index}-{segment_index}", side, opening_center, opening_length, wall_thickness, 0.62, 2.39, wall_mat)
        else:
            add_wall_segment(f"{side}-door-head-{room_index}-{segment_index}", side, opening_center, opening_length, wall_thickness, 0.52, 2.44, wall_mat)

    if cursor < wall_length / 2:
        segment_center_axis = (cursor + wall_length / 2) / 2
        segment_length = wall_length / 2 - cursor
        center = (x + segment_center_axis, wall_y) if horizontal else (wall_x, y + segment_center_axis)
        add_wall_segment(f"{side}-wall-{room_index}-seg-end", side, center, segment_length, wall_thickness, wall_height, 0.75, wall_mat)


def add_plan_openings(plan, rooms, bounds, mats):
    openings = plan.get("openings") or []
    if not openings:
        return 0
    room_boxes = [(room, room_bounds(room)) for room in rooms]
    count = 0
    for index, opening in enumerate(openings):
        matched = find_opening_room(opening, room_boxes)
        if not matched:
            continue
        _, box = matched
        add_opening_marker(opening, box, bounds, mats, index)
        count += 1
    return count


def add_label(name, text, location, size=0.24):
    font_curve = bpy.data.curves.new(name, "FONT")
    font_curve.body = text
    font_curve.align_x = "CENTER"
    font_curve.size = size
    obj = bpy.data.objects.new(name, font_curve)
    obj.location = location
    obj.rotation_euler[0] = math.radians(90)
    bpy.context.collection.objects.link(obj)
    return obj


def add_asset_primitive(asset, room, box, bounds, mats, index, slot=0, allow_imported=True):
    cx, cy = normalize_point(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, bounds)
    rw = box["width"] * 0.025
    rh = box["height"] * 0.025
    room_type = room.get("type", "space")
    primitive = asset_prop(asset, "blenderPrimitive", "")
    color = hex_to_rgba(asset_prop(asset, "color"), (0.7, 0.7, 0.7, 1))
    secondary = hex_to_rgba(asset_prop(asset, "secondaryColor"), (0.45, 0.45, 0.45, 1))
    mat = make_mat(f"asset-{index}-{slot}-{primitive or asset.get('id', 'asset')}", color, 0.62)
    secondary_mat = make_mat(f"asset-secondary-{index}-{slot}-{primitive or asset.get('id', 'asset')}", secondary, 0.58)
    z_offset = slot * 0.08

    imported = import_model_asset(
        asset,
        (cx, cy, 0.08 + z_offset),
        (max(rw * 0.45, 0.7), max(rh * 0.45, 0.7), 0.8),
        mat,
        f"room-{index}-slot-{slot}"
    ) if allow_imported else None
    if imported:
        return

    if primitive == "sofa" or (not primitive and room_type == "living"):
        add_cube(f"sofa-seat-{index}-{slot}", (cx - rw * 0.18, cy, 0.32 + z_offset), (max(rw * 0.42, 0.9), 0.45, 0.34), mat)
        add_cube(f"sofa-back-{index}-{slot}", (cx - rw * 0.18, cy + 0.24, 0.58 + z_offset), (max(rw * 0.42, 0.9), 0.12, 0.48), secondary_mat)
        return
    if primitive == "coffee-table":
        add_cube(f"coffee-table-{index}-{slot}", (cx + rw * 0.22, cy, 0.18 + z_offset), (0.65, 0.38, 0.16), mat)
        return
    if primitive == "tv-console":
        add_cube(f"tv-console-{index}-{slot}", (cx, cy + rh * 0.38, 0.26 + z_offset), (max(rw * 0.62, 0.9), 0.22, 0.32), mat)
        add_cube(f"tv-screen-{index}-{slot}", (cx, cy + rh * 0.48, 0.78 + z_offset), (0.92, 0.05, 0.48), secondary_mat)
        return
    if primitive == "dining-table":
        add_cylinder(f"dining-table-top-{index}-{slot}", (cx, cy, 0.38 + z_offset), 0.44, 0.10, mat)
        add_cylinder(f"dining-table-leg-{index}-{slot}", (cx, cy, 0.20 + z_offset), 0.08, 0.36, secondary_mat, 24)
        return
    if primitive == "dining-chair":
        for chair_index, (dx, dy) in enumerate([(0, 0.64), (0, -0.64), (0.64, 0), (-0.64, 0)]):
            add_cube(f"dining-chair-{index}-{slot}-{chair_index}", (cx + dx, cy + dy, 0.28 + z_offset), (0.28, 0.28, 0.30), mat)
        return
    if primitive == "bed" or (not primitive and room_type == "bedroom"):
        add_cube(f"bed-base-{index}-{slot}", (cx, cy, 0.24 + z_offset), (max(rw * 0.50, 0.9), max(rh * 0.42, 0.75), 0.28), mat)
        add_cube(f"bed-headboard-{index}-{slot}", (cx, cy + rh * 0.24, 0.58 + z_offset), (max(rw * 0.50, 0.9), 0.10, 0.58), secondary_mat)
        return
    if primitive == "wardrobe":
        add_cube(f"wardrobe-{index}-{slot}", (cx + rw * 0.32, cy, 0.75 + z_offset), (0.34, max(rh * 0.72, 0.9), 1.45), mat)
        return
    if primitive == "kitchen-cabinet" or (not primitive and room_type == "kitchen"):
        add_cube(f"kitchen-base-cabinet-{index}-{slot}", (cx, cy - rh * 0.30, 0.42 + z_offset), (max(rw * 0.72, 0.9), 0.34, 0.84), mat)
        add_cube(f"kitchen-upper-cabinet-{index}-{slot}", (cx, cy - rh * 0.36, 1.12 + z_offset), (max(rw * 0.62, 0.75), 0.26, 0.38), secondary_mat)
        return
    if primitive == "refrigerator":
        add_cube(f"refrigerator-body-{index}-{slot}", (cx + rw * 0.34, cy - rh * 0.24, 0.78 + z_offset), (0.42, 0.34, 1.36), mat)
        add_cube(f"refrigerator-handle-{index}-{slot}", (cx + rw * 0.52, cy - rh * 0.42, 0.84 + z_offset), (0.03, 0.04, 0.72), secondary_mat)
        return
    if primitive == "range-hood":
        add_cube(f"range-hood-canopy-{index}-{slot}", (cx, cy - rh * 0.40, 1.18 + z_offset), (0.58, 0.22, 0.18), mat)
        add_cube(f"range-hood-chimney-{index}-{slot}", (cx, cy - rh * 0.43, 1.42 + z_offset), (0.22, 0.16, 0.34), secondary_mat)
        return
    if primitive == "washing-machine":
        add_cube(f"washing-machine-body-{index}-{slot}", (cx + rw * 0.30, cy - rh * 0.26, 0.38 + z_offset), (0.44, 0.38, 0.72), mat)
        add_cylinder(f"washing-machine-door-{index}-{slot}", (cx + rw * 0.30, cy - rh * 0.46, 0.42 + z_offset), 0.14, 0.035, secondary_mat, 32)
        return
    if primitive == "mirror-cabinet":
        add_cube(f"mirror-cabinet-{index}-{slot}", (cx, cy + 0.26, 1.12 + z_offset), (0.58, 0.05, 0.46), secondary_mat)
        add_cube(f"mirror-cabinet-shelf-{index}-{slot}", (cx, cy + 0.22, 0.84 + z_offset), (0.62, 0.18, 0.08), mat)
        return
    if primitive == "bathroom-vanity" or (not primitive and room_type == "bathroom"):
        add_cube(f"vanity-{index}-{slot}", (cx, cy, 0.35 + z_offset), (0.58, 0.42, 0.70), mat)
        add_cube(f"mirror-{index}-{slot}", (cx, cy + 0.24, 1.02 + z_offset), (0.52, 0.04, 0.48), secondary_mat)
        return
    if primitive == "toilet":
        add_cylinder(f"toilet-bowl-{index}-{slot}", (cx - 0.36, cy, 0.28 + z_offset), 0.18, 0.28, mat, 32)
        add_cube(f"toilet-tank-{index}-{slot}", (cx - 0.36, cy + 0.18, 0.62 + z_offset), (0.34, 0.12, 0.34), mat)
        return
    if primitive == "glass-partition":
        glass = make_mat(f"glass-{index}-{slot}", color, 0.08)
        glass.blend_method = "BLEND"
        bsdf = glass.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Alpha"].default_value = float(asset_prop(asset, "alpha", 0.35))
        add_cube(f"shower-glass-{index}-{slot}", (cx + 0.32, cy, 0.78 + z_offset), (0.04, max(rh * 0.46, 0.7), 1.34), glass)
        return
    if primitive == "rug":
        add_cube(f"rug-{index}-{slot}", (cx, cy, 0.07 + z_offset), (max(rw * 0.55, 0.9), max(rh * 0.36, 0.7), 0.03), mat)
        return
    if primitive == "curtain":
        add_cube(f"curtain-{index}-{slot}", (cx - rw * 0.44, cy + rh * 0.48, 0.86 + z_offset), (0.10, max(rh * 0.48, 0.8), 1.18), mat)
        return
    if primitive == "plant-set":
        add_cylinder(f"plant-pot-{index}-{slot}", (cx + rw * 0.34, cy - rh * 0.28, 0.18 + z_offset), 0.16, 0.28, secondary_mat, 24)
        add_cylinder(f"plant-crown-{index}-{slot}", (cx + rw * 0.34, cy - rh * 0.28, 0.52 + z_offset), 0.26, 0.34, mat, 24)
        return
    add_cube(f"generic-asset-{index}-{slot}", (cx, cy, 0.26 + z_offset), (0.5, 0.5, 0.34), mat)


def add_room_furniture(room, box, bounds, mats, index, allow_imported=True):
    assets = room_assets(room)
    selected = [
        assets.get("furniture"),
        *assets.get("supporting_furniture", []),
        assets.get("cabinet"),
        *assets.get("appliance", []),
        *assets.get("soft_decor", []),
        *assets.get("sanitary", []),
        *assets.get("extra", [])
    ]
    selected = [asset for asset in selected if asset]
    if not selected:
        selected = [{"id": f"default-{room.get('type', 'space')}", "properties": {"blenderPrimitive": "", "color": "#8b8791"}}]

    for slot, asset in enumerate(selected[:6]):
        add_asset_primitive(asset, room, box, bounds, mats, index, slot, allow_imported)


def add_room_light(room, box, bounds, index):
    asset = room_assets(room).get("lighting")
    color = hex_to_rgba(asset_prop(asset, "color"), (1.0, 0.96, 0.86, 1))
    secondary = hex_to_rgba(asset_prop(asset, "secondaryColor"), (0.18, 0.18, 0.18, 1))
    intensity = float(asset_prop(asset, "intensity", 0.8) or 0.8)
    primitive = asset_prop(asset, "blenderPrimitive", "")
    cx, cy = normalize_point(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, bounds)
    fixture_mat = make_mat(f"light-fixture-{index}", secondary, 0.42)
    glow_mat = make_mat(f"light-glow-{index}", color, 0.18)
    if primitive == "pendant-light":
        add_cylinder(f"pendant-cord-{index}", (cx, cy, 1.28), 0.015, 0.42, fixture_mat, 16)
        add_cylinder(f"pendant-shade-{index}", (cx, cy, 1.06), 0.20, 0.16, glow_mat, 32)
    elif primitive == "area-light":
        add_cube(f"linear-light-track-{index}", (cx, cy, 1.50), (0.92, 0.06, 0.04), fixture_mat)
        add_cube(f"linear-light-glow-{index}", (cx, cy, 1.46), (0.74, 0.035, 0.025), glow_mat)
    bpy.ops.object.light_add(type="POINT", location=(cx, cy, 1.42))
    light = bpy.context.object
    light.name = f"room-light-{index}"
    light.data.energy = 80 * intensity
    light.data.color = color[:3]


def build_scene(plan, mode="effect"):
    clear_scene()
    rooms = collect_rooms(plan)
    bounds = scene_bounds(rooms)
    scale = 0.025
    scene_w = bounds["width"] * scale
    scene_h = bounds["height"] * scale

    mats = {
        "wall": make_mat("warm matte wall", (0.88, 0.84, 0.77, 1), 0.75),
        "wood": make_mat("oak wood", (0.62, 0.42, 0.22, 1), 0.48),
        "sofa": make_mat("linen sofa", (0.23, 0.36, 0.32, 1), 0.68),
        "cabinet": make_mat("kitchen cabinet", (0.86, 0.88, 0.84, 1), 0.42),
        "ceramic": make_mat("ceramic", (0.82, 0.91, 0.92, 1), 0.36),
        "bed": make_mat("soft upholstery", (0.54, 0.47, 0.64, 1), 0.72),
        "ceiling": make_mat("ceiling white", (0.96, 0.94, 0.90, 1), 0.82),
        "door_cutout": make_mat("door opening shadow", (0.10, 0.07, 0.04, 1), 0.9),
        "door_panel": make_mat("warm wood door", (0.58, 0.32, 0.12, 1), 0.48),
        "window_cutout": make_mat("window opening shadow", (0.04, 0.10, 0.13, 1), 0.82),
        "window_glass": make_mat("pale blue glass", (0.48, 0.86, 0.95, 0.55), 0.12),
    }
    mats["window_glass"].blend_method = "BLEND"
    glass_bsdf = mats["window_glass"].node_tree.nodes.get("Principled BSDF")
    if glass_bsdf:
        glass_bsdf.inputs["Alpha"].default_value = 0.52

    for index, room in enumerate(rooms):
        box = room_bounds(room)
        x, y = normalize_point(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, bounds, scale)
        w = box["width"] * scale
        h = box["height"] * scale
        assets = room_assets(room)
        wall_asset = assets.get("wall")
        floor_asset = assets.get("floor")
        floor_mat = make_texture_mat(
            f"room-floor-{index}-{room.get('type', 'space')}",
            floor_asset,
            hex_to_rgba(asset_prop(floor_asset, "color"), ROOM_COLORS.get(room.get("type"), ROOM_COLORS["space"])),
            float(asset_prop(floor_asset, "roughness", 0.62) or 0.62)
        )
        wall_mat = make_texture_mat(
            f"room-wall-{index}-{room.get('type', 'space')}",
            wall_asset,
            hex_to_rgba(asset_prop(wall_asset, "color"), (0.88, 0.84, 0.77, 1)),
            float(asset_prop(wall_asset, "roughness", 0.75) or 0.75)
        )
        add_cube(f"floor-{room.get('id', index)}", (x, y, 0), (w, h, 0.045), floor_mat)
        openings = room_openings(plan, box)
        for side in ["north", "south", "east", "west"]:
            add_room_wall(side, index, (x, y), (w, h), openings, bounds, wall_mat)
        add_room_furniture(room, box, bounds, mats, index, mode != "panorama")
        add_room_light(room, box, bounds, index)

        if os.environ.get("AIINHOUSE_BLENDER_LABELS") == "true":
          add_label(f"label-{index}", room.get("name", room.get("id", f"room-{index}")), (x, y, 0.08))

    opening_count = add_plan_openings(plan, rooms, bounds, mats)
    if mode == "panorama":
        add_cube("ceiling-slab", (scene_w / 2, scene_h / 2, 2.72), (scene_w + 0.6, scene_h + 0.6, 0.04), mats["ceiling"])

    bpy.ops.object.light_add(type="AREA", location=(scene_w / 2, scene_h / 2, 5.2))
    light = bpy.context.object
    light.name = "large softbox"
    light.data.energy = 720
    light.data.size = max(scene_w, scene_h, 4)

    bpy.ops.object.camera_add(location=(scene_w / 2, -scene_h * 0.35, max(scene_w, scene_h) * 1.15 + 3.2))
    camera = bpy.context.object
    camera.name = "effect camera"
    bpy.context.scene.camera = camera
    camera.data.lens = 24
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(scene_w, scene_h) * 1.24
    aim_camera_at(camera, (scene_w / 2, scene_h / 2, 0.2))

    living_types = {"living", "living_room", "living-room", "客厅"}
    hero_room = next((room for room in rooms if str(room.get("type", "")).lower() in living_types or "客厅" in str(room.get("name", ""))), None)
    if hero_room is None and rooms:
        hero_room = max(rooms, key=lambda room: room_bounds(room)["width"] * room_bounds(room)["height"])
    hero_box = room_bounds(hero_room) if hero_room else {"x": bounds["min_x"], "y": bounds["min_y"], "width": bounds["width"], "height": bounds["height"]}
    hero_x, hero_y = normalize_point(hero_box["x"] + hero_box["width"] * 0.72, hero_box["y"] + hero_box["height"] * 0.28, bounds, scale)

    return {"width": scene_w, "height": scene_h, "rooms": len(rooms), "openings": opening_count, "hero_x": hero_x, "hero_y": hero_y}


def aim_camera_at(camera, target):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_render(width, height):
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = int(os.environ.get("AIINHOUSE_BLENDER_SAMPLES", "64"))
    bpy.context.scene.render.resolution_x = width
    bpy.context.scene.render.resolution_y = height
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.world.color = (0.78, 0.84, 0.90)


def render_effect(plan, output_dir):
    info = build_scene(plan, "effect")
    setup_render(1600, 1000)
    output = Path(output_dir) / "effect-blender.png"
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    return {
        "effectImage": output.name,
        "renderImage": output.name,
        "sceneInfo": info,
    }


def render_panorama(plan, output_dir):
    info = build_scene(plan, "panorama")
    scene_w = max(info["width"], 1)
    scene_h = max(info["height"], 1)
    camera_x = info.get("hero_x", scene_w / 2)
    camera_y = info.get("hero_y", scene_h / 2)
    bpy.ops.object.camera_add(location=(camera_x, camera_y, 1.58))
    camera = bpy.context.object
    camera.name = "equirectangular panorama camera"
    bpy.context.scene.camera = camera
    camera.data.type = "PANO"
    camera.data.panorama_type = "EQUIRECTANGULAR"
    aim_camera_at(camera, (camera_x + 0.1, camera_y, 1.48))
    setup_render(2048, 1024)
    output = Path(output_dir) / "panorama-blender.png"
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    return {
        "panoramaImage": output.name,
        "equirectangularImage": output.name,
        "sceneInfo": info,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["effect", "panorama"], required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    script_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(script_args)

    plan = read_json(args.plan, {})
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.mode == "effect":
        output = render_effect(plan, output_dir)
    else:
        output = render_panorama(plan, output_dir)

    result = {
        "output": output,
        "summary": {
            "provider": "blender",
            "mode": args.mode,
            "rooms": output.get("sceneInfo", {}).get("rooms", 0),
        },
    }
    Path(output_dir / "blender-render-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
