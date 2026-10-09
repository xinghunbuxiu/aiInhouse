import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { annotatePreprocessingWithAssets } = require('../codex-worker/src/assets/recognition-matcher.js');

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
}

function getFileSize(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

function getImageMeta(filePath) {
  const output = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath]);
  if (output.status !== 0) {
    return { width: 0, height: 0 };
  }

  const widthMatch = output.stdout.match(/pixelWidth:\s+(\d+)/);
  const heightMatch = output.stdout.match(/pixelHeight:\s+(\d+)/);
  return {
    width: widthMatch ? Number(widthMatch[1]) : 0,
    height: heightMatch ? Number(heightMatch[1]) : 0
  };
}

function buildCompressedImage(sourcePath, outputDir) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      preprocessedImagePath: '',
      operations: ['missing-source']
    };
  }

  const targetFile = path.join(outputDir, 'recognition-input.jpg');
  const beforeSize = getFileSize(sourcePath);
  const metaBefore = getImageMeta(sourcePath);
  const result = run('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '75',
    '-Z', '1400',
    sourcePath,
    '--out', targetFile
  ]);

  if (result.status !== 0) {
    return {
      preprocessedImagePath: sourcePath,
      operations: ['sips-failed-use-source'],
      beforeSizeBytes: beforeSize,
      afterSizeBytes: beforeSize,
      beforeWidth: metaBefore.width,
      beforeHeight: metaBefore.height,
      afterWidth: metaBefore.width,
      afterHeight: metaBefore.height
    };
  }

  const metaAfter = getImageMeta(targetFile);
  return {
    preprocessedImagePath: targetFile,
    operations: ['resize-max-1400', 'convert-jpeg', 'jpeg-quality-75'],
    beforeSizeBytes: beforeSize,
    afterSizeBytes: getFileSize(targetFile),
    beforeWidth: metaBefore.width,
    beforeHeight: metaBefore.height,
    afterWidth: metaAfter.width,
    afterHeight: metaAfter.height
  };
}

function runPythonVision(sourcePath, outputDir) {
  const script = `
import json, math, sys
try:
    import cv2
    import numpy as np
except Exception as exc:
    print(json.dumps({"available": False, "error": str(exc)}))
    sys.exit(0)

image_path, output_dir = sys.argv[1], sys.argv[2]
image = cv2.imread(image_path)
if image is None:
    print(json.dumps({"available": False, "error": "image_read_failed"}))
    sys.exit(0)

h, w = image.shape[:2]
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (3, 3), 0)
binary = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 12)
_, dark_binary = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY_INV)
_, very_dark_binary = cv2.threshold(gray, 95, 255, cv2.THRESH_BINARY_INV)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
dark_closed = cv2.morphologyEx(dark_binary, cv2.MORPH_CLOSE, kernel, iterations=1)
very_dark_closed = cv2.morphologyEx(very_dark_binary, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)), iterations=1)
structural_horizontal = cv2.morphologyEx(very_dark_closed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(34, w // 36), 7)), iterations=1)
structural_vertical = cv2.morphologyEx(very_dark_closed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (7, max(34, h // 36))), iterations=1)
structural_wall_seed = cv2.bitwise_or(structural_horizontal, structural_vertical)
structural_wall_seed = cv2.morphologyEx(structural_wall_seed, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)), iterations=1)
edges = cv2.Canny(blur, 50, 150, apertureSize=3)
lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=70, minLineLength=max(30, min(w, h) // 18), maxLineGap=10)

line_items = []
if lines is not None:
    for i, line in enumerate(lines[:160]):
        x1, y1, x2, y2 = [int(v) for v in line[0]]
        length = math.hypot(x2 - x1, y2 - y1)
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        if length < 20:
            continue
        orientation = "horizontal" if abs(angle) < 12 or abs(abs(angle) - 180) < 12 else ("vertical" if abs(abs(angle) - 90) < 12 else "diagonal")
        line_items.append({
            "id": "line-%d" % (i + 1),
            "start": {"x": x1, "y": y1},
            "end": {"x": x2, "y": y2},
            "length": round(length, 2),
            "angle": round(angle, 2),
            "orientation": orientation,
            "source": "hough-edge",
            "confidence": round(0.58 + min(0.22, length / max(w, h) * 0.35), 3)
        })

def extract_axis_candidates(mask, orientation):
    if orientation == "horizontal":
        kernel_size = (max(24, w // 28), 5)
    else:
        kernel_size = (5, max(24, h // 28))
    axis_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, kernel_size)
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, axis_kernel, iterations=1)
    opened = cv2.dilate(opened, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
    contours_axis, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours_axis:
        x, y, bw, bh = cv2.boundingRect(contour)
        if orientation == "horizontal":
            if bw < max(34, w // 22) or bh > max(34, h // 16):
                continue
            start = {"x": int(x), "y": int(y + bh / 2)}
            end = {"x": int(x + bw), "y": int(y + bh / 2)}
            length = bw
            thickness = bh
        else:
            if bh < max(34, h // 22) or bw > max(34, w // 16):
                continue
            start = {"x": int(x + bw / 2), "y": int(y)}
            end = {"x": int(x + bw / 2), "y": int(y + bh)}
            length = bh
            thickness = bw
        candidates.append({
            "start": start,
            "end": end,
            "length": round(float(length), 2),
            "angle": 0 if orientation == "horizontal" else 90,
            "orientation": orientation,
            "source": "morphology-wall-band",
            "thickness": int(max(6, thickness)),
            "confidence": round(0.68 + min(0.22, length / max(w, h) * 0.32), 3)
        })
    return candidates

def candidate_span(candidate):
    if candidate["orientation"] == "horizontal":
        fixed = (candidate["start"]["y"] + candidate["end"]["y"]) / 2
        start = min(candidate["start"]["x"], candidate["end"]["x"])
        end = max(candidate["start"]["x"], candidate["end"]["x"])
    else:
        fixed = (candidate["start"]["x"] + candidate["end"]["x"]) / 2
        start = min(candidate["start"]["y"], candidate["end"]["y"])
        end = max(candidate["start"]["y"], candidate["end"]["y"])
    return fixed, start, end

def candidate_axis_key(candidate):
    fixed, start, end = candidate_span(candidate)
    return candidate["orientation"], round(fixed / 6) * 6, round(start / 6) * 6, round(end / 6) * 6

def candidates_overlap(a, b):
    if a["orientation"] != b["orientation"]:
        return False
    fixed_a, start_a, end_a = candidate_span(a)
    fixed_b, start_b, end_b = candidate_span(b)
    if abs(fixed_a - fixed_b) > 8:
        return False
    overlap = max(0, min(end_a, end_b) - max(start_a, start_b))
    shorter = max(1, min(end_a - start_a, end_b - start_b))
    return overlap / shorter >= 0.82

def merge_axis_candidates(candidates):
    merged = []
    for candidate in sorted(candidates, key=lambda item: (item.get("wallSeed") != "structural", -item.get("length", 0))):
        duplicate_index = None
        for index, existing in enumerate(merged):
            if candidates_overlap(candidate, existing):
                duplicate_index = index
                break
        if duplicate_index is None:
            merged.append(candidate)
            continue
        existing = merged[duplicate_index]
        candidate_score = candidate.get("confidence", 0) + (0.08 if candidate.get("wallSeed") == "structural" else 0) + min(0.08, candidate.get("thickness", 0) / 180)
        existing_score = existing.get("confidence", 0) + (0.08 if existing.get("wallSeed") == "structural" else 0) + min(0.08, existing.get("thickness", 0) / 180)
        if candidate_score > existing_score:
            merged[duplicate_index] = {
                **candidate,
                "mergedWallSeeds": sorted(set([candidate.get("wallSeed", ""), existing.get("wallSeed", "")]) - set([""]))
            }
        else:
            existing["mergedWallSeeds"] = sorted(set(existing.get("mergedWallSeeds", []) + [candidate.get("wallSeed", "")]) - set([""]))
    return merged

strict_axis_candidates = extract_axis_candidates(structural_wall_seed, "horizontal") + extract_axis_candidates(structural_wall_seed, "vertical")
for candidate in strict_axis_candidates:
    candidate["wallSeed"] = "structural"

loose_axis_candidates = extract_axis_candidates(closed, "horizontal") + extract_axis_candidates(closed, "vertical")
for candidate in loose_axis_candidates:
    candidate["wallSeed"] = "adaptive-line"

axis_candidates = merge_axis_candidates(strict_axis_candidates + loose_axis_candidates)

def line_tone_stats(line):
    mask = np.zeros_like(gray)
    thickness = max(3, int(line.get("thickness", 6)) + 2)
    cv2.line(mask, (line["start"]["x"], line["start"]["y"]), (line["end"]["x"], line["end"]["y"]), 255, thickness)
    values = gray[mask > 0]
    if values.size == 0:
        return {"meanGray": 255, "darkRatio": 0, "veryDarkRatio": 0}
    return {
        "meanGray": round(float(values.mean()), 2),
        "darkRatio": round(float(np.count_nonzero(values < 150) / values.size), 3),
        "veryDarkRatio": round(float(np.count_nonzero(values < 95) / values.size), 3)
    }

def text_like_component_count_near_line(line):
    fixed, start, end = normalized_span(line)
    count = 0
    components, labels, stats, _ = cv2.connectedComponentsWithStats(very_dark_binary, 8)
    for label in range(1, components):
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        bw = int(stats[label, cv2.CC_STAT_WIDTH])
        bh = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < 8 or area > 1200 or bw < 2 or bh < 8 or bw > 70 or bh > 58:
            continue
        cx = x + bw / 2
        cy = y + bh / 2
        if line["orientation"] == "horizontal":
            along = cx
            distance = abs(cy - fixed)
        else:
            along = cy
            distance = abs(cx - fixed)
        if start - 18 <= along <= end + 18 and 10 <= distance <= 58:
            count += 1
    return count

def normalized_span(line):
    if line["orientation"] == "horizontal":
        fixed = (line["start"]["y"] + line["end"]["y"]) / 2
        start = min(line["start"]["x"], line["end"]["x"])
        end = max(line["start"]["x"], line["end"]["x"])
    else:
        fixed = (line["start"]["x"] + line["end"]["x"]) / 2
        start = min(line["start"]["y"], line["end"]["y"])
        end = max(line["start"]["y"], line["end"]["y"])
    return fixed, start, end

def perpendicular_intersections(line, candidates, tolerance=16):
    fixed, start, end = normalized_span(line)
    intersections = []
    for other in candidates:
        if other is line or other["orientation"] == line["orientation"]:
            continue
        other_fixed, other_start, other_end = normalized_span(other)
        if start - tolerance <= other_fixed <= end + tolerance and other_start - tolerance <= fixed <= other_end + tolerance:
            intersections.append({
                "x": other_fixed if line["orientation"] == "horizontal" else fixed,
                "y": fixed if line["orientation"] == "horizontal" else other_fixed,
                "otherLength": other.get("length", other_end - other_start),
                "otherThickness": other.get("thickness", 0)
            })
    return intersections

def classify_wall_candidate(line, candidates):
    fixed, start, end = normalized_span(line)
    length = line.get("length", end - start)
    thickness = line.get("thickness", 0)
    tone = line_tone_stats(line)
    nearby_text_count = text_like_component_count_near_line(line)
    intersections = perpendicular_intersections(line, candidates)
    endpoint_hits = 0
    short_tick_hits = 0
    for hit in intersections:
        along = hit["x"] if line["orientation"] == "horizontal" else hit["y"]
        if abs(along - start) <= 28 or abs(along - end) <= 28:
            endpoint_hits += 1
        if hit.get("otherLength", 9999) <= min(w, h) * 0.13 and hit.get("otherThickness", 0) <= 10:
            short_tick_hits += 1

    reasons = []
    is_thick_enough = thickness >= 7
    has_network_evidence = len(intersections) >= 2 or endpoint_hits >= 1
    is_major_span = length >= min(w, h) * 0.28 and len(intersections) >= 1
    is_light_thin_line = thickness <= 8 and tone["darkRatio"] < 0.42 and tone["veryDarkRatio"] < 0.22
    is_dimension_chain = thickness <= 10 and len(intersections) >= 2 and short_tick_hits >= max(2, len(intersections) * 0.55)
    is_dimension_with_text = thickness <= 10 and nearby_text_count >= 2 and line["orientation"] == "horizontal"
    if not is_thick_enough:
        reasons.append("too-thin-for-wall-band")
    if is_light_thin_line:
        reasons.append("light-thin-dimension-or-guide-line")
    if is_dimension_chain:
        reasons.append("dimension-chain-with-short-tick-intersections")
    if is_dimension_with_text:
        reasons.append("dimension-line-near-number-text")
    if not has_network_evidence and not is_major_span:
        reasons.append("isolated-line-no-wall-intersection")
    if length < max(42, min(w, h) // 20):
        reasons.append("too-short-for-structural-wall")

    return {
        "isWall": not reasons,
        "intersectionCount": len(intersections),
        "endpointIntersectionCount": endpoint_hits,
        "shortTickIntersectionCount": short_tick_hits,
        "nearbyTextComponentCount": nearby_text_count,
        "tone": tone,
        "reasons": reasons
    }

def structural_wall_vectors(mask):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    vectors = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < max(420, w * h * 0.00028):
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        if bw < 10 or bh < 10:
            continue
        epsilon = max(2.0, cv2.arcLength(contour, True) * 0.01)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        points = [{"x": int(point[0][0]), "y": int(point[0][1])} for point in approx]
        vectors.append({
            "id": "structural-wall-%d" % (len(vectors) + 1),
            "x": int(x),
            "y": int(y),
            "width": int(bw),
            "height": int(bh),
            "area": round(area, 2),
            "polygon": points,
            "confidence": 0.86 if area > 4000 else 0.72,
            "source": "deep-black-structural-wall-mask"
        })
    return sorted(vectors, key=lambda item: item["area"], reverse=True)

def detect_balcony_candidates():
    light_line = cv2.inRange(gray, 105, 218)
    line_seed = cv2.bitwise_or(light_line, dark_binary)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(28, w // 42), 3))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, max(28, h // 42)))
    thin_h = cv2.morphologyEx(line_seed, cv2.MORPH_OPEN, h_kernel, iterations=1)
    thin_v = cv2.morphologyEx(line_seed, cv2.MORPH_OPEN, v_kernel, iterations=1)
    thin_outline = cv2.bitwise_or(thin_h, thin_v)
    thin_outline = cv2.morphologyEx(thin_outline, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 13)), iterations=1)
    contours_balcony, _ = cv2.findContours(thin_outline, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    wall_mask = structural_wall_seed
    def correct_with_long_vertical_outline(candidate):
        cx, cy, cbw, cbh = candidate["x"], candidate["y"], candidate["width"], candidate["height"]
        edge_verticals = []
        supporting_horizontals = []
        for line in line_items:
            if line.get("orientation") != "vertical":
                lx = None
                ly1 = None
                ly2 = None
            else:
                lx = (line["start"]["x"] + line["end"]["x"]) / 2
                ly1 = min(line["start"]["y"], line["end"]["y"])
                ly2 = max(line["start"]["y"], line["end"]["y"])
                length = ly2 - ly1
                near_left_or_right_edge = abs(lx - cx) <= 26 or abs(lx - (cx + cbw)) <= 26
                overlaps_x_band = cx - 28 <= lx <= cx + cbw + 28
                extends_below_candidate = ly2 >= cy + cbh + max(42, cbh * 0.34)
                starts_inside_or_below = ly1 >= cy + cbh * 0.18
                lower_extension = ly2 - (cy + cbh)
                if near_left_or_right_edge and overlaps_x_band and extends_below_candidate and starts_inside_or_below and length >= cbh * 1.18 and lower_extension <= max(220, cbh * 1.25):
                    edge_verticals.append((length, lx, ly1, ly2, line.get("id", "")))
                continue
        for line in line_items:
            if line.get("orientation") != "horizontal":
                continue
            hy = (line["start"]["y"] + line["end"]["y"]) / 2
            hx1 = min(line["start"]["x"], line["end"]["x"])
            hx2 = max(line["start"]["x"], line["end"]["x"])
            length = hx2 - hx1
            overlaps_y_band = cy - 28 <= hy <= cy + cbh + 28
            near_bottom = abs(hy - (cy + cbh)) <= 22
            if overlaps_y_band and near_bottom and length >= cbw * 0.42:
                supporting_horizontals.append((length, hy, hx1, hx2, line.get("id", "")))
        if not edge_verticals:
            return candidate
        edge_verticals.sort(reverse=True)
        if not supporting_horizontals:
            return candidate
        edge_verticals.sort(key=lambda item: (item[3], item[0]))
        length, lx, ly1, ly2, line_id = edge_verticals[0]
        supporting_horizontals.sort(reverse=True)
        _, hy, hx1, hx2, hline_id = supporting_horizontals[0]
        corrected = dict(candidate)
        if abs(lx - cx) <= abs(lx - (cx + cbw)):
            corrected["x"] = int(min(cx, max(0, round(lx))))
            corrected_right = cx + cbw
        else:
            corrected["x"] = int(cx)
            corrected_right = max(cx + cbw, round(lx))
        corrected["y"] = int(min(ly1, hy))
        corrected["width"] = int(max(cbw, round(corrected_right - corrected["x"])))
        corrected["height"] = int(max(cbh, round(ly2 - corrected["y"])))
        corrected["area"] = int(corrected["width"] * corrected["height"])
        corrected["aspectRatio"] = round(corrected["width"] / max(corrected["height"], 1), 3)
        corrected["outlineCorrection"] = {
            "source": "long-vertical-balcony-outline",
            "lineId": line_id,
            "supportingHorizontalLineId": hline_id,
            "original": {"x": int(cx), "y": int(cy), "width": int(cbw), "height": int(cbh)}
        }
        return corrected

    for contour in contours_balcony:
        x, y, bw, bh = cv2.boundingRect(contour)
        area = bw * bh
        if bw < 70 or bh < 90 or area < 9000 or area > w * h * 0.16:
            continue
        aspect = bw / max(bh, 1)
        if aspect < 0.28 or aspect > 2.8:
            continue
        roi = thin_outline[y:y+bh, x:x+bw]
        density = float(cv2.countNonZero(roi)) / max(area, 1)
        if density < 0.035:
            continue
        pad = 16
        near_wall_roi = wall_mask[max(0, y-pad):min(h, y+bh+pad), max(0, x-pad):min(w, x+bw+pad)]
        near_wall = cv2.countNonZero(near_wall_roi) > 120
        near_image_edge = x < w * 0.18 or x + bw > w * 0.82 or y < h * 0.18 or y + bh > h * 0.82
        if not near_wall and not near_image_edge:
            continue
        interior = closed[y:y+bh, x:x+bw]
        interior_density = float(cv2.countNonZero(interior)) / max(area, 1)
        confidence = 0.58 + min(0.2, density * 1.8) + (0.1 if near_wall else 0) + (0.06 if near_image_edge else 0)
        candidate = {
            "id": "balcony-candidate-%d" % (len(candidates) + 1),
            "type": "balcony",
            "x": int(x),
            "y": int(y),
            "width": int(bw),
            "height": int(bh),
            "area": int(area),
            "aspectRatio": round(aspect, 3),
            "lineDensity": round(density, 4),
            "interiorLineDensity": round(interior_density, 4),
            "nearStructuralWall": bool(near_wall),
            "nearImageEdge": bool(near_image_edge),
            "confidence": round(min(0.84, confidence), 3),
            "source": "thin-outline-balcony-candidate"
        }
        candidates.append(correct_with_long_vertical_outline(candidate))
    return sorted(candidates, key=lambda item: item["confidence"], reverse=True)[:8], thin_outline

filtered_axis_candidates = []
rejected_axis_candidates = []
for candidate in axis_candidates:
    classification = classify_wall_candidate(candidate, axis_candidates)
    candidate["wallEvidence"] = {
        "intersectionCount": classification["intersectionCount"],
        "endpointIntersectionCount": classification["endpointIntersectionCount"],
        "shortTickIntersectionCount": classification["shortTickIntersectionCount"],
        "nearbyTextComponentCount": classification["nearbyTextComponentCount"],
        "tone": classification["tone"]
    }
    if classification["isWall"]:
        filtered_axis_candidates.append(candidate)
    else:
        rejected = dict(candidate)
        rejected["wallRejectReasons"] = classification["reasons"]
        can_support_grid = (
            candidate.get("wallSeed") in ["adaptive-line", "structural"]
            and candidate.get("length", 0) >= max(44, min(w, h) // 22)
            and "dimension-chain-with-short-tick-intersections" not in classification["reasons"]
            and "dimension-line-near-number-text" not in classification["reasons"]
        )
        rejected["source"] = "wall-grid-support-line" if can_support_grid else "annotation-line-candidate"
        rejected_axis_candidates.append(rejected)

for i, candidate in enumerate(filtered_axis_candidates[:180]):
    candidate["id"] = "wall-band-%d" % (i + 1)
    line_items.append(candidate)
for i, candidate in enumerate(rejected_axis_candidates[:80]):
    candidate["id"] = ("support-line-%d" if candidate.get("source") == "wall-grid-support-line" else "annotation-line-%d") % (i + 1)
    line_items.append(candidate)

line_items = sorted(line_items, key=lambda item: (item.get("source") != "morphology-wall-band", item.get("source") == "annotation-line-candidate", -item.get("length", 0)))[:240]

def mask_bounds(mask, fallback_mask=None, padding=24):
    source = mask
    if cv2.countNonZero(source) < 80 and fallback_mask is not None:
        source = fallback_mask
    points = cv2.findNonZero(source)
    if points is None:
        return 0, 0, w, h
    x, y, bw, bh = cv2.boundingRect(points)
    x0 = max(0, x - padding)
    y0 = max(0, y - padding)
    x1 = min(w, x + bw + padding)
    y1 = min(h, y + bh + padding)
    return x0, y0, x1, y1

def perimeter_wall_score(mask, x, y, bw, bh):
    pad = 9
    ring = np.zeros_like(mask)
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(w, x + bw + pad)
    y1 = min(h, y + bh + pad)
    cv2.rectangle(ring, (x0, y0), (x1, y1), 255, pad * 2)
    cv2.rectangle(ring, (x + pad, y + pad), (max(x + pad + 1, x + bw - pad), max(y + pad + 1, y + bh - pad)), 0, -1)
    ring_pixels = cv2.countNonZero(ring)
    if ring_pixels <= 0:
        return 0
    return float(cv2.countNonZero(cv2.bitwise_and(mask, ring))) / ring_pixels

def detect_room_interior_candidates():
    wall_mask = cv2.dilate(structural_wall_seed, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)), iterations=1)
    for line in line_items:
        if line.get("source") not in ["morphology-wall-band", "wall-grid-support-line"]:
            continue
        thickness = max(9, int(line.get("thickness", 8)) + 6)
        cv2.line(wall_mask, (line["start"]["x"], line["start"]["y"]), (line["end"]["x"], line["end"]["y"]), 255, thickness)

    x0, y0, x1, y1 = mask_bounds(structural_wall_seed, wall_mask, padding=max(20, min(w, h) // 45))
    roi_wall = wall_mask[y0:y1, x0:x1]
    if roi_wall.size == 0:
        return [], wall_mask

    close_size = max(17, (min(w, h) // 46) | 1)
    gap_size = max(11, (min(w, h) // 70) | 1)
    blocked = cv2.dilate(roi_wall, cv2.getStructuringElement(cv2.MORPH_RECT, (gap_size, gap_size)), iterations=1)
    blocked = cv2.morphologyEx(blocked, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (close_size, close_size)), iterations=1)
    free = cv2.bitwise_not(blocked)

    flood = free.copy()
    flood_mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), np.uint8)
    seed_points = []
    step = max(10, min(flood.shape[:2]) // 24)
    for sx in range(0, flood.shape[1], step):
        seed_points.append((sx, 0))
        seed_points.append((sx, flood.shape[0] - 1))
    for sy in range(0, flood.shape[0], step):
        seed_points.append((0, sy))
        seed_points.append((flood.shape[1] - 1, sy))
    for seed in seed_points:
        if flood[seed[1], seed[0]] == 255:
            cv2.floodFill(flood, flood_mask, seed, 128)

    room_voids = np.zeros_like(flood)
    room_voids[flood == 255] = 255
    room_voids = cv2.morphologyEx(room_voids, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)), iterations=1)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(room_voids, 8)
    candidates = []
    roi_area = max(1, roi_wall.shape[0] * roi_wall.shape[1])
    min_area = max(2200, int(w * h * 0.0022))
    max_area = int(roi_area * 0.48)
    for label in range(1, count):
        lx = int(stats[label, cv2.CC_STAT_LEFT])
        ly = int(stats[label, cv2.CC_STAT_TOP])
        bw = int(stats[label, cv2.CC_STAT_WIDTH])
        bh = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        if bw < 48 or bh < 48 or area < min_area or area > max_area:
            continue
        fill_ratio = area / max(1, bw * bh)
        aspect = bw / max(1, bh)
        if fill_ratio < 0.34 or aspect < 0.22 or aspect > 4.8:
            continue
        ax = x0 + lx
        ay = y0 + ly
        edge_score = perimeter_wall_score(wall_mask, ax, ay, bw, bh)
        if edge_score < 0.055 and area < min_area * 1.8:
            continue
        confidence = 0.5 + min(0.18, fill_ratio * 0.16) + min(0.2, edge_score * 1.8) + min(0.08, area / max(w * h, 1) * 2.2)
        candidates.append({
            "id": "room-interior-%d" % (len(candidates) + 1),
            "x": int(ax),
            "y": int(ay),
            "width": int(bw),
            "height": int(bh),
            "area": int(area),
            "aspectRatio": round(aspect, 3),
            "fillRatio": round(fill_ratio, 3),
            "perimeterWallScore": round(edge_score, 3),
            "confidence": round(min(0.86, confidence), 3),
            "source": "wall-mask-room-interior"
        })

    def cluster_values(values, tolerance=18):
        values = sorted([int(value) for value in values])
        clusters = []
        for value in values:
            if not clusters or abs(value - clusters[-1][-1]) > tolerance:
                clusters.append([value])
            else:
                clusters[-1].append(value)
        return [int(round(sum(cluster) / len(cluster))) for cluster in clusters]

    def edge_coverage(orientation, fixed, start, end, tolerance=16):
        start = max(0, int(start))
        end = min(w if orientation == "horizontal" else h, int(end))
        fixed = int(fixed)
        if end <= start + 8:
            return 0
        if orientation == "horizontal":
            y_start = max(0, fixed - tolerance)
            y_end = min(h, fixed + tolerance + 1)
            roi = wall_mask[y_start:y_end, start:end]
            if roi.size == 0:
                return 0
            hits = np.count_nonzero(np.max(roi, axis=0) > 0)
            return float(hits) / max(1, end - start)
        x_start = max(0, fixed - tolerance)
        x_end = min(w, fixed + tolerance + 1)
        roi = wall_mask[start:end, x_start:x_end]
        if roi.size == 0:
            return 0
        hits = np.count_nonzero(np.max(roi, axis=1) > 0)
        return float(hits) / max(1, end - start)

    def overlap_ratio(a, b):
        ax1, ay1, ax2, ay2 = a["x"], a["y"], a["x"] + a["width"], a["y"] + a["height"]
        bx1, by1, bx2, by2 = b["x"], b["y"], b["x"] + b["width"], b["y"] + b["height"]
        overlap_w = max(0, min(ax2, bx2) - max(ax1, bx1))
        overlap_h = max(0, min(ay2, by2) - max(ay1, by1))
        smaller = max(1, min(a["width"] * a["height"], b["width"] * b["height"]))
        return (overlap_w * overlap_h) / smaller

    vertical_coords = []
    horizontal_coords = []
    for line in line_items:
        if line.get("source") not in ["morphology-wall-band", "wall-grid-support-line"]:
            continue
        if line.get("orientation") == "vertical":
            vertical_coords.append(round((line["start"]["x"] + line["end"]["x"]) / 2))
        elif line.get("orientation") == "horizontal":
            horizontal_coords.append(round((line["start"]["y"] + line["end"]["y"]) / 2))
    vertical_coords.extend([x0, x1])
    horizontal_coords.extend([y0, y1])
    xs = cluster_values(vertical_coords, tolerance=20)
    ys = cluster_values(horizontal_coords, tolerance=20)
    grid_candidates = []
    max_step = 6
    for xi in range(len(xs) - 1):
        for yi in range(len(ys) - 1):
            for xj in range(xi + 1, min(len(xs), xi + max_step + 1)):
                for yj in range(yi + 1, min(len(ys), yi + max_step + 1)):
                    rx = xs[xi]
                    ry = ys[yi]
                    rw = xs[xj] - rx
                    rh = ys[yj] - ry
                    area_rect = rw * rh
                    if rw < 58 or rh < 54 or area_rect < 3400 or area_rect > w * h * 0.24:
                        continue
                    aspect = rw / max(1, rh)
                    if aspect < 0.24 or aspect > 5.2:
                        continue
                    top = edge_coverage("horizontal", ry, rx, rx + rw)
                    bottom = edge_coverage("horizontal", ry + rh, rx, rx + rw)
                    left = edge_coverage("vertical", rx, ry, ry + rh)
                    right = edge_coverage("vertical", rx + rw, ry, ry + rh)
                    edge_scores = [top, bottom, left, right]
                    strong_edges = len([score for score in edge_scores if score >= 0.52])
                    weak_edges = len([score for score in edge_scores if score >= 0.3])
                    edge_score = sum(edge_scores) / 4
                    if strong_edges < 3 and not (weak_edges == 4 and edge_score >= 0.42):
                        continue
                    inner = wall_mask[min(h, ry + 10):max(min(h, ry + rh - 10), min(h, ry + 11)), min(w, rx + 10):max(min(w, rx + rw - 10), min(w, rx + 11))]
                    inner_density = float(cv2.countNonZero(inner)) / max(1, inner.size) if inner.size else 0
                    if inner_density > 0.34 and area_rect < w * h * 0.055:
                        continue
                    confidence = 0.48 + min(0.28, edge_score * 0.32) + strong_edges * 0.025 + min(0.08, area_rect / max(w * h, 1) * 1.9)
                    grid_candidates.append({
                        "id": "room-interior-grid-%d" % (len(grid_candidates) + 1),
                        "x": int(rx),
                        "y": int(ry),
                        "width": int(rw),
                        "height": int(rh),
                        "area": int(area_rect),
                        "aspectRatio": round(aspect, 3),
                        "fillRatio": round(max(0.01, 1 - inner_density), 3),
                        "perimeterWallScore": round(edge_score, 3),
                        "edgeScores": [round(score, 3) for score in edge_scores],
                        "strongEdges": int(strong_edges),
                        "weakEdges": int(weak_edges),
                        "confidence": round(min(0.88, confidence), 3),
                        "source": "wall-mask-grid-room"
                    })

    for candidate in sorted(grid_candidates, key=lambda item: (item["confidence"], item["perimeterWallScore"], item["area"]), reverse=True):
        if any(overlap_ratio(candidate, existing) > 0.78 for existing in candidates):
            continue
        candidates.append(candidate)
        if len(candidates) >= 18:
            break

    candidates = sorted(candidates, key=lambda item: (item["confidence"], item["area"]), reverse=True)[:16]
    debug = cv2.cvtColor(wall_mask, cv2.COLOR_GRAY2BGR)
    for candidate in candidates:
        cv2.rectangle(debug, (candidate["x"], candidate["y"]), (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]), (0, 220, 255), 3)
        cv2.putText(debug, "room %.2f" % candidate["confidence"], (candidate["x"], max(22, candidate["y"] - 7)), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 220, 255), 2, cv2.LINE_AA)
    return candidates, debug

def line_bbox(line, pad=0):
    x1 = min(line["start"]["x"], line["end"]["x"]) - pad
    y1 = min(line["start"]["y"], line["end"]["y"]) - pad
    x2 = max(line["start"]["x"], line["end"]["x"]) + pad
    y2 = max(line["start"]["y"], line["end"]["y"]) + pad
    return max(0, int(x1)), max(0, int(y1)), min(w, int(x2)), min(h, int(y2))

def overlap_1d(a1, a2, b1, b2):
    return max(0, min(a2, b2) - max(a1, b1))

def thin_line_candidates():
    raw_lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=36, minLineLength=max(22, min(w, h) // 42), maxLineGap=6)
    candidates = []
    if raw_lines is None:
        return candidates
    for raw in raw_lines[:520]:
        x1, y1, x2, y2 = [int(v) for v in raw[0]]
        length = math.hypot(x2 - x1, y2 - y1)
        if length < max(22, min(w, h) // 44) or length > max(w, h) * 0.42:
            continue
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        orientation = "horizontal" if abs(angle) < 8 or abs(abs(angle) - 180) < 8 else ("vertical" if abs(abs(angle) - 90) < 8 else "")
        if not orientation:
            continue
        line = {
            "start": {"x": x1, "y": y1},
            "end": {"x": x2, "y": y2},
            "length": round(length, 2),
            "orientation": orientation,
            "thickness": 3,
            "source": "thin-symbol-line"
        }
        tone = line_tone_stats(line)
        if tone["veryDarkRatio"] > 0.82 and length > min(w, h) * 0.12:
            continue
        line["tone"] = tone
        candidates.append(line)
    return candidates

def nearest_wall_for_symbol(candidate):
    orientation = candidate["orientation"]
    fixed = candidate["center"]["y"] if orientation == "horizontal" else candidate["center"]["x"]
    start = candidate["x"] if orientation == "horizontal" else candidate["y"]
    end = candidate["x"] + candidate["width"] if orientation == "horizontal" else candidate["y"] + candidate["height"]
    best = None
    for wall in filtered_axis_candidates:
        if wall.get("orientation") != orientation:
            continue
        wall_fixed, wall_start, wall_end = normalized_span(wall)
        distance = abs(wall_fixed - fixed)
        if distance > max(34, min(w, h) * 0.055):
            continue
        overlap = overlap_1d(start, end, wall_start, wall_end)
        overlap_ratio = overlap / max(1, min(end - start, wall_end - wall_start))
        if overlap_ratio < 0.28:
            continue
        score = overlap_ratio + max(0, 1 - distance / 46) * 0.45 + wall.get("confidence", 0.6) * 0.2
        if not best or score > best["score"]:
            best = {
                "wallCandidateId": wall.get("id", ""),
                "distance": round(float(distance), 2),
                "overlapRatio": round(float(overlap_ratio), 3),
                "score": round(float(score), 3)
            }
    return best

def detect_door_symbol_candidates():
    wall_mask = cv2.dilate(structural_wall_seed, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
    candidates = []

    def nearest_wall_for_point(point, max_distance=42):
        best = None
        for wall in filtered_axis_candidates:
            fixed, start, end = normalized_span(wall)
            if wall["orientation"] == "horizontal":
                axis = point["x"]
                distance = abs(point["y"] - fixed)
            else:
                axis = point["y"]
                distance = abs(point["x"] - fixed)
            if distance > max_distance or axis < start - 16 or axis > end + 16:
                continue
            axis_delta = 0 if start <= axis <= end else min(abs(axis - start), abs(axis - end))
            score = max(0, 1 - distance / max_distance) + max(0, 1 - axis_delta / 24) * 0.3 + wall.get("confidence", 0.6) * 0.15
            if not best or score > best["score"]:
                best = {
                    "wall": wall,
                    "fixed": fixed,
                    "axis": max(start, min(end, axis)),
                    "distance": distance,
                    "score": score
                }
        return best

    raw_leaf_lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=28, minLineLength=max(18, min(w, h) // 55), maxLineGap=5)
    if raw_leaf_lines is not None:
        for raw in raw_leaf_lines[:420]:
            x1, y1, x2, y2 = [int(v) for v in raw[0]]
            length = math.hypot(x2 - x1, y2 - y1)
            if length < max(20, min(w, h) * 0.022) or length > max(92, min(w, h) * 0.11):
                continue
            angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1)))
            acute = angle if angle <= 90 else 180 - angle
            if acute < 18 or acute > 72:
                continue
            p1 = {"x": x1, "y": y1}
            p2 = {"x": x2, "y": y2}
            wall1 = nearest_wall_for_point(p1)
            wall2 = nearest_wall_for_point(p2)
            attached = None
            hinge = None
            if wall1 and (not wall2 or wall1["score"] >= wall2["score"]):
                attached = wall1
                hinge = p1
            elif wall2:
                attached = wall2
                hinge = p2
            if not attached:
                continue
            wall = attached["wall"]
            if wall.get("orientation") == "horizontal":
                candidate_width = int(max(24, min(72, length * 0.86)))
                candidate_height = 10
                cx = attached["axis"]
                cy = attached["fixed"]
                x = int(cx - candidate_width / 2)
                y = int(cy - 12)
                bw = candidate_width
                bh = 24
            else:
                candidate_width = 10
                candidate_height = int(max(24, min(72, length * 0.86)))
                cx = attached["fixed"]
                cy = attached["axis"]
                x = int(cx - 12)
                y = int(cy - candidate_height / 2)
                bw = 24
                bh = candidate_height
            confidence = 0.54 + min(0.14, length / max(min(w, h), 1) * 1.2) + min(0.12, attached["score"] * 0.08)
            gap_len = int(max(candidate_width, candidate_height))
            door_type = "entrance" if gap_len >= 68 else "single_swing"
            candidates.append({
                "id": "door-symbol-%d" % (len(candidates) + 1),
                "type": "door",
                "doorType": door_type,
                "hasSwingArc": True,
                "x": x,
                "y": y,
                "width": bw,
                "height": bh,
                "center": {"x": round(cx, 1), "y": round(cy, 1)},
                "orientation": wall.get("orientation"),
                "gapLength": int(max(candidate_width, candidate_height)),
                "wallCandidateId": wall.get("id", ""),
                "leafLine": {"start": p1, "end": p2, "angle": round(float(angle), 1), "length": round(float(length), 1), "hinge": hinge},
                "leftSupport": 0,
                "rightSupport": 0,
                "confidence": round(min(0.82, confidence), 3),
                "source": "door-leaf-line-scanner"
            })

    if raw_leaf_lines is not None:
        for raw in raw_leaf_lines[:520]:
            x1, y1, x2, y2 = [int(v) for v in raw[0]]
            length = math.hypot(x2 - x1, y2 - y1)
            if length < max(28, min(w, h) * 0.03) or length > max(108, min(w, h) * 0.13):
                continue
            dx = abs(x2 - x1)
            dy = abs(y2 - y1)
            if dx <= 5 and dy >= 28:
                leaf_orientation = "vertical"
                expected_wall_orientation = "horizontal"
            elif dy <= 5 and dx >= 28:
                leaf_orientation = "horizontal"
                expected_wall_orientation = "vertical"
            else:
                continue

            endpoints = [{"x": x1, "y": y1}, {"x": x2, "y": y2}]
            attached = None
            hinge = None
            for point in endpoints:
                wall_hit = nearest_wall_for_point(point, max_distance=36)
                if not wall_hit:
                    continue
                if wall_hit["wall"].get("orientation") != expected_wall_orientation:
                    continue
                if not attached or wall_hit["score"] > attached["score"]:
                    attached = wall_hit
                    hinge = point
            if not attached:
                continue

            wall = attached["wall"]
            gap_len = int(max(30, min(86, length * 0.92)))
            if wall.get("orientation") == "horizontal":
                cx = attached["axis"]
                cy = attached["fixed"]
                x = int(cx - gap_len / 2)
                y = int(cy - 12)
                bw = gap_len
                bh = 24
            else:
                cx = attached["fixed"]
                cy = attached["axis"]
                x = int(cx - 12)
                y = int(cy - gap_len / 2)
                bw = 24
                bh = gap_len

            arc_roi_size = int(max(36, min(104, length * 1.2)))
            rx0 = max(0, int(hinge["x"] - arc_roi_size))
            ry0 = max(0, int(hinge["y"] - arc_roi_size))
            rx1 = min(w, int(hinge["x"] + arc_roi_size))
            ry1 = min(h, int(hinge["y"] + arc_roi_size))
            arc_roi = edges[ry0:ry1, rx0:rx1]
            arc_edge_density = float(cv2.countNonZero(arc_roi)) / max(1, arc_roi.size)
            confidence = 0.56 + min(0.12, attached["score"] * 0.08) + min(0.08, length / max(min(w, h), 1) * 1.1) + min(0.06, arc_edge_density * 4.0)
            door_type = "entrance" if gap_len >= 72 else ("double_swing" if gap_len >= 58 else "single_swing")
            candidates.append({
                "id": "door-symbol-%d" % (len(candidates) + 1),
                "type": "door",
                "doorType": door_type,
                "hasSwingArc": arc_edge_density >= 0.012,
                "x": x,
                "y": y,
                "width": bw,
                "height": bh,
                "center": {"x": round(cx, 1), "y": round(cy, 1)},
                "orientation": wall.get("orientation"),
                "gapLength": gap_len,
                "wallCandidateId": wall.get("id", ""),
                "leafLine": {
                    "start": {"x": x1, "y": y1},
                    "end": {"x": x2, "y": y2},
                    "orientation": leaf_orientation,
                    "length": round(float(length), 1),
                    "hinge": hinge,
                    "arcEdgeDensity": round(float(arc_edge_density), 4)
                },
                "leftSupport": 0,
                "rightSupport": 0,
                "confidence": round(min(0.84, confidence), 3),
                "source": "door-axis-leaf-arc-scanner"
            })

    def wall_presence_run(wall):
        fixed, start, end = normalized_span(wall)
        start = max(0, int(start))
        end = min(w if wall["orientation"] == "horizontal" else h, int(end))
        if end <= start + 36:
            return []
        half = max(4, min(14, int(wall.get("thickness", 8) / 2) + 4))
        if wall["orientation"] == "horizontal":
            y0 = max(0, int(fixed) - half)
            y1 = min(h, int(fixed) + half + 1)
            roi = wall_mask[y0:y1, start:end]
            if roi.size == 0:
                return []
            return [float(np.count_nonzero(roi[:, i])) / max(1, roi.shape[0]) for i in range(roi.shape[1])]
        x0 = max(0, int(fixed) - half)
        x1 = min(w, int(fixed) + half + 1)
        roi = wall_mask[start:end, x0:x1]
        if roi.size == 0:
            return []
        return [float(np.count_nonzero(roi[i, :])) / max(1, roi.shape[1]) for i in range(roi.shape[0])]

    def mean_presence(values, a, b):
        a = max(0, a)
        b = min(len(values), b)
        if b <= a:
            return 0
        return sum(values[a:b]) / max(1, b - a)

    for wall in filtered_axis_candidates:
        if wall.get("length", 0) < max(70, min(w, h) * 0.075):
            continue
        fixed, start, end = normalized_span(wall)
        values = wall_presence_run(wall)
        if not values:
            continue
        min_gap = max(18, int(min(w, h) * 0.018))
        max_gap = max(66, int(min(w, h) * 0.075))
        i = 4
        while i < len(values) - 4:
            if values[i] >= 0.18:
                i += 1
                continue
            gap_start = i
            while i < len(values) and values[i] < 0.18:
                i += 1
            gap_end = i
            gap_len = gap_end - gap_start
            if gap_len < min_gap or gap_len > max_gap:
                continue
            left_support = mean_presence(values, gap_start - 34, gap_start - 6)
            right_support = mean_presence(values, gap_end + 6, gap_end + 34)
            if left_support < 0.34 or right_support < 0.34:
                continue
            axis_center = start + (gap_start + gap_end) / 2
            if wall["orientation"] == "horizontal":
                x = int(axis_center - gap_len / 2)
                y = int(fixed - max(8, wall.get("thickness", 8)))
                bw = int(gap_len)
                bh = int(max(18, wall.get("thickness", 8) + 18))
                center = {"x": round(axis_center, 1), "y": round(fixed, 1)}
            else:
                x = int(fixed - max(8, wall.get("thickness", 8)))
                y = int(axis_center - gap_len / 2)
                bw = int(max(18, wall.get("thickness", 8) + 18))
                bh = int(gap_len)
                center = {"x": round(fixed, 1), "y": round(axis_center, 1)}
            confidence = 0.52 + min(0.16, (left_support + right_support) * 0.08) + min(0.1, gap_len / max(min(w, h), 1) * 1.2)
            candidates.append({
                "id": "door-symbol-%d" % (len(candidates) + 1),
                "type": "door",
                "x": x,
                "y": y,
                "width": bw,
                "height": bh,
                "center": center,
                "orientation": wall["orientation"],
                "gapLength": int(gap_len),
                "wallCandidateId": wall.get("id", ""),
                "leftSupport": round(float(left_support), 3),
                "rightSupport": round(float(right_support), 3),
                "confidence": round(min(0.82, confidence), 3),
                "source": "wall-gap-door-scanner"
            })

    deduped = []
    for candidate in sorted(candidates, key=lambda item: item["confidence"], reverse=True):
        duplicate = False
        for existing in deduped:
            if candidate["orientation"] != existing["orientation"]:
                continue
            dist = math.hypot(candidate["center"]["x"] - existing["center"]["x"], candidate["center"]["y"] - existing["center"]["y"])
            if dist < max(26, min(candidate["gapLength"], existing["gapLength"]) * 0.8):
                duplicate = True
                break
        if not duplicate:
            deduped.append(candidate)
        if len(deduped) >= 12:
            break
    for index, candidate in enumerate(deduped):
        candidate["id"] = "door-symbol-%d" % (index + 1)
    return deduped

def detect_window_symbol_candidates():
    thin_lines = thin_line_candidates()
    candidates = []
    bounds_x0, bounds_y0, bounds_x1, bounds_y1 = mask_bounds(structural_wall_seed, closed, padding=max(16, min(w, h) // 55))
    for i, a in enumerate(thin_lines):
        af, as_, ae = normalized_span(a)
        for b in thin_lines[i + 1:]:
            if a["orientation"] != b["orientation"]:
                continue
            bf, bs, be = normalized_span(b)
            distance = abs(af - bf)
            if distance < 4 or distance > max(18, min(w, h) * 0.022):
                continue
            overlap = overlap_1d(as_, ae, bs, be)
            pair_length = max(overlap, min(a["length"], b["length"]))
            if overlap < max(24, min(w, h) // 48):
                continue
            shorter = max(1, min(a["length"], b["length"]))
            if overlap / shorter < 0.58:
                continue
            center_fixed = (af + bf) / 2
            start = max(as_, bs)
            end = min(ae, be)
            if a["orientation"] == "horizontal":
                x = int(start)
                y = int(min(af, bf))
                width = int(end - start)
                height = int(max(8, distance))
                center = {"x": round((start + end) / 2, 1), "y": round(center_fixed, 1)}
            else:
                x = int(min(af, bf))
                y = int(start)
                width = int(max(8, distance))
                height = int(end - start)
                center = {"x": round(center_fixed, 1), "y": round((start + end) / 2, 1)}
            if width < 8 or height < 8:
                continue
            near_edge = x < bounds_x0 + max(70, w * 0.09) or x + width > bounds_x1 - max(70, w * 0.09) or y < bounds_y0 + max(58, h * 0.075) or y + height > bounds_y1 - max(58, h * 0.075)
            symbol = {
                "orientation": a["orientation"],
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "center": center
            }
            wall_support = nearest_wall_for_symbol(symbol)
            if not wall_support and not near_edge:
                continue
            text_count = text_like_component_count_near_line({
                "orientation": a["orientation"],
                "start": {"x": x, "y": center["y"]} if a["orientation"] == "horizontal" else {"x": center["x"], "y": y},
                "end": {"x": x + width, "y": center["y"]} if a["orientation"] == "horizontal" else {"x": center["x"], "y": y + height},
                "thickness": max(width, height)
            })
            if text_count >= 3 and not wall_support:
                continue
            confidence = 0.5 + min(0.18, overlap / max(w, h) * 0.9) + (0.16 if wall_support else 0) + (0.08 if near_edge else 0) - min(0.12, text_count * 0.035)
            window_type = "sliding" if distance >= 10 else ("high" if max(width, height) < max(56, min(w, h) * 0.045) else "standard")
            candidates.append({
                "id": "window-symbol-%d" % (len(candidates) + 1),
                "type": "window",
                "windowType": window_type,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "center": center,
                "orientation": a["orientation"],
                "lineGap": round(float(distance), 2),
                "pairedLineOverlap": round(float(overlap), 2),
                "nearEnvelope": bool(near_edge),
                "wallSupport": wall_support,
                "nearbyTextComponentCount": int(text_count),
                "confidence": round(min(0.88, max(0.42, confidence)), 3),
                "source": "parallel-thin-window-symbol-scanner"
            })

    deduped = []
    for candidate in sorted(candidates, key=lambda item: item["confidence"], reverse=True):
        duplicate = False
        for existing in deduped:
            if candidate["orientation"] != existing["orientation"]:
                continue
            dist = math.hypot(candidate["center"]["x"] - existing["center"]["x"], candidate["center"]["y"] - existing["center"]["y"])
            if dist < max(24, min(candidate["width"] + candidate["height"], existing["width"] + existing["height"]) * 0.55):
                duplicate = True
                break
        if not duplicate:
            deduped.append(candidate)
        if len(deduped) >= 14:
            break
    for index, candidate in enumerate(deduped):
        candidate["id"] = "window-symbol-%d" % (index + 1)
    return deduped

def classify_annotation_rect(x, y, bw, bh, contour_area, candidate_index):
    rect_area = max(1, bw * bh)
    fill = contour_area / rect_area
    aspect = bw / max(1, bh)
    near_top_margin = y < h * 0.10
    near_bottom_margin = y + bh > h * 0.90
    near_right_margin = x + bw > w * 0.84
    near_left_margin = x < w * 0.14
    compact_mark = bw <= max(80, w * 0.075) and bh <= max(76, h * 0.078)
    tall_margin_text = near_right_margin and bh >= 38 and bw <= 70
    tall_margin_frame = (near_right_margin or near_left_margin or near_bottom_margin) and bh >= 55 and bw <= 90
    isolated_margin_mark = compact_mark and (near_top_margin or near_bottom_margin or near_right_margin or near_left_margin)
    if not (isolated_margin_mark or tall_margin_text or tall_margin_frame):
        return None
    evidence = [
        "near-drawing-margin",
        "compact-dimension-or-auxiliary-mark" if compact_mark else "",
        "right-margin-vertical-dimension-text" if tall_margin_text else "",
        "margin-vertical-auxiliary-frame" if tall_margin_frame else ""
    ]
    return {
        "id": "annotation-symbol-%d" % candidate_index,
        "type": "dimension_or_auxiliary_mark",
        "x": int(x),
        "y": int(y),
        "width": int(bw),
        "height": int(bh),
        "area": int(rect_area),
        "center": {"x": round(x + bw / 2, 1), "y": round(y + bh / 2, 1)},
        "aspectRatio": round(float(aspect), 3),
        "fillRatio": round(float(fill), 3),
        "confidence": 0.72 if tall_margin_text else 0.64,
        "evidence": [item for item in evidence if item],
        "source": "annotation-dimension-scanner"
    }

def classify_symbol_rect(x, y, bw, bh, area, contour_area, candidate_index):
    if bw < 18 or bh < 12 or bw > w * 0.26 or bh > h * 0.22:
        return None
    annotation = classify_annotation_rect(x, y, bw, bh, contour_area, candidate_index)
    if annotation:
        return annotation
    rect_area = max(1, bw * bh)
    fill = contour_area / rect_area
    aspect = bw / max(1, bh)
    center = {"x": round(x + bw / 2, 1), "y": round(y + bh / 2, 1)}
    symbol_type = None
    confidence = 0.42
    reasons = []
    if 1.35 <= aspect <= 2.9 and rect_area > w * h * 0.003:
        symbol_type = "bed"
        confidence = 0.54 + min(0.14, rect_area / max(w * h, 1) * 8)
        reasons.append("large-bedroom-rectangle")
    elif aspect >= 2.5 and bh <= max(36, int(h * 0.055)) and bw >= max(70, int(w * 0.08)):
        symbol_type = "wardrobe"
        confidence = 0.52 + min(0.12, bw / max(w, 1))
        reasons.append("long-thin-wardrobe-outline")
    elif aspect >= 1.8 and bh <= max(28, int(h * 0.045)) and bw >= max(50, int(w * 0.06)):
        symbol_type = "cabinet"
        confidence = 0.5 + min(0.1, bw / max(w, 1))
        reasons.append("long-low-cabinet-outline")
    elif 0.78 <= aspect <= 1.25 and 22 <= bw <= max(48, int(w * 0.055)) and 22 <= bh <= max(48, int(h * 0.055)):
        symbol_type = "nightstand" if rect_area <= w * h * 0.001 else "chair"
        confidence = 0.48 + min(0.08, fill)
        reasons.append("compact-square-seat-or-bedside")
    elif 1.2 <= aspect <= 3.8 and bw > 46 and bh > 18 and fill < 0.36:
        symbol_type = "sofa_or_table"
        confidence = 0.48 + min(0.12, bw / max(w, 1))
        reasons.append("long-furniture-outline")
    elif 0.72 <= aspect <= 1.38 and 20 <= bw <= max(80, w * 0.075) and 18 <= bh <= max(76, h * 0.075):
        symbol_type = "table_or_fixture"
        confidence = 0.46 + min(0.12, fill)
        reasons.append("compact-square-symbol")
    elif aspect < 0.72 and bh > 28 and bw < max(70, w * 0.07):
        symbol_type = "shower" if bh >= 36 and fill < 0.42 else "bath_fixture_or_appliance"
        confidence = 0.47 if symbol_type == "shower" else 0.45
        reasons.append("narrow-fixture-symbol")
    if not symbol_type:
        return None
    return {
        "id": "symbol-%d" % candidate_index,
        "type": symbol_type,
        "x": int(x),
        "y": int(y),
        "width": int(bw),
        "height": int(bh),
        "area": int(rect_area),
        "center": center,
        "aspectRatio": round(float(aspect), 3),
        "fillRatio": round(float(fill), 3),
        "confidence": round(min(0.78, confidence), 3),
        "evidence": reasons,
        "source": "furniture-fixture-contour-scanner"
    }

def detect_furniture_symbol_candidates():
    symbol_seed = cv2.bitwise_and(closed, cv2.bitwise_not(cv2.dilate(structural_wall_seed, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)), iterations=1)))
    symbol_seed = cv2.morphologyEx(symbol_seed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
    contours_symbols, _ = cv2.findContours(symbol_seed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    annotations = []
    def overlaps_window_symbol(x, y, bw, bh):
        for window in window_symbol_candidates:
            wx, wy = window["x"], window["y"]
            ww, wh = window["width"], window["height"]
            overlap_area = overlap_1d(x, x + bw, wx, wx + ww) * overlap_1d(y, y + bh, wy, wy + wh)
            if overlap_area / max(1, min(bw * bh, ww * wh)) >= 0.35:
                return True
        return False
    for contour in contours_symbols:
        contour_area = float(cv2.contourArea(contour))
        if contour_area < max(70, w * h * 0.00007):
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        candidate = classify_symbol_rect(x, y, bw, bh, bw * bh, contour_area, len(candidates) + 1)
        if candidate:
            if candidate["source"] == "annotation-dimension-scanner":
                annotations.append(candidate)
                continue
            if overlaps_window_symbol(x, y, bw, bh):
                annotation = classify_annotation_rect(x, y, bw, bh, contour_area, len(annotations) + 1) or {
                    **candidate,
                    "id": "annotation-symbol-%d" % (len(annotations) + 1),
                    "type": "opening_or_auxiliary_frame",
                    "confidence": 0.68,
                    "evidence": ["overlaps-window-symbol-candidate"],
                    "source": "annotation-dimension-scanner"
                }
                annotations.append(annotation)
                continue
            candidates.append(candidate)
    deduped = []
    for candidate in sorted(candidates, key=lambda item: (item["confidence"], item["area"]), reverse=True):
        if any(overlap_1d(candidate["x"], candidate["x"] + candidate["width"], item["x"], item["x"] + item["width"]) * overlap_1d(candidate["y"], candidate["y"] + candidate["height"], item["y"], item["y"] + item["height"]) > min(candidate["area"], item["area"]) * 0.62 for item in deduped):
            continue
        deduped.append(candidate)
        if len(deduped) >= 36:
            break
    for index, candidate in enumerate(deduped):
        candidate["id"] = "furniture-symbol-%d" % (index + 1)
    for index, candidate in enumerate(annotations):
        candidate["id"] = "annotation-symbol-%d" % (index + 1)
    return deduped, annotations[:80]

def contour_circularity(contour):
    area = float(cv2.contourArea(contour))
    if area <= 0:
        return 0.0
    perimeter = float(cv2.arcLength(contour, True))
    if perimeter <= 0:
        return 0.0
    return 4.0 * np.pi * area / (perimeter * perimeter)

def dedupe_symbol_candidates(candidates, overlap_ratio=0.55, limit=24):
    deduped = []
    for candidate in sorted(candidates, key=lambda item: (item.get("confidence", 0), item.get("area", 0)), reverse=True):
        cx1, cy1 = candidate["x"], candidate["y"]
        cx2, cy2 = candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]
        area = max(1, candidate.get("area", candidate["width"] * candidate["height"]))
        duplicated = False
        for item in deduped:
            overlap = overlap_1d(cx1, cx2, item["x"], item["x"] + item["width"]) * overlap_1d(cy1, cy2, item["y"], item["y"] + item["height"])
            if overlap / max(1, min(area, item.get("area", item["width"] * item["height"]))) >= overlap_ratio:
                duplicated = True
                break
        if duplicated:
            continue
        deduped.append(candidate)
        if len(deduped) >= limit:
            break
    return deduped

def detect_mep_electrical_candidates():
    mep_candidates = []
    electrical_candidates = []
    interior_mask = cv2.bitwise_and(
        closed,
        cv2.bitwise_not(cv2.dilate(structural_wall_seed, cv2.getStructuringElement(cv2.MORPH_RECT, (17, 17)), iterations=2))
    )
    edge_interior = cv2.bitwise_and(edges, interior_mask)
    contours, _ = cv2.findContours(edge_interior, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < 22 or area > max(1200, w * h * 0.0012):
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        if bw < 6 or bh < 6 or bw > max(96, int(w * 0.08)) or bh > max(96, int(h * 0.08)):
            continue
        rect_area = max(1, bw * bh)
        fill = area / rect_area
        aspect = bw / max(1, bh)
        circ = contour_circularity(contour)
        center = {"x": round(x + bw / 2, 1), "y": round(y + bh / 2, 1)}
        symbol_type = None
        confidence = 0.46
        evidence = []
        scanner = "electrical-symbol-scanner"
        if circ >= 0.58 and 8 <= bw <= 30 and 8 <= bh <= 30:
            if bw <= 16 and bh <= 16 and fill < 0.62:
                symbol_type = "power_outlet"
                confidence = 0.58 + min(0.12, circ * 0.1)
                evidence.append("small-circular-outlet-mark")
            else:
                symbol_type = "ceiling_light"
                confidence = 0.56 + min(0.1, fill * 0.12)
                evidence.append("circular-ceiling-light-mark")
        elif 0.72 <= aspect <= 1.35 and 12 <= bw <= 34 and 12 <= bh <= 34 and fill < 0.5:
            symbol_type = "low_voltage_outlet"
            confidence = 0.54
            evidence.append("compact-square-network-point")
        elif 0.18 <= aspect <= 0.78 and 10 <= bh <= 38 and 6 <= bw <= 20 and fill < 0.58:
            symbol_type = "switch_single"
            confidence = 0.55
            evidence.append("vertical-switch-glyph")
        elif aspect >= 4.0 and bh <= 14 and bw >= 36:
            symbol_type = "light_strip"
            confidence = 0.52 + min(0.1, bw / max(w, 1))
            evidence.append("long-thin-light-strip")
        elif aspect <= 0.62 and 28 <= bh <= 96 and 12 <= bw <= 40 and fill >= 0.22:
            symbol_type = "radiator"
            scanner = "mep-symbol-scanner"
            confidence = 0.57
            evidence.append("vertical-radiator-outline")
        elif 1.7 <= aspect <= 4.5 and 18 <= bh <= 46 and bw >= 48:
            symbol_type = "hvac_indoor"
            scanner = "mep-symbol-scanner"
            confidence = 0.58
            evidence.append("horizontal-hvac-indoor-unit")
        elif 0.72 <= aspect <= 1.35 and 14 <= bw <= 40 and 14 <= bh <= 40 and fill < 0.48:
            symbol_type = "fresh_air_vent"
            scanner = "mep-symbol-scanner"
            confidence = 0.53
            evidence.append("square-fresh-air-vent")
        if not symbol_type:
            continue
        payload = {
            "type": symbol_type,
            "x": int(x),
            "y": int(y),
            "width": int(bw),
            "height": int(bh),
            "area": int(rect_area),
            "center": center,
            "aspectRatio": round(float(aspect), 3),
            "fillRatio": round(float(fill), 3),
            "circularity": round(float(circ), 3),
            "confidence": round(min(0.82, confidence), 3),
            "evidence": evidence,
            "source": scanner
        }
        if scanner == "mep-symbol-scanner":
            mep_candidates.append(payload)
        else:
            electrical_candidates.append(payload)

    thin_horizontals = []
    for line in line_items:
        if line.get("source") == "annotation-line-candidate":
            continue
        thickness = line.get("thickness", 0)
        length = line.get("length", 0)
        if line.get("orientation") != "horizontal" or thickness > 6 or length < 36:
            continue
        thin_horizontals.append(line)
    if len(thin_horizontals) >= 6:
        ys = sorted([line["start"]["y"] for line in thin_horizontals])
        gaps = [ys[index + 1] - ys[index] for index in range(len(ys) - 1) if ys[index + 1] - ys[index] > 0]
        if len(gaps) >= 5:
            median_gap = float(np.median(gaps))
            if median_gap <= max(26, h * 0.038):
                xs = [min(line["start"]["x"], line["end"]["x"]) for line in thin_horizontals]
                ys2 = [line["start"]["y"] for line in thin_horizontals]
                mep_candidates.append({
                    "type": "floor_heating",
                    "x": int(max(0, min(xs) - 8)),
                    "y": int(max(0, min(ys2) - 8)),
                    "width": int(max(20, max(xs) - min(xs) + 16)),
                    "height": int(max(20, max(ys2) - min(ys2) + 16)),
                    "area": int(max(20, max(xs) - min(xs) + 16) * max(20, max(ys2) - min(ys2) + 16)),
                    "center": {"x": round((min(xs) + max(xs)) / 2, 1), "y": round((min(ys2) + max(ys2)) / 2, 1)},
                    "aspectRatio": round((max(xs) - min(xs) + 16) / max(1, max(ys2) - min(ys2) + 16), 3),
                    "fillRatio": 0.0,
                    "circularity": 0.0,
                    "confidence": round(min(0.72, 0.48 + len(thin_horizontals) * 0.02), 3),
                    "evidence": ["parallel-thin-heating-lines", "median-gap-%d" % int(median_gap)],
                    "source": "mep-symbol-scanner"
                })

    mep_candidates = dedupe_symbol_candidates(mep_candidates, overlap_ratio=0.5, limit=12)
    electrical_candidates = dedupe_symbol_candidates(electrical_candidates, overlap_ratio=0.5, limit=24)
    for index, candidate in enumerate(mep_candidates):
        candidate["id"] = "mep-symbol-%d" % (index + 1)
    for index, candidate in enumerate(electrical_candidates):
        candidate["id"] = "electrical-symbol-%d" % (index + 1)
    return mep_candidates, electrical_candidates

contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
areas = []
for i, contour in enumerate(contours):
    area = float(cv2.contourArea(contour))
    if area < max(1200, w * h * 0.002):
        continue
    x, y, bw, bh = cv2.boundingRect(contour)
    if bw < 20 or bh < 20:
        continue
    areas.append({
        "id": "contour-%d" % (i + 1),
        "x": int(x),
        "y": int(y),
        "width": int(bw),
        "height": int(bh),
        "area": round(area, 2),
        "aspectRatio": round(bw / max(bh, 1), 3)
    })
areas = sorted(areas, key=lambda item: item["area"], reverse=True)[:40]

dark_pixels = int(np.count_nonzero(gray < 180))
edge_pixels = int(np.count_nonzero(edges))
contrast = float(gray.std())
line_density = len(line_items) / max((w * h) / 1000000, 1)
quality_score = min(1.0, 0.25 + min(0.25, contrast / 255) + min(0.25, edge_pixels / max(w * h, 1) * 12) + min(0.25, len(line_items) / 80))
issues = []
if w < 700 or h < 700:
    issues.append("图像分辨率偏低，建议上传更清晰的原图")
if contrast < 35:
    issues.append("图像对比度偏低，墙线和文字可能不稳定")
if len(line_items) < 8:
    issues.append("检测到的墙线/边线较少，可能是图纸模糊或预处理失败")

debug_edges = output_dir + "/vision-edges.png"
debug_binary = output_dir + "/vision-binary.png"
debug_walls = output_dir + "/vision-wall-bands.png"
debug_structural_wall_mask = output_dir + "/vision-structural-wall-mask.png"
debug_structural_wall_vectors = output_dir + "/structural-wall-vectors.svg"
debug_balcony_candidates = output_dir + "/vision-balcony-candidates.png"
debug_room_interiors = output_dir + "/vision-room-interiors.png"
debug_window_candidates = output_dir + "/vision-window-candidates.png"
debug_door_candidates = output_dir + "/vision-door-candidates.png"
debug_symbol_candidates = output_dir + "/vision-symbol-candidates.png"
cv2.imwrite(debug_edges, edges)
cv2.imwrite(debug_binary, closed)
wall_debug = np.zeros_like(closed)
for line in [item for item in line_items if item.get("source") == "morphology-wall-band"]:
    cv2.line(wall_debug, (line["start"]["x"], line["start"]["y"]), (line["end"]["x"], line["end"]["y"]), 255, max(2, int(line.get("thickness", 8))))
cv2.imwrite(debug_walls, wall_debug)
structural_wall_mask = cv2.dilate(structural_wall_seed, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
cv2.imwrite(debug_structural_wall_mask, structural_wall_mask)
wall_vectors = structural_wall_vectors(structural_wall_mask)
balcony_candidates, balcony_outline = detect_balcony_candidates()
room_interior_candidates, room_interiors_debug = detect_room_interior_candidates()
window_symbol_candidates = detect_window_symbol_candidates()
door_symbol_candidates = detect_door_symbol_candidates()
furniture_symbol_candidates, annotation_symbol_candidates = detect_furniture_symbol_candidates()
mep_symbol_candidates, electrical_symbol_candidates = detect_mep_electrical_candidates()
cv2.imwrite(debug_room_interiors, room_interiors_debug)
balcony_debug = image.copy()
for candidate in balcony_candidates:
    cv2.rectangle(
        balcony_debug,
        (candidate["x"], candidate["y"]),
        (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]),
        (255, 128, 0),
        4
    )
    cv2.putText(
        balcony_debug,
        "balcony %.2f" % candidate["confidence"],
        (candidate["x"], max(24, candidate["y"] - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (255, 128, 0),
        2,
        cv2.LINE_AA
    )
cv2.imwrite(debug_balcony_candidates, balcony_debug)

window_debug = image.copy()
for candidate in window_symbol_candidates:
    color = (255, 80, 0)
    cv2.rectangle(window_debug, (candidate["x"], candidate["y"]), (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]), color, 3)
    cv2.circle(window_debug, (int(candidate["center"]["x"]), int(candidate["center"]["y"])), 5, (255, 255, 255), -1)
    cv2.putText(window_debug, "window %.2f" % candidate["confidence"], (candidate["x"], max(24, candidate["y"] - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.58, color, 2, cv2.LINE_AA)
cv2.imwrite(debug_window_candidates, window_debug)

door_debug = image.copy()
for candidate in door_symbol_candidates:
    color = (0, 165, 255)
    cv2.rectangle(door_debug, (candidate["x"], candidate["y"]), (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]), color, 3)
    cv2.circle(door_debug, (int(candidate["center"]["x"]), int(candidate["center"]["y"])), 5, (255, 255, 255), -1)
    cv2.putText(door_debug, "door %.2f" % candidate["confidence"], (candidate["x"], max(24, candidate["y"] - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.58, color, 2, cv2.LINE_AA)
cv2.imwrite(debug_door_candidates, door_debug)

symbol_debug = image.copy()
symbol_colors = {
    "bed": (132, 75, 255),
    "sofa_or_table": (34, 197, 94),
    "table_or_fixture": (14, 165, 233),
    "bath_fixture_or_appliance": (245, 158, 11),
    "dimension_or_auxiliary_mark": (120, 120, 120)
}
for candidate in furniture_symbol_candidates:
    color = symbol_colors.get(candidate["type"], (148, 163, 184))
    cv2.rectangle(symbol_debug, (candidate["x"], candidate["y"]), (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]), color, 3)
    cv2.putText(symbol_debug, "%s %.2f" % (candidate["type"], candidate["confidence"]), (candidate["x"], max(24, candidate["y"] - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 2, cv2.LINE_AA)
for candidate in annotation_symbol_candidates:
    color = symbol_colors.get(candidate["type"], (120, 120, 120))
    cv2.rectangle(symbol_debug, (candidate["x"], candidate["y"]), (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]), color, 2)
    cv2.putText(symbol_debug, "annotation %.2f" % candidate["confidence"], (candidate["x"], max(24, candidate["y"] - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.48, color, 2, cv2.LINE_AA)
for candidate in mep_symbol_candidates:
    color = (0, 180, 255)
    cv2.rectangle(symbol_debug, (candidate["x"], candidate["y"]), (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]), color, 2)
    cv2.putText(symbol_debug, "mep:%s %.2f" % (candidate["type"], candidate["confidence"]), (candidate["x"], max(24, candidate["y"] - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.48, color, 2, cv2.LINE_AA)
for candidate in electrical_symbol_candidates:
    color = (255, 0, 180)
    cv2.rectangle(symbol_debug, (candidate["x"], candidate["y"]), (candidate["x"] + candidate["width"], candidate["y"] + candidate["height"]), color, 2)
    cv2.putText(symbol_debug, "elec:%s %.2f" % (candidate["type"], candidate["confidence"]), (candidate["x"], max(24, candidate["y"] - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.48, color, 2, cv2.LINE_AA)
cv2.imwrite(debug_symbol_candidates, symbol_debug)

vector_svg_paths = []
for wall in wall_vectors:
    points = wall["polygon"]
    if not points:
        continue
    path_data = "M " + " L ".join(["%d %d" % (point["x"], point["y"]) for point in points]) + " Z"
    vector_svg_paths.append('<path d="%s" fill="#ef4444" fill-opacity="0.56" stroke="#b91c1c" stroke-width="2"/>' % path_data)
vector_svg = '''<?xml version="1.0" encoding="UTF-8"?>
<svg width="%d" height="%d" viewBox="0 0 %d %d" xmlns="http://www.w3.org/2000/svg">
  <image href="./recognition-input.jpg" x="0" y="0" width="%d" height="%d" preserveAspectRatio="none"/>
  %s
</svg>''' % (w, h, w, h, w, h, "\\n  ".join(vector_svg_paths))
open(debug_structural_wall_vectors, "w", encoding="utf-8").write(vector_svg)

print(json.dumps({
    "available": True,
    "image": {"width": w, "height": h, "darkPixelRatio": round(dark_pixels / max(w*h, 1), 4), "edgePixelRatio": round(edge_pixels / max(w*h, 1), 4), "contrast": round(contrast, 2)},
    "quality": {"score": round(quality_score, 2), "issues": issues},
    "geometryCandidates": {
        "lines": line_items,
        "contours": areas,
        "lineDensity": round(line_density, 2),
        "wallBandCount": len(filtered_axis_candidates),
        "rejectedWallBandCount": len(rejected_axis_candidates),
        "structuralWallVectorCount": len(wall_vectors),
        "structuralWallVectors": wall_vectors,
        "balconyCandidateCount": len(balcony_candidates),
        "balconyCandidates": balcony_candidates,
        "roomInteriorCandidateCount": len(room_interior_candidates),
        "roomInteriorCandidates": room_interior_candidates,
        "windowSymbolCandidateCount": len(window_symbol_candidates),
        "windowSymbolCandidates": window_symbol_candidates,
        "doorSymbolCandidateCount": len(door_symbol_candidates),
        "doorSymbolCandidates": door_symbol_candidates,
        "furnitureSymbolCandidateCount": len(furniture_symbol_candidates),
        "furnitureSymbolCandidates": furniture_symbol_candidates,
        "mepSymbolCandidateCount": len(mep_symbol_candidates),
        "mepSymbolCandidates": mep_symbol_candidates,
        "electricalSymbolCandidateCount": len(electrical_symbol_candidates),
        "electricalSymbolCandidates": electrical_symbol_candidates,
        "annotationSymbolCandidateCount": len(annotation_symbol_candidates),
        "annotationSymbolCandidates": annotation_symbol_candidates
    },
    "ocrCandidates": [],
    "debugImages": {"edges": debug_edges, "binary": debug_binary, "wallBands": debug_walls, "structuralWallMask": debug_structural_wall_mask, "structuralWallVectors": debug_structural_wall_vectors, "balconyCandidates": debug_balcony_candidates, "roomInteriors": debug_room_interiors, "windowCandidates": debug_window_candidates, "doorCandidates": debug_door_candidates, "symbolCandidates": debug_symbol_candidates}
}, ensure_ascii=False))
`;

  const scriptPath = path.join(os.tmpdir(), `aiinhouse-preprocess-${Date.now()}.py`);
  fs.writeFileSync(scriptPath, script, 'utf8');

  const pythonCommands = [
    process.env.AIINHOUSE_PYTHON_BIN,
    process.env.PYTHON_BIN,
    'python3',
    'python'
  ].filter(Boolean);

  for (const command of pythonCommands) {
    const result = run(command, [scriptPath, sourcePath, outputDir], { timeout: 45000 });
    if (result.status === 0 && result.stdout.trim()) {
      try {
        return JSON.parse(result.stdout.trim());
      } catch (error) {
        return { available: false, error: error.message, raw: result.stdout.trim() };
      }
    }
  }

  return { available: false, error: 'python_or_opencv_unavailable' };
}

function buildPayload(job, sourcePath, outputDir) {
  const compressed = buildCompressedImage(sourcePath, outputDir);
  const vision = compressed.preprocessedImagePath
    ? runPythonVision(compressed.preprocessedImagePath, outputDir)
    : { available: false, error: 'missing-source' };
  const quality = vision.available
    ? vision.quality
    : {
        score: compressed.preprocessedImagePath ? 0.45 : 0,
        issues: compressed.preprocessedImagePath ? ['未启用 OpenCV 几何候选，仅完成图片压缩'] : ['未找到源图']
      };

  const payload = {
    status: compressed.preprocessedImagePath ? 'completed' : 'skipped',
    message: vision.available
      ? '已完成图像压缩、质量评分、墙线/轮廓候选提取。'
      : '已完成基础图片处理，OpenCV 候选提取未启用或失败。',
    sourcePath,
    preprocessedImagePath: compressed.preprocessedImagePath,
    operations: compressed.operations,
    beforeSizeBytes: compressed.beforeSizeBytes || 0,
    afterSizeBytes: compressed.afterSizeBytes || 0,
    beforeWidth: compressed.beforeWidth || 0,
    beforeHeight: compressed.beforeHeight || 0,
    afterWidth: compressed.afterWidth || 0,
    afterHeight: compressed.afterHeight || 0,
    quality,
    image: vision.image || {
      width: compressed.afterWidth || compressed.beforeWidth || 0,
      height: compressed.afterHeight || compressed.beforeHeight || 0
    },
    geometryCandidates: vision.geometryCandidates || { lines: [], contours: [], lineDensity: 0 },
    ocrCandidates: [
      ...(vision.ocrCandidates || []),
      ...(job?.floor_plan?.ocr_candidates || []),
      ...(job?.floor_plan?.room_labels || []),
      ...(job?.job?.input_payload?.ocrCandidates || []),
      ...(job?.job?.input_payload?.roomLabels || [])
    ],
    debugImages: vision.debugImages || {},
    visionAvailable: Boolean(vision.available),
    visionError: vision.available ? '' : (vision.error || ''),
    jobHints: {
      sourceType: job?.job?.source_type || job?.job?.input_payload?.sourceType || 'digital',
      processNotes: job?.job?.input_payload?.processNotes || ''
    },
    generatedAt: new Date().toISOString()
  };

  return annotatePreprocessingWithAssets(payload);
}

async function main() {
  const jobFile = getArgValue('--job');
  const outputDir = path.resolve(getArgValue('--output'));

  if (!jobFile || !outputDir) {
    throw new Error('用法: node scripts/floorplan-preprocess.mjs --job <job.json> --output <dir>');
  }

  ensureDir(outputDir);
  const job = JSON.parse(fs.readFileSync(path.resolve(jobFile), 'utf8'));
  const sourcePath = job?.assets?.local_source_file || '';
  const payload = buildPayload(job, sourcePath, outputDir);
  const targetFile = path.join(outputDir, 'recognition-preprocess.json');
  fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
  // CLI 只输出摘要，避免 benchmark spawnSync 因完整 JSON 撑爆 maxBuffer
  process.stdout.write(`${JSON.stringify({
    status: payload.status,
    visionAvailable: payload.visionAvailable,
    visionError: payload.visionError || '',
    matchedCandidateCount: payload.recognitionAssets?.matchedCandidateCount || 0,
    excludedAnnotationLineCount: payload.recognitionAssets?.excludedAnnotationLineCount || 0,
    lineCount: payload.geometryCandidates?.lines?.length || 0,
    output: targetFile
  })}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
