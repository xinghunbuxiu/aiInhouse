import assert from 'node:assert/strict';
import { buildAssetCoverageAudit, serializeSpatialIssues } from './batch-recognition-sample.mjs';

const report = buildAssetCoverageAudit({
  geometryCandidates: {
    lines: [{ id: 'line-1', assetMatch: { assetId: 'wall-interior' } }, { id: 'line-2', start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, thickness: 2 }],
    doorSymbolCandidates: [{ id: 'door-1', assetMatch: { assetId: 'door-single-swing' } }],
    windowSymbolCandidates: [{ id: 'window-1', x: 10, y: 20, width: 30, height: 12 }],
    furnitureSymbolCandidates: [{ id: 'furniture-1', type: 'unknown-chair' }],
    annotationSymbolCandidates: [],
    balconyCandidates: [{ id: 'balcony-1', assetMatch: { assetId: 'balcony-outline' } }],
    structuralWallVectors: [],
    mepSymbolCandidates: [{ id: 'mep-1', type: 'unknown-fixture', confidence: 0.42, start: { x: 8, y: 9 }, end: { x: 18, y: 19 }, thickness: 3 }],
    electricalSymbolCandidates: [{ id: 'electrical-1', assetMatch: { assetId: 'electrical-distribution-box' } }]
  },
  ocrCandidates: [
    { id: 'ocr-room', text: '主卧' },
    { id: 'ocr-empty', text: '   ' },
    { id: 'ocr-size', value: '2800' }
  ]
}, {
  version: 'test-1',
  symbols: [{ id: 'wall-interior' }, { id: 'door-single-swing' }],
  categories: [{ id: 'structure' }]
});

assert.equal(report.candidateCount, 6);
assert.equal(report.matchedCandidateCount, 3);
assert.equal(report.unmatchedCandidateCount, 3);
assert.deepEqual(report.groups.map((group) => group.kind), [
  'door', 'window', 'furniture', 'annotation',
  'balcony', 'plumbing-hvac', 'electrical'
]);
assert.equal(report.unclassifiedTextLeadCount, 2);
assert.equal(report.textReviewLeads[0].text, '主卧');
assert.equal(report.groups.find((group) => group.kind === 'window').unmatchedCandidates[0].bounds.x, 10);
assert(report.unmatchedCandidates.some((candidate) => candidate.id === 'mep-1'));
assert.equal(report.geometryDiagnostics.wallLineCandidateCount, 2);
assert.equal(report.geometryDiagnostics.structuralWallVectorCount, 0);
assert.equal(report.matchRate, 0.5);
assert.equal(report.groups.some((group) => group.kind === 'wall-line'), false);
const unmatchedMep = report.unmatchedCandidates.find((candidate) => candidate.id === 'mep-1');
assert.deepEqual(unmatchedMep.geometryEvidence.start, { x: 8, y: 9 });
assert.equal(unmatchedMep.geometryEvidence.thickness, 3);
const nearestRoomEvidence = { roomId: 'room-nearby', distanceToBounds: 18, withinBounds: false };
const nearestWallEvidence = { wallId: 'wall-nearby', distance: 2, withinSegmentSpan: true };
const serializedIssues = serializeSpatialIssues([{
  code: 'door-not-associated-with-room',
  severity: 'review',
  entityId: 'door-detached',
  nearestRoomEvidence,
  nearestWallEvidence,
  internalDebugField: 'must-not-leak'
}]);
assert.deepEqual(serializedIssues[0].nearestRoomEvidence, nearestRoomEvidence);
assert.deepEqual(serializedIssues[0].nearestWallEvidence, nearestWallEvidence);
assert.equal(Object.hasOwn(serializedIssues[0], 'internalDebugField'), false);
assert.equal(serializedIssues.length, 1);
console.log('Batch recognition asset coverage and spatial evidence serialization tests passed.');
