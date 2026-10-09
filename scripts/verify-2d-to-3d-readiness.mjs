import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildRecognitionDraft } = require('../codex-worker/src/recognizers/local-draft.js');
const { repairRecognitionTopology } = require('../codex-worker/src/recognizers/topology.js');

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
