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
      // Do not merge geometrically close lines from different detectors: a dimension
      // line can sit on top of a wall candidate. Provenance mismatch is a hard boundary.
      if (!config.allowMixedSources && line.source !== group.source) continue;
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

function topologyEvidence(lines, options) {
  const endpoints = [];
  for (const line of lines) {
    endpoints.push({ lineId: line.id, point: line.start }, { lineId: line.id, point: line.end });
  }
  const endpointDegree = endpoints.map(endpoint => ({
    ...endpoint,
    nearbyEndpointIds: endpoints
      .filter(other => other.lineId !== endpoint.lineId && distance(endpoint.point, other.point) <= options.endpointSnapTolerance)
      .map(other => other.lineId)
  }));
  const disconnectedEndpoints = [];
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (endpoints[i].lineId === endpoints[j].lineId) continue;
      const gap = distance(endpoints[i].point, endpoints[j].point);
      if (gap <= options.endpointSnapTolerance || gap > options.maximumEndpointGap) continue;
      disconnectedEndpoints.push({
        lineIds: [endpoints[i].lineId, endpoints[j].lineId],
        endpoints: [endpoints[i].point, endpoints[j].point],
        gap: Number(gap.toFixed(2)),
        likelySameBoundary: gap <= options.likelyBoundaryGap
      });
    }
  }
  const adjacency = new Map(lines.map(line => [line.id, new Set()]));
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i], b = lines[j];
      const endpointsTouch = [a.start, a.end].some(p => [b.start, b.end].some(q => distance(p, q) <= options.endpointSnapTolerance));
      if (endpointsTouch || segmentIntersection(a, b) || pointToSegment(a.start, b).distance <= options.endpointSnapTolerance
        || pointToSegment(a.end, b).distance <= options.endpointSnapTolerance
        || pointToSegment(b.start, a).distance <= options.endpointSnapTolerance
        || pointToSegment(b.end, a).distance <= options.endpointSnapTolerance) {
        adjacency.get(a.id).add(b.id);
        adjacency.get(b.id).add(a.id);
      }
    }
  }
  const components = [];
  const visited = new Set();
  for (const line of lines) {
    if (visited.has(line.id)) continue;
    const stack = [line.id], memberIds = [];
    visited.add(line.id);
    while (stack.length) {
      const id = stack.pop();
      memberIds.push(id);
      for (const neighbor of adjacency.get(id) || []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); stack.push(neighbor); }
      }
    }
    components.push({ id: `line-component-${components.length + 1}`, lineIds: memberIds.sort(), lineCount: memberIds.length });
  }
  return {
    endpointCount: endpoints.length,
    disconnectedEndpointPairs: disconnectedEndpoints.sort((a, b) => a.gap - b.gap),
    connectedComponents: components,
    isolatedLineIds: components.filter(component => component.lineCount === 1).map(component => component.lineIds[0])
  };
}

function normalizeCurves(curves = []) {
  return curves.filter(curve => curve && curve.center
    && finite(curve.center.x) && finite(curve.center.y)
    && finite(curve.radius) && Number(curve.radius) > 0
    && finite(curve.startAngle) && finite(curve.endAngle))
    .map((curve, index) => ({
      id: String(curve.id || `curve-${index + 1}`),
      source: String(curve.source || 'unknown-curve'),
      kind: 'arc',
      center: { x: Number(curve.center.x), y: Number(curve.center.y) },
      radius: Number(curve.radius),
      startAngle: Number(curve.startAngle),
      endAngle: Number(curve.endAngle),
      sweepDegrees: Number((Math.abs(Number(curve.endAngle) - Number(curve.startAngle)) * 180 / Math.PI).toFixed(2))
    }));
}

function sampleLineAppearance(line, raster, config = {}) {
  if (!raster || !Number.isInteger(raster.width) || !Number.isInteger(raster.height) || !raster.data) return null;
  const width = raster.width, height = raster.height, data = raster.data;
  const channels = raster.channels || 1;
  if (!Number.isInteger(channels) || channels < 1 || data.length < width * height * channels) return null;
  const radius = Number.isFinite(config.appearanceSampleRadius) ? Math.max(0, config.appearanceSampleRadius) : 2;
  const sampleCount = Number.isFinite(config.appearanceSampleCount) ? Math.max(3, config.appearanceSampleCount) : 21;
  const values = [];
  const samplePoints = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / (sampleCount - 1);
    const x = Math.round(line.start.x + (line.end.x - line.start.x) * t);
    const y = Math.round(line.start.y + (line.end.y - line.start.y) * t);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    samplePoints.push({ x, y });
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const px = x + ox, py = y + oy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const offset = (py * width + px) * channels;
        const gray = channels >= 3 ? 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2] : data[offset];
        values.push(gray);
      }
    }
  }
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const darkThreshold = Number.isFinite(config.darkPixelThreshold) ? config.darkPixelThreshold : 150;
  const darkRatio = values.filter(value => value < darkThreshold).length / values.length;
  const centerValues = [];
  const backgroundValues = [];
  for (const point of samplePoints) {
    const offset = (point.y * width + point.x) * channels;
    centerValues.push(channels >= 3 ? 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2] : data[offset]);
    const bx = Math.min(width - 1, Math.max(0, Math.round(point.x + (line.end.y - line.start.y) / Math.max(line.length, 1) * 4)));
    const by = Math.min(height - 1, Math.max(0, Math.round(point.y - (line.end.x - line.start.x) / Math.max(line.length, 1) * 4)));
    const bo = (by * width + bx) * channels;
    backgroundValues.push(channels >= 3 ? 0.299 * data[bo] + 0.587 * data[bo + 1] + 0.114 * data[bo + 2] : data[bo]);
  }
  const centerMean = centerValues.reduce((sum, value) => sum + value, 0) / centerValues.length;
  const backgroundMean = backgroundValues.reduce((sum, value) => sum + value, 0) / backgroundValues.length;
  return {
    colorSpace: channels >= 3 ? 'rgb-to-luminance' : 'grayscale',
    sampleCount: values.length,
    meanLuminance: Number(mean.toFixed(2)),
    medianLuminance: Number(percentile(0.5).toFixed(2)),
    luminanceP10: Number(percentile(0.1).toFixed(2)),
    luminanceP90: Number(percentile(0.9).toFixed(2)),
    luminanceStdDev: Number(Math.sqrt(variance).toFixed(2)),
    darkPixelRatio: Number(darkRatio.toFixed(4)),
    centerLuminance: Number(centerMean.toFixed(2)),
    nearbyBackgroundLuminance: Number(backgroundMean.toFixed(2)),
    centerBackgroundContrast: Number(Math.abs(centerMean - backgroundMean).toFixed(2)),
    interpretation: 'appearance evidence only; not a wall/object label'
  };
}

function extractGeometryFeatures(inputLines = [], config = {}) {
  const options = {
    snapTolerance: Number.isFinite(config.snapTolerance) ? config.snapTolerance : 4,
    parallelAngleTolerance: (Number.isFinite(config.parallelAngleToleranceDegrees) ? config.parallelAngleToleranceDegrees : 3) * Math.PI / 180,
    minimumParallelDistance: Number.isFinite(config.minimumParallelDistance) ? config.minimumParallelDistance : 3,
    maximumParallelDistance: Number.isFinite(config.maximumParallelDistance) ? config.maximumParallelDistance : 80,
    endpointSnapTolerance: Number.isFinite(config.endpointSnapTolerance) ? config.endpointSnapTolerance : 4,
    maximumEndpointGap: Number.isFinite(config.maximumEndpointGap) ? config.maximumEndpointGap : 48,
    likelyBoundaryGap: Number.isFinite(config.likelyBoundaryGap) ? config.likelyBoundaryGap : 16,
    minimumParallelOverlap: Number.isFinite(config.minimumParallelOverlap) ? config.minimumParallelOverlap : 20
  };
  const lines = inputLines.map(normalizeSegment).filter(Boolean);
  const mergedLines = mergeCollinearSegments(inputLines, config);
  const topology = topologyEvidence(lines, options);
  const curves = normalizeCurves(config.curves || []);
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
      validLineCount: lines.length,
      mergedCollinearLineCount: mergedLines.length,
      pointCount: points.length,
      junctionCounts: counts,
      properIntersectionCount: rawIntersections.length,
      parallelPairCount: parallelGroups.length,
      disconnectedEndpointPairCount: topology.disconnectedEndpointPairs.length,
      connectedComponentCount: topology.connectedComponents.length,
      isolatedLineCount: topology.isolatedLineIds.length,
      curveCount: curves.length,
      lineSourceCounts: sourceCounts,
      appearanceSampledLineCount: lines.filter(line => sampleLineAppearance(line, config.raster, config)).length
    },
    mergedLines,
    topology,
    curves,
    lines: lines.map(line => ({
      id: line.id,
      source: line.source,
      confidence: line.confidence,
      orientation: line.orientation,
      start: line.start,
      end: line.end,
      length: Number(line.length.toFixed(2)),
      angleDegrees: Number((line.angle * 180 / Math.PI).toFixed(2)),
      appearance: sampleLineAppearance(line, config.raster, config)
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

module.exports = { extractGeometryFeatures, mergeCollinearSegments, sampleLineAppearance };
