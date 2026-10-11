import assert from 'node:assert/strict';
import { buildAssetCoverageAudit } from './batch-recognition-sample.mjs';

const report = buildAssetCoverageAudit({
  geometryCandidates: {
    lines: [{ id: 'line-1', assetMatch: { assetId: 'wall-interior' } }, { id: 'line-2', start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, thickness: 2 }],
    doorSymbolCandidates: [{ id: 'door-1', assetMatch: { assetId: 'door-single-swing' } }],
    windowSymbolCandidates: [{ id: 'window-1', x: 10, y: 20, width: 30, height: 12 }],
    furnitureSymbolCandidates: [{ id: 'furniture-1', type: 'unknown-chair' }],
    annotationSymbolCandidates: [],
    balconyCandidates: [{ id: 'balcony-1', assetMatch: { assetId: 'balcony-outline' } }],
    structuralWallVectors: [],
    mepSymbolCandidates: [{ id: 'mep-1', type: 'unknown-fixture', confidence: 0.42 }],
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
assert.equal(report.matchedCandidateCount, 4);
assert.equal(report.unmatchedCandidateCount, 2);
assert.deepEqual(report.groups.map((group) => group.kind), [
  'wall-line', 'door', 'window', 'furniture', 'annotation',
  'balcony', 'structural-vector', 'plumbing-hvac', 'electrical'
]);
assert.equal(report.unclassifiedTextLeadCount, 2);
assert.equal(report.textReviewLeads[0].text, '主卧');
assert.equal(report.groups.find((group) => group.kind === 'window').unmatchedCandidates[0].bounds.x, 10);
assert(report.unmatchedCandidates.some((candidate) => candidate.id === 'mep-1'));
assert.equal(report.geometryDiagnostics.wallLineCandidateCount, 2);
assert.equal(report.geometryDiagnostics.structuralWallVectorCount, 0);
assert.equal(report.matchRate, 0.6667);
assert.equal(report.groups.some((group) => group.kind === 'wall-line'), false);
const unmatchedLine = report.unmatchedCandidates.find((candidate) => candidate.id === 'line-2');
assert.deepEqual(unmatchedLine.geometryEvidence.start, { x: 1, y: 2 });
assert.equal(unmatchedLine.geometryEvidence.thickness, 2);
console.log('Batch recognition asset coverage tests passed.');
