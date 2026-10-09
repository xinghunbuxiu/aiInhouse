import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildRecognitionDraft } = require('../codex-worker/src/recognizers/local-draft.js');
const { repairRecognitionTopology } = require('../codex-worker/src/recognizers/topology.js');

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseExpectedLayout(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/(\d+)室(\d+)厅(\d+)厨(\d+)卫/);
  if (!match) {
    return {
      bedrooms: 0,
      halls: 0,
      kitchens: 0,
      baths: 0,
      layout: ''
    };
  }

  return {
    bedrooms: Number(match[1]),
    halls: Number(match[2]),
    kitchens: Number(match[3]),
    baths: Number(match[4]),
    layout: `${match[1]}室${match[2]}厅${match[3]}厨${match[4]}卫`
  };
}

function collectImages(rootDir, limit) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b, 'zh-CN')).slice(0, limit);
}

function rowsFromPreviousSummary(summaryPath, preprocessRoot, limit) {
  const summary = readJson(summaryPath);
  return (summary.results || []).slice(0, limit).map((row, index) => {
    const baseName = path.basename(row.image || '', path.extname(row.image || ''));
    const prefixedBaseName = `${String(index + 1).padStart(2, '0')}-${baseName}`;
    const preprocessFile = row.preprocessFile
      || (row.outputDir ? path.join(row.outputDir, 'recognition-preprocess.json') : '')
      || (preprocessRoot ? path.join(preprocessRoot, prefixedBaseName, 'recognition-preprocess.json') : '');
    return {
      image: row.image,
      expected: row.expected || parseExpectedLayout(row.image),
      preprocessFile
    };
  });
}

function rowsFromImageRoot(imageRoot, preprocessRoot, limit) {
  return collectImages(imageRoot, limit).map((image) => {
    const baseName = path.basename(image, path.extname(image));
    return {
      image,
      expected: parseExpectedLayout(image),
      preprocessFile: path.join(preprocessRoot, baseName, 'recognition-preprocess.json')
    };
  });
}

function evaluateRow(row, index) {
  if (!fs.existsSync(row.preprocessFile)) {
    return {
      index,
      image: row.image,
      expected: row.expected,
      error: `missing preprocess file: ${row.preprocessFile}`
    };
  }

  const preprocessing = readJson(row.preprocessFile);
  const job = {
    job: { source_type: 'digital' },
    house: { layout: row.expected?.layout || '' },
    floor_plan: {},
    assets: { local_source_file: row.image }
  };
  const draft = buildRecognitionDraft(job, preprocessing);
  const repairedDraft = repairRecognitionTopology(draft);
  const geometryRooms = draft.geometryRooms || [];
  const readiness = repairedDraft.quality?.commercialReadiness || {};
  const repairedRooms = repairedDraft.rooms || [];
  const repairedOpenings = [...(repairedDraft.doors || []), ...(repairedDraft.windows || [])];
  return {
    index,
    image: row.image,
    expected: row.expected,
    strategy: repairedDraft.strategy?.localGeometry || '',
    rooms: repairedRooms.length,
    roomNames: repairedRooms.map((room) => room.name || room.id),
    roomsDetail: repairedRooms.map((room) => ({
      name: room.name || room.id,
      type: room.type || '',
      source: room.source || '',
      boundaryNeedsReview: Boolean(room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview),
      semanticNeedsReview: Boolean(room.semanticNeedsReview || room.sourceEvidence?.semanticNeedsReview)
    })),
    geometryRooms: geometryRooms.length,
    supplementedRooms: repairedRooms.filter((room) => room.source === 'layout-template-supplemental').length,
    openingCount: repairedOpenings.length,
    unattachedOpeningCount: repairedOpenings.filter((opening) => opening.needsWallAttachmentReview).length,
    unattachedOpenings: repairedOpenings
      .filter((opening) => opening.needsWallAttachmentReview)
      .map((opening) => ({
        id: opening.id || '',
        type: opening.type || '',
        source: opening.source || '',
        wallDistance: opening.wallDistance ?? null,
        reviewReasons: opening.reviewReasons || []
      })),
    avgEdgeScore: geometryRooms.length
      ? Number((geometryRooms.reduce((sum, room) => sum + (room.sourceEvidence?.edgeScore || 0), 0) / geometryRooms.length).toFixed(3))
      : 0,
    semanticFallback: repairedDraft.quality?.semanticFallback || null,
    commercialReadiness: {
      status: readiness.status || 'unknown',
      score: readiness.score ?? null,
      autoPass: Boolean(readiness.autoPass),
      blockingReasons: readiness.blockingReasons || [],
      reviewChecklist: readiness.reviewChecklist || [],
      metrics: readiness.metrics || {}
    },
    roomSources: Object.entries(repairedRooms.reduce((acc, room) => {
      const source = room.source || 'unknown';
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {})).map(([source, count]) => ({ source, count }))
  };
}

function summarize(results) {
  const valid = results.filter((row) => !row.error);
  const readinessRows = valid.map((row) => row.commercialReadiness || {});
  return {
    total: results.length,
    valid: valid.length,
    failed: results.length - valid.length,
    wallGrid: valid.filter((row) => row.strategy === 'opencv_wall_grid_rooms').length,
    contourOrLine: valid.filter((row) => row.strategy === 'opencv_line_and_contour_candidates').length,
    template: valid.filter((row) => row.semanticFallback === 'chinese_apartment_layout_template').length,
    supplemented: valid.filter((row) => row.supplementedRooms > 0).length,
    commercialReady: readinessRows.filter((row) => row.status === 'commercial_ready').length,
    needsHumanReview: readinessRows.filter((row) => row.status === 'needs_human_review').length,
    blocked: readinessRows.filter((row) => row.status === 'blocked').length,
    avgReadinessScore: Number((readinessRows.reduce((sum, row) => sum + Number(row.score || 0), 0) / Math.max(1, readinessRows.length)).toFixed(2)),
    blockingReasons: Object.entries(readinessRows.flatMap((row) => row.blockingReasons || []).reduce((acc, reason) => {
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {})).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    avgGeometryRooms: Number((valid.reduce((sum, row) => sum + row.geometryRooms, 0) / Math.max(1, valid.length)).toFixed(2)),
    avgRooms: Number((valid.reduce((sum, row) => sum + row.rooms, 0) / Math.max(1, valid.length)).toFixed(2))
  };
}

function writeMarkdownReport(filePath, report) {
  const rows = (report.results || []).map((row) => {
    if (row.error) {
      return `| ${row.index} | ${path.basename(row.image || '-')} | error | - | - | ${row.error} |`;
    }
    const readiness = row.commercialReadiness || {};
    const reasons = readiness.blockingReasons?.length ? readiness.blockingReasons.join(', ') : '-';
    return `| ${row.index} | ${path.basename(row.image || '-')} | ${readiness.status || '-'} | ${readiness.score ?? '-'} | ${row.strategy || '-'} | ${reasons} |`;
  }).join('\n');
  const blockingRows = (report.aggregate.blockingReasons || []).map((item) => `| ${item.reason} | ${item.count} |`).join('\n');
  const md = `# Recognition Commercial Readiness

## Aggregate
- Total: ${report.aggregate.total}
- Valid: ${report.aggregate.valid}
- Commercial ready: ${report.aggregate.commercialReady}
- Needs human review: ${report.aggregate.needsHumanReview}
- Blocked: ${report.aggregate.blocked}
- Avg readiness score: ${report.aggregate.avgReadinessScore}
- Avg geometry rooms: ${report.aggregate.avgGeometryRooms}
- Avg rooms: ${report.aggregate.avgRooms}

## Blocking Reasons
| Reason | Count |
| --- | ---: |
${blockingRows || '| - | - |'}

## Results
| # | Image | Readiness | Score | Strategy | Blocking reasons |
| ---: | --- | --- | ---: | --- | --- |
${rows || '| - | - | - | - | - | - |'}
`;
  fs.writeFileSync(filePath, md, 'utf8');
}

const summaryPath = getArg('--summary', 'tmp/recognition-eval-kujiale-local-only/summary.json');
const imageRoot = getArg('--image-root', '');
const preprocessRoot = getArg('--preprocess-root', '');
const outputDir = getArg('--output', 'tmp/recognition-eval-kujiale-current');
const limit = Number(getArg('--limit', '10')) || 10;

const rows = imageRoot
  ? rowsFromImageRoot(imageRoot, preprocessRoot || outputDir, limit)
  : rowsFromPreviousSummary(summaryPath, preprocessRoot, limit);
const results = rows.map((row, index) => evaluateRow(row, index + 1));
const report = {
  generatedAt: new Date().toISOString(),
  source: imageRoot ? { imageRoot, preprocessRoot } : { summaryPath },
  aggregate: summarize(results),
  results
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeMarkdownReport(path.join(outputDir, 'summary.md'), report);

console.log(JSON.stringify(report.aggregate, null, 2));
for (const row of results) {
  if (row.error) {
    console.log(`${row.index}. ${path.basename(row.image)} -> ERROR ${row.error}`);
    continue;
  }
  const readiness = row.commercialReadiness || {};
  console.log(`${row.index}. ${path.basename(row.image)} -> ${row.strategy}, rooms=${row.rooms}, geometry=${row.geometryRooms}, supplements=${row.supplementedRooms}, edge=${row.avgEdgeScore}, readiness=${readiness.status || '-'}:${readiness.score ?? '-'}`);
}
