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

console.log('Geometry feature detector tests passed:', JSON.stringify(result.summary));
