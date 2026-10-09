import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { countVerifiedAttachedOpenings as countBenchmarkAttachedOpenings, summarizeBenchmark } from './benchmark-kujiale-structure-recognition.mjs';
import { collectCandidates, countVerifiedAttachedOpenings as countBatchAttachedOpenings } from './batch-recognition-sample.mjs';

const require = createRequire(import.meta.url);
const { buildRecognitionDraft, assignOcrSemantics, finalizeRecognitionDraft } = require('../codex-worker/src/recognizers/local-draft.js');
const { repairRecognitionTopology } = require('../codex-worker/src/recognizers/topology.js');
const { buildSpatialGraph, validateFloorplanDraft } = require('../codex-worker/src/recognizers/spatial-reasoning.js');
const { buildRecoveryPrompt, normalizeRecognitionDraft } = require('../codex-worker/src/recognizers/ai-command.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn, message) {\n  let threw = false;\n  try { fn(); } catch (_) { threw = true; }\n  assert(threw, message);\n}\n\nfunction makeTemplateOnlyPreprocess() {
  return {
    image: { width: 1000, height: 760 },
    quality: { score: 0.42, issues: ['no-stable-wall-grid'] },
    geometryCandidates: {
      lines: [],
      contours: [],
      wallBandCount: 0
    }
  };
}

function makeWallGridPreprocess() {
  const lines = [];
  let id = 1;
  for (const x of [0, 120, 260]) {
    lines.push({
      id: `v${id++}`,
      source: 'morphology-wall-band',
      orientation: 'vertical',
      start: { x, y: 0 },
      end: { x, y: 220 },
      length: 220,
      thickness: 12,
      confidence: 0.82
    });
  }
  for (const y of [0, 100, 220]) {
    lines.push({
      id: `h${id++}`,
      source: 'morphology-wall-band',
      orientation: 'horizontal',
      start: { x: 0, y },
      end: { x: 260, y },
      length: 260,
      thickness: 12,
      confidence: 0.82
    });
  }
  return {
    image: { width: 300, height: 260 },
    quality: { score: 0.78, issues: [] },
    geometryCandidates: {
      lines,
      contours: [],
      wallBandCount: lines.length
    }
  };
}

// Regression: a room label must never jump across a wall into a neighboring room.
const adjacentRooms = assignOcrSemantics([
  { id: 'elevator-shaft', name: '空间A', type: 'space', x: 0, y: 0, width: 100, height: 100, confidence: 0.7 },
  { id: 'bathroom', name: '空间B', type: 'space', x: 110, y: 0, width: 100, height: 100, confidence: 0.7 }
], [
  { id: 'ocr-bathroom-1', text: '卫生间', x: 115, y: 40, width: 10, height: 20, confidence: 0.95, source: 'opencv-ocr' }
]);
assert(adjacentRooms[0].name === '空间A', 'OCR labels outside a room must not relabel that room.');
assert(adjacentRooms[0].type === 'space', 'A neighboring bathroom label must not turn an elevator/adjacent space into a bathroom.');
assert(adjacentRooms[1].name === '卫生间', 'The OCR label should be assigned to the room containing its text center.');
assert(adjacentRooms[1].sourceEvidence.ocrCandidateId === 'ocr-bathroom-1', 'Assigned room semantics must preserve the originating OCR candidate ID.');
assert(adjacentRooms[1].sourceEvidence.ocrBox.width === 10 && adjacentRooms[1].sourceEvidence.ocrBox.height === 20, 'Assigned room semantics must preserve the OCR box in image coordinates.');
const benchmarkAttachedCount = countBenchmarkAttachedOpenings([
  { id: 'known-good', attachedWallId: 'wall-1' },
  { id: 'no-wall-reference' },
  { id: 'stale-wall-reference', attachedWallId: 'wall-deleted' },
  { id: 'pending-review', attachedWallId: 'wall-1', needsWallAttachmentReview: true }
], [{ id: 'wall-1' }]);
assert(benchmarkAttachedCount === 1, 'Benchmark must count only openings with an explicit existing wall reference and no review flag.');
const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'floorplan-image-input-'));
const candidateImage = path.join(candidateRoot, 'actual-floor-plan.png');
fs.writeFileSync(candidateImage, 'test-image-placeholder');
assert(collectCandidates({ imagePath: candidateImage }).length === 1, 'Batch recognition must accept one explicit floor-plan image path for real-image testing.');
assert(collectCandidates({ imagePath: candidateImage })[0] === candidateImage, 'Explicit image input must be passed through without silently substituting another sample.');
assertThrows(() => collectCandidates({ imagePath: path.join(candidateRoot, 'missing.png') }), 'Missing explicit image paths must fail clearly.');
fs.rmSync(candidateRoot, { recursive: true, force: true });

assert(countBatchAttachedOpenings([
  { id: 'verified', attachedWallId: 'w1' },
  { id: 'missing-ref' },
  { id: 'unknown-ref', attachedWallId: 'w404' },
  { id: 'review', attachedWallId: 'w1', needsWallAttachmentReview: true }
], [{ id: 'w1' }]) === 1, 'Batch evaluation must count only openings explicitly attached to an existing wall and not flagged for review.');

const noGroundTruthSummary = summarizeBenchmark([{
  error: null,
  expected: { layout: '' },
  readinessStatus: 'unknown',
  readinessScore: null
}]);
assert(noGroundTruthSummary.exactLayoutMatchRate === null, 'Missing labeled layout ground truth must produce N/A, not a false 0% accuracy.');
const noValidSampleSummary = summarizeBenchmark([{ error: 'preprocess failed' }]);
assert(noValidSampleSummary.commercialReadyRate === null, 'No valid benchmark samples must produce N/A, not a false 0% readiness rate.');

// Recovery regression: weak first-pass drafts should be reviewed using the
// complete initial draft, with explicit anti-hallucination constraints.
const firstPassDraft = normalizeRecognitionDraft({
  rooms: [{ name: '空间A', type: 'space', x: 0, y: 0, width: 100, height: 100, confidence: 0.4 }],
  walls: [],
  doors: [],
  windows: [],
  confidence: { geometry: 0.4, semantics: 0.4 }
});
assert(firstPassDraft.quality.needsReview, 'A weak first-pass result must trigger recovery.');
const recoveryPrompt = buildRecoveryPrompt('原始户型识别任务', firstPassDraft);
assert(recoveryPrompt.includes('第一次识别结果'), 'Recovery prompt must explicitly identify the first-pass draft.');
assert(recoveryPrompt.includes('电梯井、管道井、设备平台'), 'Recovery prompt must protect special structural spaces.');
assert(recoveryPrompt.includes(JSON.stringify(firstPassDraft, null, 2)), 'Recovery prompt must include the actual first-pass draft.');

// Deterministic spatial-reasoning regressions: adjacency, overlapping rooms,
// and doors that cannot be associated with any room.
const spatialDraft = {
  rooms: [
    { id: 'entry', name: '玄关', type: 'entry', x: 0, y: 0, width: 100, height: 100, confidence: 0.9 },
    { id: 'elevator', name: '电梯井', type: 'shaft', x: 100, y: 0, width: 60, height: 100, confidence: 0.95 },
    { id: 'bathroom', name: '卫生间', type: 'bathroom', x: 180, y: 0, width: 80, height: 100, confidence: 0.88 }
  ],
  walls: [
    { id: 'wall-1', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { id: 'wall-2', start: { x: 100, y: 0 }, end: { x: 160, y: 0 } }
  ],
  doors: [{ id: 'front-door', center: { x: 30, y: 50 } }]
};
const spatialGraph = buildSpatialGraph(spatialDraft);
assert(spatialGraph.nodes.length === 3, 'Spatial graph must preserve each distinct space.');
assert(spatialGraph.edges.some(edge => edge.from === 'entry' && edge.to === 'elevator'), 'Adjacent entry and elevator spaces should be represented in the graph.');
assert(!spatialGraph.edges.some(edge => edge.from === 'entry' && edge.to === 'bathroom'), 'Non-adjacent rooms must not be connected by proximity alone.');
assert(spatialGraph.doorConnections[0].connectedRoomIds.includes('entry'), 'The entry door must be associated with the entry room.');
const overlapping = validateFloorplanDraft({
  rooms: [
    { id: 'a', name: '客厅', type: 'living', x: 0, y: 0, width: 100, height: 100 },
    { id: 'b', name: '卧室', type: 'bedroom', x: 50, y: 50, width: 100, height: 100 }
  ],
  walls: [{ id: 'bad-wall', start: { x: 2, y: 2 }, end: { x: 2, y: 2 } }],
  doors: [{ id: 'lost-door', center: { x: 500, y: 500 } }]
});
assert(!overlapping.valid, 'Zero-length walls must fail geometry validation.');
assert(overlapping.issues.some(issue => issue.code === 'room-bounds-overlap'), 'Overlapping room bounds must be flagged for review.');
assert(overlapping.issues.some(issue => issue.code === 'door-not-associated-with-room'), 'Doors outside all rooms must be flagged.');

const missingCoordinate = validateFloorplanDraft({
  rooms: [{ id: 'missing-x', name: '客厅', type: 'living', x: null, y: 0, width: 100, height: 100 }],
  walls: [{ id: 'missing-point', start: { x: null, y: 0 }, end: { x: 10, y: 0 } }],
  doors: []
});
assert(missingCoordinate.issues.some(issue => issue.code === 'invalid-room-bounds'), 'Null room coordinates must not be coerced to zero.');
assert(missingCoordinate.issues.some(issue => issue.code === 'invalid-wall-segment'), 'Null wall coordinates must be rejected.');

const openingRegressions = validateFloorplanDraft({
  rooms: [{ id: 'room-1', name: '客厅', type: 'living', x: 0, y: 0, width: 100, height: 100 }],
  walls: [
    { id: 'wall-duplicate', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 10 },
    { id: 'wall-duplicate', start: { x: 0, y: 100 }, end: { x: 100, y: 100 }, thickness: 10 }
  ],
  doors: [{ id: 'door-1', x: 20, y: 20, width: 0, height: 8 }],
  windows: [{ id: 'window-lost', x: 500, y: 500, width: 50, height: 8 }]
});
assert(openingRegressions.issues.some(issue => issue.code === 'duplicate-wall-id'), 'Duplicate wall IDs must be detected.');
assert(openingRegressions.issues.some(issue => issue.code === 'invalid-door-dimensions'), 'Non-positive door dimensions must be detected.');
assert(openingRegressions.issues.some(issue => issue.code === 'window-not-associated-with-room'), 'Windows outside all rooms must be flagged for review.');
assert(openingRegressions.metrics.roomGeometryValidRatio === 1, 'Spatial metrics must expose a perfect room geometry ratio for valid rooms.');
assert(openingRegressions.metrics.wallGeometryValidRatio === 1, 'Spatial metrics must expose valid wall geometry ratio separately from duplicate IDs.');
assert(openingRegressions.metrics.openingAssociationRatio === 0.5, 'Spatial metrics must report opening association ratio across doors and windows.');
assert(openingRegressions.metrics.issuesByCode['duplicate-wall-id'] === 1, 'Spatial metrics must count diagnostics by stable issue code.');
assert(openingRegressions.metrics.wallAttachmentRatio === 0, 'Openings without verified wall attachment must not count as attached.');
const attachmentChecks = validateFloorplanDraft({
  rooms: [{ id: 'attachment-room', name: '客厅', type: 'living', x: 0, y: 0, width: 100, height: 100 }],
  walls: [{ id: 'wall-real', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 10 }],
  doors: [
    { id: 'door-attached', x: 30, y: 0, width: 28, height: 8, attachedWallId: 'wall-real' },
    { id: 'door-stale', x: 60, y: 0, width: 28, height: 8, attachedWallId: 'wall-deleted' },
    { id: 'door-review', x: 80, y: 0, width: 28, height: 8, needsWallAttachmentReview: true }
  ],
  windows: []
});
assert(attachmentChecks.metrics.wallAttachedOpeningCount === 1, 'Only openings attached to a current wall and not flagged for review count as verified.');
assert(attachmentChecks.metrics.wallAttachmentRatio === Number((1 / 3).toFixed(4)), 'Wall attachment ratio must reflect all detected openings.');
assert(attachmentChecks.issues.some(issue => issue.code === 'opening-attached-wall-missing' && issue.relatedEntityId === 'wall-deleted'), 'Stale wall references must be reported with the missing wall ID.');
assert(attachmentChecks.issues.some(issue => issue.code === 'opening-wall-attachment-review' && issue.entityId === 'door-review'), 'Openings awaiting wall review must remain visible in diagnostics.');
const evidenceTrace = validateFloorplanDraft({
  rooms: [{ id: 'evidence-room', name: '客厅', type: 'living', x: 0, y: 0, width: 100, height: 100, source: 'opencv-wall-grid', sourceEvidence: { imageBox: { x: 8, y: 12, width: 100, height: 90 }, candidateId: 'room-candidate-7' } }],
  walls: [{ id: 'evidence-wall', start: { x: 10, y: 10 }, end: { x: 10, y: 10 }, source: 'ml-wall', sourceEvidence: { imageSegmentId: 'segment-4', confidence: 0.51 } }],
  doors: [{ id: 'evidence-door', x: 500, y: 500, source: 'door-symbol-scanner', sourceEvidence: { imageBox: { x: 480, y: 490, width: 24, height: 12 } } }],
  windows: []
});
const tracedWallIssue = evidenceTrace.issues.find(issue => issue.code === 'invalid-wall-segment');
assert(tracedWallIssue.entityEvidence?.[0]?.sourceEvidence?.imageSegmentId === 'segment-4', 'Spatial diagnostics must preserve the source evidence for the affected wall.');
const tracedDoorIssue = evidenceTrace.issues.find(issue => issue.code === 'door-not-associated-with-room');
assert(tracedDoorIssue.entityEvidence?.[0]?.sourceEvidence?.imageBox?.x === 480, 'Opening diagnostics must preserve the originating image box.');

const emptyMetrics = validateFloorplanDraft({ rooms: [], walls: [], doors: [], windows: [] }).metrics;
assert(emptyMetrics.roomGeometryValidRatio === null, 'Missing room evidence must be null, not a misleading zero ratio.');
assert(emptyMetrics.wallGeometryValidRatio === null, 'Missing wall evidence must be null, not a misleading zero ratio.');
assert(emptyMetrics.openingAssociationRatio === null, 'Missing opening evidence must be null, not a misleading zero ratio.');
assert(emptyMetrics.wallAttachmentRatio === null, 'Missing opening evidence must not imply a 0% wall attachment rate.');


// Finalization must not silently discard structured diagnostics produced by
// upstream recognizers; downstream logs should retain their code and entity.
const finalizedWithStructuredIssue = finalizeRecognitionDraft({
  rooms: [{ id: 'review-room', name: '待核实空间', type: 'space', x: 0, y: 0, width: 100, height: 100 }],
  walls: [],
  doors: [],
  windows: [],
  issues: [{ code: 'upstream-warning', severity: 'review', entityId: 'review-room' }]
});
assert(
  finalizedWithStructuredIssue.issues.some(issue => issue.includes('upstream-warning') && issue.includes('review-room')),
  'Finalization must preserve structured upstream issues in the serialized issue list.'
);

const invalidFinalizedDraft = finalizeRecognitionDraft({
  rooms: [
    { id: 'bad-room-a', name: '客厅', type: 'living', x: 0, y: 0, width: 100, height: 100 },
    { id: 'bad-room-b', name: '卧室', type: 'bedroom', x: 40, y: 40, width: 100, height: 100 }
  ],
  walls: [{ id: 'zero-wall', start: { x: 10, y: 10 }, end: { x: 10, y: 10 } }],
  doors: [],
  windows: [],
  quality: { needsReview: false }
});
assert(invalidFinalizedDraft.quality.needsReview, 'Spatial validation failures must force the recognition review gate.');
assert(invalidFinalizedDraft.quality.spatialValidation.issueCount > 0, 'Finalized quality must expose spatial validation issue counts.');
assert(invalidFinalizedDraft.quality.spatialValidation.metrics.roomGeometryValidRatio === 1, 'Finalized quality must expose spatial metrics to downstream consumers.');
assert(invalidFinalizedDraft.quality.spatialValidation.metrics.reviewCount > 0, 'Finalized quality metrics must preserve review diagnostics.');



const job = {
  job: {
    job_no: 'VERIFY-2D-3D',
    source_type: 'digital',
    input_payload: {}
  },
  house: { layout: '两室一厅一卫' },
  floor_plan: {}
};

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiinhouse-2d-3d-readiness-'));
const templateDraft = repairRecognitionTopology(buildRecognitionDraft(job, makeTemplateOnlyPreprocess()));
const templateReadiness = templateDraft.quality.threeDReadiness;
assert(templateReadiness.status !== 'ready_for_3d', 'Template-only recognition must not be ready for automatic 3D.');
assert(templateReadiness.blockers.includes('template-dependent-rooms'), 'Template-only recognition should report template-dependent rooms.');
assert(templateDraft.rooms.every((room) => room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview), 'Template rooms should require boundary review.');

const gridDraft = repairRecognitionTopology(buildRecognitionDraft(job, makeWallGridPreprocess()));
const gridReadiness = gridDraft.quality.threeDReadiness;
assert(gridDraft.geometryRooms.length >= 4, `Expected wall-grid geometry rooms, got ${gridDraft.geometryRooms.length}.`);
assert(gridReadiness.metrics.geometryProofRatio >= 0.55, 'Wall-grid recognition should carry geometry proof for 3D review.');

const firstWall = gridDraft.walls[0];
const proposedDraft = repairRecognitionTopology({
  ...gridDraft,
  windows: [
    ...(gridDraft.windows || []),
    {
      id: 'proposed-window-regression',
      type: 'window',
      source: 'window-symbol-scanner',
      x: (firstWall.start.x + firstWall.end.x) / 2,
      y: (firstWall.start.y + firstWall.end.y) / 2,
      width: 48,
      height: 8,
      confidence: 0.78,
      sourceEvidence: {
        needsVisualConfirmation: true,
        nearExteriorEnvelope: true,
        exteriorSides: ['left']
      }
    }
  ]
});
const proposedReadiness = proposedDraft.quality.threeDReadiness;
assert(proposedReadiness.metrics.proposedOpeningCount >= 1, 'Proposed openings must be counted separately.');
assert(proposedReadiness.blockers.includes('proposed-openings-require-review'), 'Proposed openings must block automatic 3D readiness.');
assert(proposedReadiness.status !== 'ready_for_3d', 'A draft with unresolved proposed openings must not be ready for automatic 3D.');

fs.writeFileSync(path.join(outputDir, 'template-draft.json'), JSON.stringify(templateDraft, null, 2), 'utf8');
fs.writeFileSync(path.join(outputDir, 'grid-draft.json'), JSON.stringify(gridDraft, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: true,
  outputDir,
  template: {
    status: templateReadiness.status,
    blockers: templateReadiness.blockers,
    boundaryReviewCount: templateReadiness.metrics.boundaryReviewCount
  },
  grid: {
    status: gridReadiness.status,
    geometryRooms: gridDraft.geometryRooms.length,
    geometryProofRatio: gridReadiness.metrics.geometryProofRatio,
    blockers: gridReadiness.blockers
  },
  proposedOpeningGate: {
    status: proposedReadiness.status,
    confirmedOpeningCount: proposedReadiness.metrics.confirmedOpeningCount,
    proposedOpeningCount: proposedReadiness.metrics.proposedOpeningCount,
    blockers: proposedReadiness.blockers
  }
}, null, 2));
