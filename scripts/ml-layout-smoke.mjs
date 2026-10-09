#!/usr/bin/env node
/** Smoke: ML walls + layout-count semantics on kujiale samples */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'backend/uploads/floorplans/kujiale-3d');
const outRoot = path.join(root, 'tmp/ml-layout-smoke');
const checkpoint = path.join(root, 'floorplan-ml/checkpoints/wall-best.pt');

function countTypes(rooms = []) {
  const c = { bedrooms: 0, halls: 0, kitchens: 0, baths: 0, other: 0 };
  for (const r of rooms) {
    if (r.type === 'bedroom') c.bedrooms += 1;
    else if (r.type === 'living' || r.type === 'dining') c.halls += 1;
    else if (r.type === 'kitchen') c.kitchens += 1;
    else if (r.type === 'bathroom') c.baths += 1;
    else c.other += 1;
  }
  return c;
}

function parseExpected(roomStr = '') {
  const m = (k) => {
    const hit = String(roomStr).match(new RegExp(`(\\d+)\\s*${k}`));
    return hit ? Number(hit[1]) : 0;
  };
  return { bedrooms: m('室'), halls: m('厅'), kitchens: m('厨'), baths: m('卫') };
}

function layoutAccuracy(expected, got) {
  const keys = ['bedrooms', 'halls', 'kitchens', 'baths'];
  return keys.reduce((s, k) => s + (expected[k] === got[k] ? 1 : 0), 0) / keys.length;
}

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['3FO3AU1POSLY', '3FO3B320SBPH', '3FO3B0IB2K7K', '3FO3AUH30414', '3FO3B79146R6'];

fs.mkdirSync(outRoot, { recursive: true });
const { buildRecognitionDraft } = await import(path.join(root, 'codex-worker/src/recognizers/local-draft.js'));
const { attachMlWallsToPreprocessing } = await import(path.join(root, 'codex-worker/src/recognizers/ml-wall-command.js'));

const rows = [];
for (const id of ids) {
  const views = path.join(dataRoot, id, 'views');
  const image = path.join(views, 'withoutDimensionLine.jpg');
  if (!fs.existsSync(image)) continue;
  const mlOut = path.join(outRoot, id, 'ml-wall');
  fs.mkdirSync(mlOut, { recursive: true });
  spawnSync('python3', [
    '-m', 'buildingcv.infer',
    '--checkpoint', checkpoint,
    '--image', image,
    '--out-dir', mlOut,
    '--device', 'mps'
  ], { cwd: path.join(root, 'floorplan-ml'), env: { ...process.env, PYTHONPATH: path.join(root, 'floorplan-ml') } });

  const wallsPayload = JSON.parse(fs.readFileSync(path.join(mlOut, 'walls.json'), 'utf8'));
  const roomsPayload = JSON.parse(fs.readFileSync(path.join(mlOut, 'rooms.json'), 'utf8'));
  const record = JSON.parse(fs.readFileSync(path.join(dataRoot, id, 'record.json'), 'utf8'));

  let preprocessing = {
    status: 'ok',
    sourcePath: image,
    image: { width: 1600, height: 1440 },
    quality: { score: 0.85 },
    geometryCandidates: { lines: [], roomInteriorCandidates: [], balconyCandidates: [] }
  };
  preprocessing = attachMlWallsToPreprocessing(preprocessing, {
    ok: true,
    walls: wallsPayload.walls,
    wallCount: wallsPayload.wallCount,
    roomInteriors: roomsPayload.roomInteriorCandidates,
    roomInteriorCount: roomsPayload.roomInteriorCandidateCount,
    bestIouAtTrain: wallsPayload.bestIouAtTrain
  });

  const job = {
    job: { source_type: 'digital' },
    floor_plan: { parse_result: {}, room: record.room },
    assets: { local_source_file: image }
  };
  const draft = buildRecognitionDraft(job, preprocessing);
  const expected = parseExpected(record.room);
  const recognized = countTypes(draft.rooms || []);
  const acc = layoutAccuracy(expected, recognized);
  rows.push({
    id,
    expected: record.room,
    expectedCounts: expected,
    recognizedCounts: recognized,
    layoutAccuracy: Number(acc.toFixed(3)),
    rooms: (draft.rooms || []).map((r) => `${r.name}:${r.type}`),
    sources: Object.entries((draft.rooms || []).reduce((m, r) => { m[r.source] = (m[r.source] || 0) + 1; return m; }, {})),
    walls: (draft.walls || []).length,
    threeD: draft.quality?.threeDReadiness?.status,
    commercial: draft.quality?.commercialReadiness?.status
  });
  console.log(`${id} acc=${acc.toFixed(2)} rooms=${(draft.rooms || []).length} 3d=${draft.quality?.threeDReadiness?.status}`);
}

const summary = {
  n: rows.length,
  avgLayoutAccuracy: rows.reduce((s, r) => s + r.layoutAccuracy, 0) / Math.max(1, rows.length),
  rows
};
fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
