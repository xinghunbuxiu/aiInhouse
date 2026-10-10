import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildRecognitionDraft } = require('../codex-worker/src/recognizers/local-draft.js');
const { repairRecognitionTopology } = require('../codex-worker/src/recognizers/topology.js');
const { validateFloorplanDraft } = require('../codex-worker/src/recognizers/spatial-reasoning.js');

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

export function parseLayout(filePath, layoutOverride = '') {
  const match = String(layoutOverride || path.basename(filePath)).match(/(\d+)室(\d+)厅(\d+)厨(\d+)卫/);
  if (!match) {
    return { layout: '', bedrooms: 0, halls: 0, kitchens: 0, baths: 0 };
  }
  return {
    layout: `${match[1]}室${match[2]}厅${match[3]}厨${match[4]}卫`,
    bedrooms: Number(match[1]),
    halls: Number(match[2]),
    kitchens: Number(match[3]),
    baths: Number(match[4])
  };
}

export function collectCandidates({ imagePath = '', repoRoot = root } = {}) {
  if (imagePath) {
    const resolvedImage = path.resolve(imagePath);
    if (!fs.existsSync(resolvedImage) || !fs.statSync(resolvedImage).isFile()) {
      throw new Error(`Input floor-plan image does not exist or is not a file: ${resolvedImage}`);
    }
    if (!/\.(jpe?g|png|webp)$/i.test(resolvedImage)) {
      throw new Error(`Unsupported floor-plan image format: ${resolvedImage}. Use JPG, PNG, or WEBP.`);
    }
    return [resolvedImage];
  }
  const patterns = [
    '2室2厅1厨1卫',
    '2室2厅1厨2卫',
    '3室2厅1厨1卫',
    '3室2厅1厨2卫',
    '3室2厅0厨2卫',
    '4室2厅1厨2卫',
    '4室2厅0厨3卫',
    '5室4厅1厨2卫',
    '1室2厅1厨2卫',
    '2室1厅1厨1卫'
  ];
  const roots = [
    path.join(repoRoot, 'backend/uploads/floorplans/kujiale-xinfu'),
    path.join(repoRoot, 'backend/uploads/floorplans/kujiale')
  ];
  const all = [];
  for (const base of roots) {
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(fullPath);
        else if (entry.name.includes('/images/') === false && /images/.test(fullPath) && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
          all.push(fullPath);
        }
      }
    }
  }

  const picked = [];
  const used = new Set();
  for (const pattern of patterns) {
    const hit = all.find((file) => path.basename(file).includes(pattern) && !used.has(file));
    if (hit) {
      used.add(hit);
      picked.push(hit);
    }
  }

  const locals = [
    path.join(repoRoot, 'backend/uploads/file-1781863511304-851193311.jpg'),
    path.join(repoRoot, 'backend/uploads/file-1781963251222-579906215.jpg')
  ].filter((file) => fs.existsSync(file));

  return [...locals, ...picked];
}

function slugify(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80);
}

function writeJob(filePath, outputDir, layoutOverride = '') {
  const job = {
    job: {
      job_no: `BATCH-${slugify(filePath)}`,
      job_type: 'parse_floor_plan',
      source_type: 'digital'
    },
    floor_plan: {
      name: path.basename(filePath, path.extname(filePath)),
      image_url: filePath
    },
    house: {
      layout: parseLayout(filePath, layoutOverride).layout
    },
    assets: {
      local_source_file: filePath
    }
  };
  const jobFile = path.join(outputDir, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8');
  return jobFile;
}

function runPreprocess(jobFile, outputDir) {
  const script = path.join(root, 'scripts', 'floorplan-preprocess.mjs');
  const result = spawnSync(process.execPath, [script, '--job', jobFile, '--output', outputDir], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'preprocess failed');
  }
}

export function countVerifiedAttachedOpenings(openings = [], walls = []) {
  const wallIds = new Set(walls.map((wall, index) => String(wall.id || `wall-${index + 1}`)));
  return openings.filter((item) => {
    const wallId = item.attachedWallId || item.sourceEvidence?.attachedWallId;
    return Boolean(wallId && wallIds.has(String(wallId)) && !item.needsWallAttachmentReview);
  }).length;
}

function evaluateImage(filePath, outputDir, layoutOverride = '') {
  fs.mkdirSync(outputDir, { recursive: true });
  const jobFile = writeJob(filePath, outputDir, layoutOverride);
  runPreprocess(jobFile, outputDir);
  const preprocessing = JSON.parse(fs.readFileSync(path.join(outputDir, 'recognition-preprocess.json'), 'utf8'));
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const draft = buildRecognitionDraft(job, preprocessing);
  const repaired = repairRecognitionTopology(draft);
  const openings = [...(repaired.doors || []), ...(repaired.windows || [])];
  const readiness = repaired.quality?.commercialReadiness || {};
  const verifiedAttachedOpenings = countVerifiedAttachedOpenings(openings, repaired.walls || []);
  const attachedOpeningRatio = openings.length ? verifiedAttachedOpenings / openings.length : null;
  const spatialValidation = validateFloorplanDraft({
    rooms: repaired.rooms || [],
    walls: repaired.walls || [],
    doors: repaired.doors || [],
    windows: repaired.windows || []
  });
  const blockingReasons = readiness.blockingReasons || [];
  const requiresHumanReview = readiness.status === 'needs_human_review'
    || blockingReasons.some((reason) => /review|复核|人工/i.test(String(reason)))
    || Boolean(repaired.quality?.needsReview);

  return {
    image: filePath,
    name: path.basename(filePath),
    layout: parseLayout(filePath, layoutOverride).layout,
    strategy: repaired.strategy?.localGeometry || '',
    geometryConfidence: repaired.confidence?.geometry ?? null,
    semanticsConfidence: repaired.confidence?.semantics ?? null,
    rooms: (repaired.rooms || []).length,
    roomNames: (repaired.rooms || []).map((room) => room.name || room.id),
    walls: (repaired.walls || []).length,
    openings: openings.length,
    openingEvidence: {
      confirmedCount: readiness.metrics?.confirmedOpeningCount ?? null,
      proposedCount: readiness.metrics?.proposedOpeningCount ?? null,
      suppressedCount: repaired.topology?.suppressedOpeningCount ?? 0,
      bySource: openings.reduce((counts, opening) => {
        const source = opening.source || 'unknown';
        counts[source] = (counts[source] || 0) + 1;
        return counts;
      }, {}),
      proposedIds: openings
        .filter((opening) => opening.sourceEvidence?.needsVisualConfirmation
          || opening.source === 'semantic-room-opening-prior')
        .map((opening) => opening.id || null),
      suppressed: repaired.topology?.suppressedOpenings || []
    },
    attachedOpeningRatio: attachedOpeningRatio == null ? null : Number(attachedOpeningRatio.toFixed(2)),
    readinessStatus: readiness.status || 'unknown',
    readinessScore: readiness.score ?? null,
    requiresHumanReview,
    blockingReasons,
    spatialValidation: {
      valid: spatialValidation.valid,
      reviewRequired: spatialValidation.reviewRequired,
      status: !spatialValidation.valid
        ? 'invalid'
        : spatialValidation.reviewRequired
          ? 'review_required'
          : 'passed',
      issueCount: (spatialValidation.issues || []).length,
      issuesByCode: spatialValidation.metrics?.issuesByCode || {},
      issues: (spatialValidation.issues || []).map(({ code, severity, message, entityId, relatedEntityId }) => ({
        code, severity, message, entityId, relatedEntityId
      })),
      metrics: spatialValidation.metrics || {}
    },
    outputDir
  };
}

function summarize(results) {
  const valid = results.filter((row) => !row.error);
  const ready = valid.filter((row) => row.readinessStatus === 'commercial_ready');
  const review = valid.filter((row) => row.requiresHumanReview);
  const blocked = valid.filter((row) => row.readinessStatus === 'blocked');
  return {
    total: results.length,
    valid: valid.length,
    failed: results.length - valid.length,
    commercialReady: ready.length,
    needsHumanReview: review.length,
    blocked: blocked.length,
    confirmedOpenings: valid.reduce((sum, row) => sum + Number(row.openingEvidence?.confirmedCount || 0), 0),
    proposedOpenings: valid.reduce((sum, row) => sum + Number(row.openingEvidence?.proposedCount || 0), 0),
    suppressedOpenings: valid.reduce((sum, row) => sum + Number(row.openingEvidence?.suppressedCount || 0), 0),
    spatialReviewRequired: valid.filter((row) => row.spatialValidation?.reviewRequired).length,
    commercialReadyRate: valid.length ? Number((ready.length / valid.length * 100).toFixed(1)) : null,
    avgReadinessScore: Number((valid.reduce((sum, row) => sum + Number(row.readinessScore || 0), 0) / Math.max(1, valid.length)).toFixed(2)),
    avgGeometryConfidence: Number((valid.reduce((sum, row) => sum + Number(row.geometryConfidence || 0), 0) / Math.max(1, valid.length)).toFixed(2)),
    avgSemanticsConfidence: Number((valid.reduce((sum, row) => sum + Number(row.semanticsConfidence || 0), 0) / Math.max(1, valid.length)).toFixed(2)),
    avgRooms: Number((valid.reduce((sum, row) => sum + row.rooms, 0) / Math.max(1, valid.length)).toFixed(1)),
    avgAttachedOpeningRatio: valid.length && valid.some((row) => row.attachedOpeningRatio != null)
      ? Number((valid.filter((row) => row.attachedOpeningRatio != null).reduce((sum, row) => sum + row.attachedOpeningRatio, 0) / valid.filter((row) => row.attachedOpeningRatio != null).length).toFixed(2))
      : null
  };
}

function main() {
  const limit = Number(getArg('--limit', '12')) || 12;
  const outputRoot = path.resolve(getArg('--output', path.join(root, 'tmp', 'batch-recognition-multi')));
  const requestedImage = getArg('--image');
  const requestedLayout = getArg('--layout');
  const discoveredImages = collectCandidates({ imagePath: requestedImage });
  if (discoveredImages.length === 0) {
    throw new Error(
      'No floor-plan images found for batch recognition. Check backend/uploads/floorplans/kujiale(-xinfu), or add one of the configured local upload images before running this script.'
    );
  }
  const images = discoveredImages.slice(0, limit);
  fs.mkdirSync(outputRoot, { recursive: true });

  const results = [];
  for (const image of images) {
    const outDir = path.join(outputRoot, slugify(image));
    const started = Date.now();
    try {
      const row = evaluateImage(image, outDir, requestedLayout);
      results.push({ ...row, durationMs: Date.now() - started });
      process.stderr.write(`OK ${path.basename(image)} -> ${row.readinessStatus}:${row.readinessScore} rooms=${row.rooms}\n`);
    } catch (error) {
      results.push({
        image,
        name: path.basename(image),
        error: error.message,
        durationMs: Date.now() - started
      });
      process.stderr.write(`ERR ${path.basename(image)} -> ${error.message}\n`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    aggregate: summarize(results),
    results
  };

  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.aggregate, null, 2));
  for (const row of results) {
    if (row.error) {
      console.log(`- ${row.name}: ERROR ${row.error}`);
      continue;
    }
    console.log(`- ${row.name} [${row.layout || '未知户型'}] -> ${row.readinessStatus} ${row.readinessScore}, 几何${row.geometryConfidence}, 语义${row.semanticsConfidence}, 房间${row.rooms}, 门窗贴墙${row.attachedOpeningRatio == null ? 'N/A' : `${(row.attachedOpeningRatio * 100).toFixed(0)}%`}`);
  }

}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
