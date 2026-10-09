import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  collectManifestRecords,
  ensureDir,
  getArg,
  hasFlag,
  readJson,
  sanitizeFileName,
  writeJson
} from './lib/kujiale-shared.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildRecognitionDraft, finalizeRecognitionDraft } = require('../codex-worker/src/recognizers/local-draft.js');
const { repairRecognitionTopology } = require('../codex-worker/src/recognizers/topology.js');
const argv = process.argv.slice(2);

const VIEW_KEYS = ['wallCenterLine', 'withoutDimensionLine', 'insideTheWall', 'imageUrl'];
const TYPE_MAP = {
  bedroom: 'bedrooms',
  living: 'halls',
  dining: 'halls',
  kitchen: 'kitchens',
  bathroom: 'baths'
};

export function parseLayoutText(text = '') {
  const match = String(text).match(/(\d+)室(\d+)厅(\d+)厨(\d+)卫/);
  if (!match) {
    return {
      layout: '',
      bedrooms: 0,
      halls: 0,
      kitchens: 0,
      baths: 0,
      mainRoomCount: 0
    };
  }
  const bedrooms = Number(match[1]);
  const halls = Number(match[2]);
  const kitchens = Number(match[3]);
  const baths = Number(match[4]);
  return {
    layout: `${bedrooms}室${halls}厅${kitchens}厨${baths}卫`,
    bedrooms,
    halls,
    kitchens,
    baths,
    mainRoomCount: bedrooms + halls + kitchens + baths
  };
}

export function countRecognizedLayout(rooms = []) {
  const counts = {
    bedrooms: 0,
    halls: 0,
    kitchens: 0,
    baths: 0,
    balcony: 0,
    other: 0
  };
  for (const room of rooms) {
    const type = room.type || 'space';
    if (type === 'bedroom') counts.bedrooms += 1;
    else if (type === 'living' || type === 'dining') counts.halls += 1;
    else if (type === 'kitchen') counts.kitchens += 1;
    else if (type === 'bathroom') counts.baths += 1;
    else if (type === 'balcony') counts.balcony += 1;
    else counts.other += 1;
  }
  counts.mainRoomCount = counts.bedrooms + counts.halls + counts.kitchens + counts.baths;
  return counts;
}

export function compareLayout(expected, recognized) {
  const deltas = {
    bedrooms: recognized.bedrooms - expected.bedrooms,
    halls: recognized.halls - expected.halls,
    kitchens: recognized.kitchens - expected.kitchens,
    baths: recognized.baths - expected.baths,
    mainRoomCount: recognized.mainRoomCount - expected.mainRoomCount
  };
  const absDelta = Object.values(deltas).reduce((sum, value) => sum + Math.abs(value), 0);
  const exactMatch = absDelta === 0;
  const perTypeMatches = ['bedrooms', 'halls', 'kitchens', 'baths']
    .map((key) => (recognized[key] === expected[key] ? 1 : 0));
  const layoutAccuracy = Number((perTypeMatches.reduce((sum, hit) => sum + hit, 0) / 4).toFixed(3));
  return {
    deltas,
    absDelta,
    exactMatch,
    layoutAccuracy
  };
}

function buildManifestIndex() {
  const roots = [
    path.join(root, 'backend/uploads/floorplans/kujiale'),
    path.join(root, 'backend/uploads/floorplans/kujiale-xinfu')
  ];
  const index = new Map();
  for (const records of roots.map((dir) => collectManifestRecords(dir))) {
    for (const record of records) {
      const designId = record.id || record.raw?.obsDesignId || record.raw?.obsPlanId;
      if (!designId || index.has(designId)) continue;
      const layoutText = record.room || record.raw?.specsInfo || '';
      index.set(designId, {
        designId,
        name: record.name || '',
        layoutText,
        expected: parseLayoutText(layoutText),
        area: record.area || record.raw?.buildArea || '',
        community: record.community || record.raw?.commName || '',
        isBim: Boolean(record.raw?.isBim),
        manifestImage: record.localFile || ''
      });
    }
  }
  return index;
}

function collectStructureSamples(dataRoot, viewKey) {
  if (!fs.existsSync(dataRoot)) {
    return [];
  }
  return fs.readdirSync(dataRoot)
    .map((designId) => {
      const viewsDir = path.join(dataRoot, designId, 'views');
      const imagePath = path.join(viewsDir, `${viewKey}.jpg`);
      if (!fs.existsSync(imagePath)) {
        return null;
      }
      return {
        designId,
        imagePath,
        viewsDir
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.designId.localeCompare(b.designId));
}

function writeJob(sample, manifest, outputDir) {
  const job = {
    job: {
      job_no: `BENCH-${sample.designId}`,
      job_type: 'parse_floor_plan',
      source_type: 'digital'
    },
    floor_plan: {
      name: manifest?.name || sample.designId,
      image_url: sample.imagePath
    },
    house: {
      layout: manifest?.expected?.layout || ''
    },
    assets: {
      local_source_file: path.resolve(sample.imagePath)
    }
  };
  const jobFile = path.join(outputDir, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8');
  return jobFile;
}

function runPreprocess(jobFile, outputDir) {
  const script = path.join(root, 'scripts/floorplan-preprocess.mjs');
  const result = spawnSync(process.execPath, [script, '--job', jobFile, '--output', outputDir], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'preprocess failed').slice(0, 2000));
  }
  if (!fs.existsSync(path.join(outputDir, 'recognition-preprocess.json'))) {
    throw new Error('preprocess did not write recognition-preprocess.json');
  }
}

function countAssetMatched(list = []) {
  return list.filter((item) => item?.assetMatch?.assetId).length;
}

export function countVerifiedAttachedOpenings(openings = [], walls = []) {
  const wallIds = new Set(walls.map((wall, index) => String(wall.id || `wall-${index + 1}`)));
  return openings.filter((item) => {
    const wallId = item.attachedWallId || item.sourceEvidence?.attachedWallId;
    return Boolean(wallId && wallIds.has(String(wallId)) && !item.needsWallAttachmentReview);
  }).length;
}

function geometryProxyMetrics(preprocessing, repaired) {
  const geometry = preprocessing.geometryCandidates || {};
  const assets = preprocessing.recognitionAssets || {};
  const rooms = repaired.rooms || [];
  const geometryRooms = repaired.geometryRooms || [];
  const doors = repaired.doors || [];
  const windows = repaired.windows || [];
  const openings = [...doors, ...windows];

  const wallBandCount = Number(geometry.wallBandCount || geometry.lines?.filter((line) => /wall-band|morphology-wall-band/.test(line.source || '')).length || 0);
  const roomInteriorCount = Number(geometry.roomInteriorCandidateCount || geometry.roomInteriorCandidates?.length || 0);
  const doorSymbolCount = Number(geometry.doorSymbolCandidateCount || geometry.doorSymbolCandidates?.length || 0);
  const windowSymbolCount = Number(geometry.windowSymbolCandidateCount || geometry.windowSymbolCandidates?.length || 0);
  const furnitureSymbolCount = Number(geometry.furnitureSymbolCandidateCount || geometry.furnitureSymbolCandidates?.length || 0);
  const mepSymbolCount = Number(geometry.mepSymbolCandidateCount || geometry.mepSymbolCandidates?.length || 0);
  const electricalSymbolCount = Number(geometry.electricalSymbolCandidateCount || geometry.electricalSymbolCandidates?.length || 0);
  const annotationSymbolCount = Number(geometry.annotationSymbolCandidateCount || geometry.annotationSymbolCandidates?.length || 0);

  function ratio(recognized, detected) {
    if (!detected) return null;
    return Number(Math.min(1, recognized / detected).toFixed(3));
  }

  return {
    preprocess: {
      wallBandCount,
      roomInteriorCount,
      doorSymbolCount,
      windowSymbolCount,
      furnitureSymbolCount,
      mepSymbolCount,
      electricalSymbolCount,
      annotationSymbolCount,
      lineCount: geometry.lines?.length || 0
    },
    recognitionAssets: {
      version: assets.version || '',
      matchedCandidateCount: Number(assets.matchedCandidateCount || 0),
      excludedAnnotationLineCount: Number(assets.excludedAnnotationLineCount || 0),
      doorAssetMatchCount: countAssetMatched(geometry.doorSymbolCandidates || []),
      windowAssetMatchCount: countAssetMatched(geometry.windowSymbolCandidates || []),
      furnitureAssetMatchCount: countAssetMatched(geometry.furnitureSymbolCandidates || []),
      mepAssetMatchCount: countAssetMatched(geometry.mepSymbolCandidates || []),
      electricalAssetMatchCount: countAssetMatched(geometry.electricalSymbolCandidates || [])
    },
    recognized: {
      walls: (repaired.walls || []).length,
      geometryRooms: geometryRooms.length,
      rooms: rooms.length,
      doors: doors.length,
      windows: windows.length,
      openings: openings.length
    },
    recallProxy: {
      wallRecall: ratio((repaired.walls || []).length, wallBandCount),
      roomRecall: ratio(geometryRooms.length || rooms.length, roomInteriorCount),
      doorRecall: ratio(doors.length, doorSymbolCount),
      windowRecall: ratio(windows.length, windowSymbolCount)
    }
  };
}

export function evaluateStructureSample(sample, manifest, options) {
  const outputDir = path.join(options.outputRoot, 'samples', sanitizeFileName(sample.designId));
  ensureDir(outputDir);

  if (options.resume && fs.existsSync(path.join(outputDir, 'result.json'))) {
    return readJson(path.join(outputDir, 'result.json'));
  }

  const started = Date.now();
  const jobFile = writeJob(sample, manifest, outputDir);
  runPreprocess(jobFile, outputDir);

  const preprocessing = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const job = readJson(jobFile);
  const draft = buildRecognitionDraft(job, preprocessing);
  // buildRecognitionDraft 已 finalize（preferVisual + topology）；无需再 repair
  const repaired = draft.quality?.commercialReadiness
    ? draft
    : finalizeRecognitionDraft(draft, preprocessing);

  const rooms = repaired.rooms || [];
  const openings = [...(repaired.doors || []), ...(repaired.windows || [])];
  // Merely lacking a review flag is not proof of wall attachment.
  const attachedOpeningCount = countVerifiedAttachedOpenings(openings, repaired.walls || []);
  const attachedOpeningRatio = openings.length ? attachedOpeningCount / openings.length : null;
  const spatialValidation = repaired.quality?.spatialValidation || {};
  const spatialMetrics = spatialValidation.metrics || {};
  const readiness = repaired.quality?.commercialReadiness || {};
  const expected = manifest?.expected || parseLayoutText('');
  const recognized = countRecognizedLayout(rooms);
  const layoutCompare = compareLayout(expected, recognized);
  const geometry = geometryProxyMetrics(preprocessing, repaired);

  const result = {
    designId: sample.designId,
    viewKey: options.viewKey,
    imagePath: sample.imagePath,
    manifest: manifest ? {
      name: manifest.name,
      layoutText: manifest.layoutText,
      area: manifest.area,
      community: manifest.community,
      isBim: manifest.isBim
    } : null,
    expected,
    recognized,
    layoutCompare,
    strategy: repaired.strategy?.localGeometry || '',
    geometryConfidence: repaired.confidence?.geometry ?? null,
    semanticsConfidence: repaired.confidence?.semantics ?? null,
    roomNames: rooms.map((room) => room.name || room.id),
    roomTypes: rooms.map((room) => room.type || 'space'),
    readinessStatus: readiness.status || 'unknown',
    readinessScore: readiness.score ?? null,
    blockingReasons: readiness.blockingReasons || [],
    attachedOpeningCount,
    attachedOpeningRatio: attachedOpeningRatio == null ? null : Number(attachedOpeningRatio.toFixed(3)),
    spatialValidation: {
      valid: spatialValidation.valid ?? null,
      reviewRequired: spatialValidation.reviewRequired ?? null,
      issueCount: spatialValidation.issueCount ?? spatialMetrics.issueCount ?? null,
      errorCount: spatialValidation.errorCount ?? spatialMetrics.errorCount ?? null,
      reviewCount: spatialValidation.reviewCount ?? spatialMetrics.reviewCount ?? null,
      roomGeometryValidRatio: spatialMetrics.roomGeometryValidRatio ?? null,
      wallGeometryValidRatio: spatialMetrics.wallGeometryValidRatio ?? null,
      openingAssociationRatio: spatialMetrics.openingAssociationRatio ?? null,
      wallAttachmentRatio: spatialMetrics.wallAttachmentRatio ?? null
    },
    geometry,
    outputDir,
    durationMs: Date.now() - started,
    error: null
  };

  writeJson(path.join(outputDir, 'result.json'), result);
  writeJson(path.join(outputDir, 'recognition-draft.json'), repaired);
  return result;
}

export function summarizeBenchmark(results) {
  const valid = results.filter((row) => !row.error);
  const withLayout = valid.filter((row) => row.expected?.layout);
  const exactLayoutMatches = withLayout.filter((row) => row.layoutCompare?.exactMatch);
  const readinessRows = valid.map((row) => ({
    status: row.readinessStatus,
    score: Number(row.readinessScore || 0)
  }));

  function avg(values) {
    const nums = values.filter((value) => Number.isFinite(value));
    if (!nums.length) return null;
    return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(3));
  }

  const recallRows = valid.map((row) => row.geometry?.recallProxy || {});
  const assetRows = valid.map((row) => row.geometry?.recognitionAssets || {});
  const preprocessRows = valid.map((row) => row.geometry?.preprocess || {});

  return {
    total: results.length,
    valid: valid.length,
    failed: results.length - valid.length,
    withManifestLayout: withLayout.length,
    exactLayoutMatchCount: exactLayoutMatches.length,
    exactLayoutMatchRate: Number((exactLayoutMatches.length / Math.max(1, withLayout.length) * 100).toFixed(1)),
    avgLayoutAccuracy: avg(withLayout.map((row) => row.layoutCompare?.layoutAccuracy)),
    avgReadinessScore: avg(readinessRows.map((row) => row.score)),
    commercialReadyCount: readinessRows.filter((row) => row.status === 'commercial_ready').length,
    commercialReadyRate: Number((readinessRows.filter((row) => row.status === 'commercial_ready').length / Math.max(1, valid.length) * 100).toFixed(1)),
    needsHumanReviewCount: readinessRows.filter((row) => row.status === 'needs_human_review').length,
    blockedCount: readinessRows.filter((row) => row.status === 'blocked').length,
    avgAttachedOpeningRatio: avg(valid.map((row) => row.attachedOpeningRatio)),
    spatialValidationReviewCount: valid.filter((row) => row.spatialValidation?.reviewRequired).length,
    spatialValidationInvalidCount: valid.filter((row) => row.spatialValidation?.valid === false).length,
    avgRoomGeometryValidRatio: avg(valid.map((row) => row.spatialValidation?.roomGeometryValidRatio)),
    avgWallGeometryValidRatio: avg(valid.map((row) => row.spatialValidation?.wallGeometryValidRatio)),
    avgOpeningAssociationRatio: avg(valid.map((row) => row.spatialValidation?.openingAssociationRatio)),
    avgWallAttachmentRatio: avg(valid.map((row) => row.spatialValidation?.wallAttachmentRatio)),
    avgSpatialIssueCount: avg(valid.map((row) => row.spatialValidation?.issueCount)),
    avgMainRoomCountDelta: avg(withLayout.map((row) => row.layoutCompare?.deltas?.mainRoomCount)),
    avgWallRecallProxy: avg(recallRows.map((row) => row.wallRecall)),
    avgRoomRecallProxy: avg(recallRows.map((row) => row.roomRecall)),
    avgDoorRecallProxy: avg(recallRows.map((row) => row.doorRecall)),
    avgWindowRecallProxy: avg(recallRows.map((row) => row.windowRecall)),
    recognitionAssetVersion: assetRows.find((row) => row.version)?.version || '',
    avgRecognitionAssetMatchCount: avg(assetRows.map((row) => row.matchedCandidateCount)),
    avgExcludedAnnotationLineCount: avg(assetRows.map((row) => row.excludedAnnotationLineCount)),
    avgDoorAssetMatchCount: avg(assetRows.map((row) => row.doorAssetMatchCount)),
    avgWindowAssetMatchCount: avg(assetRows.map((row) => row.windowAssetMatchCount)),
    avgFurnitureAssetMatchCount: avg(assetRows.map((row) => row.furnitureAssetMatchCount)),
    avgMepSymbolCount: avg(preprocessRows.map((row) => row.mepSymbolCount)),
    avgElectricalSymbolCount: avg(preprocessRows.map((row) => row.electricalSymbolCount)),
    avgMepAssetMatchCount: avg(assetRows.map((row) => row.mepAssetMatchCount)),
    avgElectricalAssetMatchCount: avg(assetRows.map((row) => row.electricalAssetMatchCount)),
    blockingReasons: Object.entries(
      valid.flatMap((row) => row.blockingReasons || []).reduce((acc, reason) => {
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {})
    ).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  };
}

function writeMarkdownReport(filePath, report) {
  const rows = (report.results || []).slice(0, 40).map((row) => {
    if (row.error) {
      return `| ${row.designId} | error | - | - | - | - | ${row.error} |`;
    }
    return `| ${row.designId} | ${row.expected?.layout || '-'} | ${row.recognized?.mainRoomCount ?? '-'} | ${row.layoutCompare?.layoutAccuracy ?? '-'} | ${row.readinessStatus}:${row.readinessScore ?? '-'} | ${row.attachedOpeningRatio ?? '-'} | ${row.blockingReasons?.slice(0, 2).join(', ') || '-'} |`;
  }).join('\n');

  const blockingRows = (report.aggregate.blockingReasons || []).map((item) => `| ${item.reason} | ${item.count} |`).join('\n');
  const md = `# 酷家乐结构图识别 Benchmark

- 生成时间: ${report.generatedAt}
- 视图: ${report.viewKey}
- 样本数: ${report.aggregate.total}
- 有 manifest 布局 GT: ${report.aggregate.withManifestLayout}
- 布局完全匹配率: ${report.aggregate.exactLayoutMatchRate}%
- 平均布局准确率(四类): ${report.aggregate.avgLayoutAccuracy}
- 商用就绪率: ${report.aggregate.commercialReadyRate}%
- 平均商用分: ${report.aggregate.avgReadinessScore}
- 平均门窗贴墙率（需明确引用有效墙体）: ${report.aggregate.avgAttachedOpeningRatio}
- 空间校验需复核样本数: ${report.aggregate.spatialValidationReviewCount}
- 空间校验无效样本数: ${report.aggregate.spatialValidationInvalidCount}
- 平均房间几何有效率: ${report.aggregate.avgRoomGeometryValidRatio}
- 平均墙体几何有效率: ${report.aggregate.avgWallGeometryValidRatio}
- 平均洞口房间关联率: ${report.aggregate.avgOpeningAssociationRatio}
- 平均洞口墙体关联率: ${report.aggregate.avgWallAttachmentRatio}
- 平均空间诊断问题数: ${report.aggregate.avgSpatialIssueCount}

## 几何召回代理指标

- 墙段召回代理: ${report.aggregate.avgWallRecallProxy}
- 房间召回代理: ${report.aggregate.avgRoomRecallProxy}
- 门符号召回代理: ${report.aggregate.avgDoorRecallProxy}
- 窗符号召回代理: ${report.aggregate.avgWindowRecallProxy}

## 识别资产（图例匹配）

- 资产版本: ${report.aggregate.recognitionAssetVersion || '-'}
- 平均图例匹配数: ${report.aggregate.avgRecognitionAssetMatchCount}
- 平均排除标注线数: ${report.aggregate.avgExcludedAnnotationLineCount}
- 平均门图例匹配: ${report.aggregate.avgDoorAssetMatchCount}
- 平均窗图例匹配: ${report.aggregate.avgWindowAssetMatchCount}
- 平均家具图例匹配: ${report.aggregate.avgFurnitureAssetMatchCount}
- 平均暖通候选/匹配: ${report.aggregate.avgMepSymbolCount} / ${report.aggregate.avgMepAssetMatchCount}
- 平均电气候选/匹配: ${report.aggregate.avgElectricalSymbolCount} / ${report.aggregate.avgElectricalAssetMatchCount}

## Blocking Reasons

| Reason | Count |
| --- | ---: |
${blockingRows || '| - | - |'}

## 样本结果（前 40）

| designId | 期望布局 | 识别主房间数 | 布局准确率 | 商用状态 | 贴墙率 | blocking |
| --- | --- | ---: | ---: | --- | ---: | --- |
${rows || '| - | - | - | - | - | - | - |'}

## 怎么读

- **布局准确率**: 室/厅/厨/卫 4 类是否分别命中，1.0 表示四类全对。
- **几何召回代理**: 用 preprocess 检出的墙带/门洞/窗洞数量对比 recognition 输出，不是像素级 GT。
- 完整 JSON 见 \`summary.json\`，单样本见 \`samples/*/result.json\`。
`;
  fs.writeFileSync(filePath, md, 'utf8');
}

async function main() {
  const dataRoot = path.resolve(getArg(argv, '--data-root', path.join(root, 'backend/uploads/floorplans/kujiale-3d')));
  const outputRoot = path.resolve(getArg(argv, '--output', path.join(root, 'tmp/kujiale-structure-benchmark')));
  const viewKey = getArg(argv, '--view', 'wallCenterLine');
  const limitArg = getArg(argv, '--limit', '30');
  const limit = limitArg === '0' ? Infinity : (Number(limitArg) || 30);
  const resume = hasFlag(argv, '--resume');

  if (!VIEW_KEYS.includes(viewKey)) {
    throw new Error(`Unsupported --view ${viewKey}, expected one of ${VIEW_KEYS.join(', ')}`);
  }

  ensureDir(outputRoot);
  const manifestIndex = buildManifestIndex();
  const samples = collectStructureSamples(dataRoot, viewKey).slice(0, Number.isFinite(limit) ? limit : undefined);
  const results = [];

  for (const [index, sample] of samples.entries()) {
    const manifest = manifestIndex.get(sample.designId) || null;
    process.stderr.write(`[${index + 1}/${samples.length}] ${sample.designId}...\n`);
    try {
      const row = evaluateStructureSample(sample, manifest, { outputRoot, viewKey, resume });
      results.push(row);
      process.stderr.write(`  -> layout=${row.expected?.layout || 'unknown'} recognized=${row.recognized?.mainRoomCount} acc=${row.layoutCompare?.layoutAccuracy} readiness=${row.readinessStatus}:${row.readinessScore}\n`);
    } catch (error) {
      results.push({
        designId: sample.designId,
        imagePath: sample.imagePath,
        viewKey,
        error: error.message
      });
      process.stderr.write(`  -> ERROR ${error.message}\n`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataRoot,
    outputRoot,
    viewKey,
    limit: Number.isFinite(limit) ? limit : 'all',
    aggregate: summarizeBenchmark(results),
    results
  };

  writeJson(path.join(outputRoot, 'summary.json'), report);
  writeMarkdownReport(path.join(outputRoot, 'report.md'), report);
  console.log(JSON.stringify({
    outputRoot,
    report: path.join(outputRoot, 'report.md'),
    aggregate: report.aggregate
  }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
