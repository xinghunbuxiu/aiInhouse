import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepareRecognitionDraft } = require('../codex-worker/src/recognizers/local-draft.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
      length: 220
    });
  }

  for (const y of [0, 100, 220]) {
    lines.push({
      id: `h${id++}`,
      source: 'morphology-wall-band',
      orientation: 'horizontal',
      start: { x: 0, y },
      end: { x: 260, y },
      length: 260
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

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiinhouse-recognition-grid-'));
fs.writeFileSync(
  path.join(outputDir, 'recognition-preprocess.json'),
  JSON.stringify(makeWallGridPreprocess(), null, 2),
  'utf8'
);

const result = await prepareRecognitionDraft({
  job: { source_type: 'digital' },
  house: { layout: '两室一厅一卫' },
  floor_plan: {}
}, outputDir, {});

const draft = result.runtimeHints.recognitionDraft;
assert(draft.strategy?.localGeometry === 'opencv_wall_grid_rooms', 'Expected wall-grid room inference strategy.');
assert(draft.geometryRooms?.length === 4, `Expected 4 geometry rooms, got ${draft.geometryRooms?.length || 0}.`);
assert(draft.rooms?.length === 4, `Expected 4 output rooms, got ${draft.rooms?.length || 0}.`);
assert(draft.quality?.semanticFallback === 'template_semantics_on_opencv_wall_grid', 'Expected template semantics on geometry rooms.');

console.log(JSON.stringify({
  ok: true,
  strategy: draft.strategy.localGeometry,
  rooms: draft.rooms.length,
  geometryRooms: draft.geometryRooms.length,
  wallCount: draft.walls.length,
  draftFile: result.runtimeHints.recognitionDraftFile
}, null, 2));
