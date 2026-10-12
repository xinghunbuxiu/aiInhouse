'use strict';

// Geometry-first feature extraction for floor-plan line segments.
// This module reports observable geometry only; it never labels a line as a wall.
function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function normalizeSegment(line, index) {
  if (!line || !line.start || !line.end
    || !finite(line.start.x) || !finite(line.start.y)
    || !finite(line.end.x) || !finite(line.end.y)) return null;
  const start = { x: Number(line.start.x), y: Number(line.start.y) };
  const end = { x: Number(line.end.x), y: Number(line.end.y) };
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return null;
  return {
    id: String(line.id || `line-${index + 1}`),
    source: String(line.source || 'unknown'),
    confidence: finite(line.confidence) ? Number(line.confidence) : null,
    orientation: String(line.orientation || ''),
    start, end, dx, dy, length,
    angle: Math.atan2(dy, dx)
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointToSegment(p, segment) {
  const lengthSquared = segment.dx * segment.dx + segment.dy * segment.dy;
  const t = Math.max(0, Math.min(1,
    ((p.x - segment.start.x) * segment.dx + (p.y - segment.start.y) * segment.dy) / lengthSquared));
  const nearest = { x: segment.start.x + t * segment.dx, y: segment.start.y + t * segment.dy };
  return { distance: distance(p, nearest), t };
}

function segmentIntersection(a, b, epsilon = 1e-8) {
  const denominator = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(denominator) < epsilon) return null;
  const qpx = b.start.x - a.start.x, qpy = b.start.y - a.start.y;
  const t = (qpx * b.dy - qpy * b.dx) / denominator;
  const u = (qpx * a.dy - qpy * a.dx) / denominator;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null;
  return { x: a.start.x + t * a.dx, y: a.start.y + t * a.dy };
}

function uniqueRays(point, segments, tolerance) {
  const rays = [];
  for (const segment of segments) {
    const hit = pointToSegment(point, segment);
    if (hit.distance > tolerance || hit.t < -1e-6 || hit.t > 1 + 1e-6) continue;
    for (const endpoint of [segment.start, segment.end]) {
      const vx = endpoint.x - point.x, vy = endpoint.y - point.y;
      const length = Math.hypot(vx, vy);
      if (length < tolerance) continue;
      const ray = { x: vx / length, y: vy / length };
      if (!rays.some(existing => ray.x * existing.x + ray.y * existing.y > 0.985)) rays.push(ray);
    }
  }
  return rays;
}

function clusterPoints(points, tolerance) {
  const clusters = [];
  for (const candidate of points) {
    let cluster = clusters.find(item => distance(item, candidate) <= tolerance);
    if (!cluster) {
      cluster = { x: candidate.x, y: candidate.y, count: 0 };
      clusters.push(cluster);
    }
    cluster.x = (cluster.x * cluster.count + candidate.x) / (cluster.count + 1);
    cluster.y = (cluster.y * cluster.count + candidate.y) / (cluster.count + 1);
    cluster.count += 1;
  }
  return clusters.map(point => ({ x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) }));
}

function parallelPairEvidence(a, b, options) {
  const angle = Math.acos(Math.min(1, Math.abs(
    (a.dx * b.dx + a.dy * b.dy) / (a.length * b.length)
  )));
  if (angle > options.parallelAngleTolerance) return null;
  const offset = Math.abs((b.start.x - a.start.x) * a.dy - (b.start.y - a.start.y) * a.dx) / a.length;
  if (offset < options.minimumParallelDistance || offset > options.maximumParallelDistance) return null;
  const ux = a.dx / a.length, uy = a.dy / a.length;
  const project = p => p.x * ux + p.y * uy;
  const overlap = Math.min(Math.max(project(a.start), project(a.end)), Math.max(project(b.start), project(b.end)))
    - Math.max(Math.min(project(a.start), project(a.end)), Math.min(project(b.start), project(b.end)));
  if (overlap < options.minimumParallelOverlap) return null;
  return {
    lineIds: [a.id, b.id],
    distance: Number(offset.toFixed(2)),
    overlap: Number(overlap.toFixed(2)),
    angleDifferenceDegrees: Number((angle * 180 / Math.PI).toFixed(2))
  };
}

function mergeCollinearSegments(inputLines = [], config = {}) {
  const angleTolerance = (Number.isFinite(config.mergeAngleToleranceDegrees) ? config.mergeAngleToleranceDegrees : 2) * Math.PI / 180;
  const distanceTolerance = Number.isFinite(config.mergeDistanceTolerance) ? config.mergeDistanceTolerance : 4;
  const gapTolerance = Number.isFinite(config.mergeGapTolerance) ? config.mergeGapTolerance : 8;
  const sourceLines = inputLines.map(normalizeSegment).filter(Boolean);
  const groups = [];
  for (const line of sourceLines) {
    const ux = line.dx / line.length, uy = line.dy / line.length;
    let target = null;
    for (const group of groups) {
      const angle = Math.acos(Math.min(1, Math.abs(ux * group.ux + uy * group.uy)));
      if (angle > angleTolerance) continue;
      const perpendicularDistance = Math.abs((line.start.x - group.origin.x) * group.uy - (line.start.y - group.origin.y) * group.ux);
      if (perpendicularDistance > distanceTolerance) continue;
      const project = p => (p.x - group.origin.x) * group.ux + (p.y - group.origin.y) * group.uy;
      const start = Math.min(project(line.start), project(line.end));
      const end = Math.max(project(line.start), project(line.end));
      if (start > group.end + gapTolerance || end < group.start - gapTolerance) continue;
      target = group;
      const projections = [project(line.start), project(line.end)];
      group.start = Math.min(group.start, ...projections);
      group.end = Math.max(group.end, ...projections);
      group.sourceIds.push(line.id);
      if (line.source !== group.source) group.source = 'mixed';
      break;
    }
    if (!target) {
      const uxCanonical = ux < -1e-8 || (Math.abs(ux) <= 1e-8 && uy < 0) ? -ux : ux;
      const uyCanonical = ux < -1e-8 || (Math.abs(ux) <= 1e-8 && uy < 0) ? -uy : uy;
      const origin = { ...line.start };
      const project = p => (p.x - origin.x) * uxCanonical + (p.y - origin.y) * uyCanonical;
      const projections = [project(line.start), project(line.end)];
      groups.push({
        ux: uxCanonical, uy: uyCanonical, origin,
        start: Math.min(...projections), end: Math.max(...projections),
        sourceIds: [line.id], source: line.source
      });
    }
  }
  return groups.map((group, index) => ({
    id: `merged-line-${index + 1}`,
    source: group.source,
    sourceIds: group.sourceIds.slice().sort(),
    start: {
      x: Number((group.origin.x + group.ux * group.start).toFixed(2)),
      y: Number((group.origin.y + group.uy * group.start).toFixed(2))
    },
    end: {
      x: Number((group.origin.x + group.ux * group.end).toFixed(2)),
      y: Number((group.origin.y + group.uy * group.end).toFixed(2))
    },
    length: Number((group.end - group.start).toFixed(2))
  }));
}

function extractGeometryFeatures(inputLines = [], config = {}) {
  const options = {
    snapTolerance: Number.isFinite(config.snapTolerance) ? config.snapTolerance : 4,
    parallelAngleTolerance: (Number.isFinite(config.parallelAngleToleranceDegrees) ? config.parallelAngleToleranceDegrees : 3) * Math.PI / 180,
    minimumParallelDistance: Number.isFinite(config.minimumParallelDistance) ? config.minimumParallelDistance : 3,
    maximumParallelDistance: Number.isFinite(config.maximumParallelDistance) ? config.maximumParallelDistance : 80,
    minimumParallelOverlap: Number.isFinite(config.minimumParallelOverlap) ? config.minimumParallelOverlap : 20
  };
  const lines = inputLines.map(normalizeSegment).filter(Boolean);\n  const mergedLines = mergeCollinearSegments(inputLines, config);
  const rawPoints = [];
  lines.forEach(line => rawPoints.push(line.start, line.end));
  const rawIntersections = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const crossing = segmentIntersection(lines[i], lines[j]);
      if (crossing) {
        rawPoints.push(crossing);
        rawIntersections.push({ point: crossing, lineIds: [lines[i].id, lines[j].id] });
      }
    }
  }
  const points = clusterPoints(rawPoints, options.snapTolerance).map((p, index) => {
    const incident = lines.filter(line => pointToSegment(p, line).distance <= options.snapTolerance);
    const rays = uniqueRays(p, incident, options.snapTolerance);
    const isEndpoint = incident.some(line =>
      distance(p, line.start) <= options.snapTolerance || distance(p, line.end) <= options.snapTolerance);
    let type = 'junction';
    if (rays.length <= 1 && isEndpoint) type = 'endpoint';
    else if (rays.length === 2) type = 'corner';
    else if (rays.length === 3) type = 't-junction';
    else if (rays.length >= 4) type = 'cross-junction';
    return {
      id: `feature-point-${index + 1}`,
      x: p.x, y: p.y, type, degree: rays.length,
      incidentLineIds: incident.map(line => line.id).sort()
    };
  });
  const parallelGroups = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const evidence = parallelPairEvidence(lines[i], lines[j], options);
      if (evidence) parallelGroups.push({ id: `parallel-pair-${parallelGroups.length + 1}`, ...evidence });
    }
  }
  const sourceCounts = lines.reduce((result, line) => {
    result[line.source] = (result[line.source] || 0) + 1;
    return result;
  }, {});
  const counts = points.reduce((result, point) => {
    result[point.type] = (result[point.type] || 0) + 1;
    return result;
  }, {});
  return {
    version: 1,
    coordinateSpace: 'input-image-pixels',
    summary: {
      inputLineCount: inputLines.length,
      validLineCount: lines.length,\n      mergedCollinearLineCount: mergedLines.length,
      pointCount: points.length,
      junctionCounts: counts,
      properIntersectionCount: rawIntersections.length,
      parallelPairCount: parallelGroups.length,
      lineSourceCounts: sourceCounts
    },
    mergedLines,\n    lines: lines.map(line => ({
      id: line.id,
      source: line.source,
      confidence: line.confidence,
      orientation: line.orientation,
      start: line.start,
      end: line.end,
      length: Number(line.length.toFixed(2)),
      angleDegrees: Number((line.angle * 180 / Math.PI).toFixed(2))
    })),
    points,
    intersections: rawIntersections.map((item, index) => ({
      id: `intersection-${index + 1}`,
      point: { x: Number(item.point.x.toFixed(2)), y: Number(item.point.y.toFixed(2)) },
      lineIds: item.lineIds
    })),
    parallelGroups
  };
}

module.exports = { extractGeometryFeatures, mergeCollinearSegments };
