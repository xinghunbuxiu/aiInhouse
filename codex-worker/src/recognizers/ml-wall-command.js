const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { projectRoot } = require('../config');

const repoRoot = path.resolve(projectRoot, '..');
const defaultCheckpoint = path.join(repoRoot, 'floorplan-ml', 'checkpoints', 'wall-best.pt');
const defaultPython = process.env.CODEX_ML_WALL_PYTHON || 'python3';

function isMlWallEnabled() {
  const flag = String(process.env.CODEX_ML_WALL_ENABLED || '1').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') {
    return false;
  }
  const ckpt = process.env.CODEX_ML_WALL_CHECKPOINT || defaultCheckpoint;
  return fs.existsSync(ckpt);
}

function resolveSourceImage(job = {}, preprocessing = {}) {
  const candidates = [
    preprocessing?.preprocessedImagePath,
    preprocessing?.sourcePath,
    job?.assets?.local_source_file,
    job?.floor_plan?.local_source_file,
    job?.floor_plan?.source_file
  ].filter(Boolean);
  for (const candidate of candidates) {
    const abs = path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }
  return '';
}

function runMlWallInference({ imagePath, outputDir, timeoutMs = 120000 } = {}) {
  if (!isMlWallEnabled() || !imagePath) {
    return null;
  }

  const checkpoint = process.env.CODEX_ML_WALL_CHECKPOINT || defaultCheckpoint;
  const outDir = path.join(outputDir || path.dirname(imagePath), 'ml-wall');
  fs.mkdirSync(outDir, { recursive: true });

  const env = {
    ...process.env,
    PYTHONPATH: [
      path.join(repoRoot, 'floorplan-ml'),
      process.env.PYTHONPATH || ''
    ].filter(Boolean).join(path.delimiter)
  };

  const result = spawnSync(
    defaultPython,
    [
      '-m', 'buildingcv.infer',
      '--checkpoint', checkpoint,
      '--image', imagePath,
      '--out-dir', outDir,
      '--device', process.env.CODEX_ML_WALL_DEVICE || 'mps'
    ],
    {
      cwd: path.join(repoRoot, 'floorplan-ml'),
      env,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024
    }
  );

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message || result.stderr || `ml-wall exit ${result.status}`,
      stdout: result.stdout || '',
      stderr: result.stderr || ''
    };
  }

  const wallsFile = path.join(outDir, 'walls.json');
  if (!fs.existsSync(wallsFile)) {
    return { ok: false, error: 'walls.json missing', stdout: result.stdout || '' };
  }

  const payload = JSON.parse(fs.readFileSync(wallsFile, 'utf8'));
  const roomsFile = path.join(outDir, 'rooms.json');
  let roomInteriors = [];
  if (fs.existsSync(roomsFile)) {
    const roomsPayload = JSON.parse(fs.readFileSync(roomsFile, 'utf8'));
    roomInteriors = roomsPayload.roomInteriorCandidates || [];
  }
  return {
    ok: true,
    outDir,
    walls: payload.walls || [],
    wallCount: payload.wallCount || (payload.walls || []).length,
    roomInteriors,
    roomInteriorCount: roomInteriors.length,
    meta: payload.meta || {},
    bestIouAtTrain: payload.bestIouAtTrain,
    maskPath: path.join(outDir, 'wall-mask.png'),
    overlayPath: path.join(outDir, 'wall-overlay.jpg'),
    raw: payload
  };
}

function attachMlWallsToPreprocessing(preprocessing = {}, mlWall = null) {
  if (!mlWall?.ok || !Array.isArray(mlWall.walls) || !mlWall.walls.length) {
    return preprocessing;
  }

  const mlGridLines = mlWall.walls
    .filter((wall) => wall.orientation === 'horizontal' || wall.orientation === 'vertical')
    .map((wall, index) => {
      const x1 = Number(wall.start?.x || 0);
      const y1 = Number(wall.start?.y || 0);
      const x2 = Number(wall.end?.x || 0);
      const y2 = Number(wall.end?.y || 0);
      const length = Number(wall.length || Math.hypot(x2 - x1, y2 - y1));
      return {
        id: wall.id || `ml-grid-line-${index + 1}`,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        orientation: wall.orientation,
        source: 'ml-wall-grid-support-line',
        length,
        confidence: Number(wall.confidence || 0.86),
        thickness: Number(wall.thickness || 8)
      };
    });

  const next = { ...(preprocessing || {}) };
  next.mlWall = {
    enabled: true,
    wallCount: mlWall.wallCount,
    roomInteriorCount: mlWall.roomInteriorCount || (mlWall.roomInteriors || []).length,
    gridLineCount: mlGridLines.length,
    bestIouAtTrain: mlWall.bestIouAtTrain,
    maskPath: mlWall.maskPath,
    overlayPath: mlWall.overlayPath,
    outDir: mlWall.outDir
  };
  const existingLines = next.geometryCandidates?.lines || [];
  next.geometryCandidates = {
    ...(next.geometryCandidates || {}),
    mlWallSegments: mlWall.walls,
    mlWallSegmentCount: mlWall.walls.length,
    mlRoomInteriorCandidates: mlWall.roomInteriors || [],
    mlRoomInteriorCandidateCount: (mlWall.roomInteriors || []).length,
    lines: mlGridLines.length >= 6
      ? [...mlGridLines, ...existingLines.filter((line) => line.source !== 'ml-wall-grid-support-line')]
      : existingLines,
    wallBandCount: mlGridLines.length >= 6 ? mlGridLines.length : (next.geometryCandidates?.wallBandCount || 0)
  };
  if ((mlWall.roomInteriors || []).length >= 2) {
    next.geometryCandidates.roomInteriorCandidates = mlWall.roomInteriors;
    next.geometryCandidates.roomInteriorCandidateCount = mlWall.roomInteriors.length;
  }
  return next;
}

module.exports = {
  isMlWallEnabled,
  resolveSourceImage,
  runMlWallInference,
  attachMlWallsToPreprocessing,
  defaultCheckpoint
};
