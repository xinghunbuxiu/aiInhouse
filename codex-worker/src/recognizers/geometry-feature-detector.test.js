'use strict';

const assert = require('node:assert/strict');
const { extractGeometryFeatures, mergeCollinearSegments } = require('./geometry-feature-detector');

const lines = [
  { id: 'horizontal', start: { x: 0, y: 50 }, end: { x: 100, y: 50 } },
  { id: 'vertical-t', start: { x: 50, y: 50 }, end: { x: 50, y: 100 } },
  { id: 'parallel', start: { x: 0, y: 62 }, end: { x: 100, y: 62 } }
];
const result = extractGeometryFeatures(lines, { snapTolerance: 2, minimumParallelDistance: 3, maximumParallelDistance: 30, minimumParallelOverlap: 40 });
assert.equal(result.version, 1, 'feature report must be versioned');
assert.equal(result.summary.validLineCount, 3, 'valid input segments must be preserved');
assert(result.points.some(point => point.type === 't-junction' && point.incidentLineIds.includes('horizontal') && point.incidentLineIds.includes('vertical-t')),
  'a horizontal segment intersected by a vertical segment must yield a T-junction feature');
assert(result.parallelGroups.some(group => group.lineIds.includes('horizontal') && group.lineIds.includes('parallel') && group.distance === 12),
  'nearby parallel lines with sufficient overlap must be reported as geometric evidence');
assert(!result.parallelGroups.some(group => group.lineIds.includes('horizontal') && group.lineIds.includes('vertical-t')),
  'perpendicular lines must not be reported as parallel');

const cross = extractGeometryFeatures([
  { id: 'h', start: { x: 0, y: 20 }, end: { x: 40, y: 20 } },
  { id: 'v', start: { x: 20, y: 0 }, end: { x: 20, y: 40 } }
], { snapTolerance: 1 });
assert(cross.intersections.some(item => Math.abs(item.point.x - 20) < 0.01 && Math.abs(item.point.y - 20) < 0.01),
  'crossing segments must expose the intersection coordinate');
assert(cross.points.some(point => point.type === 'cross-junction' && point.degree === 4),
  'a full horizontal/vertical crossing must expose four rays');

const merged = mergeCollinearSegments([
  { id: 'wall-a', source: 'wall-band', start: { x: 0, y: 10 }, end: { x: 40, y: 10 } },
  { id: 'wall-b', source: 'wall-band', start: { x: 43, y: 11 }, end: { x: 80, y: 10 } },
  { id: 'annotation-close', source: 'dimension-line', start: { x: 5, y: 11 }, end: { x: 75, y: 11 } },
  { id: 'annotation', source: 'dimension-line', start: { x: 0, y: 24 }, end: { x: 80, y: 24 } }
], { mergeDistanceTolerance: 3, mergeGapTolerance: 5 });
assert.equal(merged.length, 3, 'same-source wall segments should merge, while nearby cross-source and distant annotations remain separate');
assert.deepEqual(merged.find(line => line.sourceIds.includes('wall-a')).sourceIds, ['wall-a', 'wall-b'],
  'merged geometry must retain traceable source segment IDs');
assert(!merged.find(line => line.sourceIds.includes('wall-a')).sourceIds.includes('annotation-close'),
  'a nearby dimension line must not merge into a wall line when source provenance differs');
assert(merged.find(line => line.sourceIds.includes('wall-a')).length >= 79,
  'merged geometry should span the combined supported wall segments');

const invalid = extractGeometryFeatures([
  { id: 'zero', start: { x: 4, y: 4 }, end: { x: 4, y: 4 } },
  { id: 'bad', start: { x: null, y: 0 }, end: { x: 10, y: 0 } }
]);
assert.equal(invalid.summary.validLineCount, 0, 'invalid and zero-length segments must not become geometry facts');
assert.equal(invalid.mergedLines.length, 0, 'invalid and zero-length segments must not create merged geometry');


const topology = extractGeometryFeatures([
  { id: 'room-top', source: 'wall-band', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { id: 'room-left', source: 'wall-band', start: { x: 0, y: 0 }, end: { x: 0, y: 80 } },
  { id: 'furniture-edge-a', source: 'symbol-edge', start: { x: 150, y: 10 }, end: { x: 180, y: 10 } },
  { id: 'furniture-edge-b', source: 'symbol-edge', start: { x: 184, y: 10 }, end: { x: 200, y: 10 } }
], { endpointSnapTolerance: 2, maximumEndpointGap: 20, likelyBoundaryGap: 8,
  curves: [{ id: 'door-swing', source: 'door-symbol', center: { x: 0, y: 0 }, radius: 30, startAngle: 0, endAngle: Math.PI / 2 }] });
assert.equal(topology.curves.length, 1, 'explicit arc evidence must be preserved instead of flattened into straight lines');
assert(topology.topology.disconnectedEndpointPairs.some(pair => pair.lineIds.includes('furniture-edge-a') && pair.lineIds.includes('furniture-edge-b') && pair.gap === 4),
  'a small gap between endpoints must be represented as a separate/disconnected relation, not silently joined');
assert(topology.topology.connectedComponents.some(component => component.lineIds.includes('room-top') && component.lineIds.includes('room-left')),
  'lines sharing an endpoint must be grouped into the same connected component');
assert(topology.topology.isolatedLineIds.includes('furniture-edge-a') && topology.topology.isolatedLineIds.includes('furniture-edge-b'),
  'unconnected object-like strokes must remain independently traceable');


const raster = { width: 12, height: 8, channels: 1, data: new Uint8Array(12 * 8).fill(245) };
for (let y = 3; y <= 4; y += 1) for (let x = 1; x <= 10; x += 1) raster.data[y * 12 + x] = 25;
const appearance = extractGeometryFeatures([
  { id: 'dark-wall-candidate', source: 'wall-band', start: { x: 1, y: 3 }, end: { x: 10, y: 3 } }
], { raster, appearanceSampleRadius: 0, appearanceSampleCount: 7 });
const lineAppearance = appearance.lines[0].appearance;
assert(lineAppearance, 'when a raster is provided, line appearance must be sampled');
assert(lineAppearance.darkPixelRatio > 0.9, 'dark stroke should retain its dark-pixel ratio');
assert(lineAppearance.centerBackgroundContrast > 100, 'stroke/background contrast should be recorded');
assert.equal(lineAppearance.interpretation, 'appearance evidence only; not a wall/object label');

// Preprocessing measurements must survive normalization even when the geometry
// recognizer is not given the source raster again.
const precomputedAppearance = {
  colorSpace: 'gray+luminance+meanBGR',
  meanLuminance: 92.5,
  luminanceStdDev: 18.2,
  darkPixelRatio: 0.81,
  meanBGR: [70, 82, 91],
  centerBackgroundContrast: 134,
  interpretation: 'appearance evidence only; not a wall/object label'
};
const preserved = extractGeometryFeatures([
  { id: 'preprocessed-line', source: 'hough-edge',
    start: { x: 1, y: 1 }, end: { x: 20, y: 1 },
    thickness: 3, appearance: precomputedAppearance }
]);
assert.deepEqual(preserved.lines[0].appearance, precomputedAppearance,
  'precomputed luminance and color evidence must survive geometry normalization');
assert.equal(preserved.lines[0].thickness, 3,
  'measured line thickness must remain attached to the geometry primitive');
assert.equal(preserved.summary.appearanceAvailableLineCount, 1,
  'summary must count retained appearance evidence even without a raster');
assert.equal(preserved.summary.appearanceSampledFromRasterLineCount, 0,
  'precomputed evidence must not be mislabeled as newly sampled raster evidence');

const mergedAppearance = mergeCollinearSegments([
  { id: 'appearance-a', source: 'hough-edge', start: { x: 0, y: 0 }, end: { x: 30, y: 0 }, appearance: { meanLuminance: 40, meanBGR: [20, 30, 40] } },
  { id: 'appearance-b', source: 'hough-edge', start: { x: 32, y: 0 }, end: { x: 60, y: 0 }, appearance: { meanLuminance: 180, meanBGR: [170, 180, 190] } }
], { mergeGapTolerance: 4 });
assert.equal(mergedAppearance.length, 1, 'near-collinear same-source segments should merge');
assert.equal(mergedAppearance[0].sourceAppearances.length, 2,
  'merged geometry must retain separate appearance samples from every source line');
assert.deepEqual(mergedAppearance[0].sourceAppearances.map(item => item.appearance.meanLuminance), [40, 180],
  'appearance differences must not be erased by averaging merged segments');

console.log('Geometry feature detector tests passed:', JSON.stringify(result.summary));
