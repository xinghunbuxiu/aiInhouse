import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildRecognitionDraft, assignOcrSemantics } = require('../codex-worker/src/recognizers/local-draft.js');
const { repairRecognitionTopology } = require('../codex-worker/src/recognizers/topology.js');
const { buildSpatialGraph, validateFloorplanDraft } = require('../codex-worker/src/recognizers/spatial-reasoning.js');
const { buildRecoveryPrompt, normalizeRecognitionDraft } = require('../codex-worker/src/recognizers/ai-command.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeTemplateOnlyPreprocess() {
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
  { text: '卫生间', x: 115, y: 40, width: 10, height: 20, confidence: 0.95 }
]);
assert(adjacentRooms[0].name === '空间A', 'OCR labels outside a room must not relabel that room.');
assert(adjacentRooms[0].type === 'space', 'A neighboring bathroom label must not turn an elevator/adjacent space into a bathroom.');
assert(adjacentRooms[1].name === '卫生间', 'The OCR label should be assigned to the room containing its text center.');

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
