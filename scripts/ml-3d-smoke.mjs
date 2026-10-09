#!/usr/bin/env node
/** Smoke: ML walls → recognition draft → formal-plan → 3d-config */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'backend/uploads/floorplans/kujiale-3d');
const outRoot = path.join(root, 'tmp/ml-3d-smoke');
const checkpoint = path.join(root, 'floorplan-ml/checkpoints/wall-best.pt');

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['3FO3AU1POSLY', '3FO3AUH30414'];

fs.mkdirSync(outRoot, { recursive: true });

const { buildRecognitionDraft } = await import(path.join(root, 'codex-worker/src/recognizers/local-draft.js'));
const { attachMlWallsToPreprocessing } = await import(path.join(root, 'codex-worker/src/recognizers/ml-wall-command.js'));
const { generateFormalPlan } = await import(path.join(root, 'codex-worker/src/generators/formal-plan.js'));
const { generateThreeDConfig } = await import(path.join(root, 'codex-worker/src/generators/config-3d.js'));

const rows = [];
for (const id of ids) {
  const views = path.join(dataRoot, id, 'views');
  const image = path.join(views, 'withoutDimensionLine.jpg');
  if (!fs.existsSync(image)) {
    console.warn(`skip ${id}: missing image`);
    continue;
  }

  const caseOut = path.join(outRoot, id);
  const mlOut = path.join(caseOut, 'ml-wall');
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
    job: { job_no: `ML3D-${id}`, source_type: 'digital', input_payload: { style: 'modern-natural' } },
    floor_plan: { id: id, parse_result: {}, room: record.room },
    assets: { local_source_file: image }
  };

  const draft = buildRecognitionDraft(job, preprocessing);
  job.runtimeHints = { recognitionDraft: draft };
  fs.writeFileSync(path.join(caseOut, 'recognition-draft.json'), JSON.stringify(draft, null, 2));

  const formal = generateFormalPlan(job, caseOut);
  const rooms = formal.rooms?.length ? formal.rooms : draft.rooms;
  await generateThreeDConfig(job, caseOut, rooms);

  const threeD = draft.quality?.threeDReadiness || {};
  const configPath = path.join(caseOut, '3d-config.json');
  const configExists = fs.existsSync(configPath);
  let configSummary = null;
  if (configExists) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    configSummary = {
      renderStatus: cfg.renderStatus,
      roomCount: cfg.rooms?.length || 0,
      wallShellCount: cfg.structuralWallShells?.length || cfg.deliverables?.structuralWallShellCount || 0,
      openingCount: cfg.openings?.length || 0,
      proposedOpeningCount: cfg.proposedOpenings?.length || 0
    };
  }

  rows.push({
    id,
    expected: record.room,
    rooms: (draft.rooms || []).map((r) => `${r.name}:${r.type}`),
    walls: (draft.walls || []).length,
    threeDStatus: threeD.status,
    threeDBlockers: threeD.blockers || [],
    threeDScore: threeD.score,
    formalPlanJson: path.join(caseOut, 'formal-plan.json'),
    config3d: configPath,
    configExists,
    configSummary
  });

  console.log(`${id} 3d=${threeD.status} config=${configExists ? 'ok' : 'missing'} rooms=${rooms.length} walls=${draft.walls?.length || 0}`);
}

const summary = { n: rows.length, rows };
fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
