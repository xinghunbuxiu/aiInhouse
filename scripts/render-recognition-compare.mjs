#!/usr/bin/env node
/**
 * 原图 vs 识别结果对比页
 * 用法:
 *   node scripts/render-recognition-compare.mjs --sample tmp/.../samples/3FO3B320SBPH
 *   node scripts/render-recognition-compare.mjs --benchmark-dir tmp/kujiale-structure-benchmark-v13-attach100 --limit 6
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { buildRecognitionDraft } = require('../codex-worker/src/recognizers/local-draft.js');

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roomColor(type = '') {
  const map = {
    bedroom: '#3b82f6',
    living: '#22c55e',
    dining: '#84cc16',
    kitchen: '#f59e0b',
    bathroom: '#06b6d4',
    balcony: '#a855f7',
    entry: '#64748b',
    circulation: '#94a3b8',
    storage: '#78716c'
  };
  return map[type] || '#94a3b8';
}

function buildOverlaySvg(draft = {}, preprocess = {}, options = {}) {
  const image = preprocess.image || draft.preprocessing?.image || {};
  const width = num(image.width, 1400);
  const height = num(image.height, 1000);
  const src = options.imageHref || './recognition-input.jpg';
  const showAnnotations = options.showAnnotations !== false;

  const rooms = (draft.rooms || []).map((room) => {
    const color = roomColor(room.type);
    const review = room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview
      || room.semanticNeedsReview || room.sourceEvidence?.semanticNeedsReview;
    return `
      <g data-room="${esc(room.id || '')}">
        <rect x="${num(room.x).toFixed(1)}" y="${num(room.y).toFixed(1)}" width="${Math.max(4, num(room.width)).toFixed(1)}" height="${Math.max(4, num(room.height)).toFixed(1)}"
          fill="${color}" fill-opacity="${review ? 0.12 : 0.22}" stroke="${color}" stroke-width="${review ? 2 : 3}" ${review ? 'stroke-dasharray="6 4"' : ''}/>
        <text x="${(num(room.x) + 8).toFixed(1)}" y="${(num(room.y) + 22).toFixed(1)}" font-size="16" font-weight="800" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(room.name || room.type || '')}</text>
      </g>`;
  }).join('\n');

  const walls = (draft.walls || []).map((wall) => {
    const exterior = wall.wallRole === 'exterior' || wall.isExterior;
    return `<line x1="${num(wall.start?.x).toFixed(1)}" y1="${num(wall.start?.y).toFixed(1)}" x2="${num(wall.end?.x).toFixed(1)}" y2="${num(wall.end?.y).toFixed(1)}" stroke="${exterior ? '#ef4444' : '#f97316'}" stroke-width="${Math.max(2, Math.min(10, num(wall.thickness, 8))).toFixed(1)}" stroke-opacity="0.9"/>`;
  }).join('\n');

  const doors = (draft.doors || []).map((door) => `
    <rect x="${(num(door.x) - num(door.width) / 2).toFixed(1)}" y="${(num(door.y) - num(door.height) / 2).toFixed(1)}" width="${Math.max(6, num(door.width)).toFixed(1)}" height="${Math.max(6, num(door.height)).toFixed(1)}" fill="#f59e0b" fill-opacity="0.35" stroke="#d97706" stroke-width="2"/>`).join('\n');

  const windows = (draft.windows || []).map((win) => `
    <rect x="${(num(win.x) - num(win.width) / 2).toFixed(1)}" y="${(num(win.y) - num(win.height) / 2).toFixed(1)}" width="${Math.max(6, num(win.width)).toFixed(1)}" height="${Math.max(6, num(win.height)).toFixed(1)}" fill="#0284c7" fill-opacity="0.3" stroke="#0369a1" stroke-width="2"/>`).join('\n');

  const geometry = preprocess.geometryCandidates || {};
  const annotations = showAnnotations
    ? (geometry.annotationSymbolCandidates || []).map((item) => `
      <rect x="${num(item.x).toFixed(1)}" y="${num(item.y).toFixed(1)}" width="${Math.max(4, num(item.width)).toFixed(1)}" height="${Math.max(4, num(item.height)).toFixed(1)}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-dasharray="3 2"/>`).join('\n')
    : '';

  const furniture = (geometry.furnitureSymbolCandidates || []).map((item) => {
    const matched = item.assetMatch?.assetId || '';
    return `<rect x="${num(item.x).toFixed(1)}" y="${num(item.y).toFixed(1)}" width="${Math.max(4, num(item.width)).toFixed(1)}" height="${Math.max(4, num(item.height)).toFixed(1)}" fill="#8b5cf6" fill-opacity="0.18" stroke="#7c3aed" stroke-width="1.5"/><title>${esc(item.type)} ${esc(matched)}</title>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="${esc(src)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <g data-layer="rooms">${rooms}</g>
  <g data-layer="annotations">${annotations}</g>
  <g data-layer="furniture">${furniture}</g>
  <g data-layer="walls">${walls}</g>
  <g data-layer="doors">${doors}</g>
  <g data-layer="windows">${windows}</g>
</svg>`;
}

function buildCompareHtml({ designId, draft, preprocess, result, overlayRel, imageRel }) {
  const readiness = draft.quality?.commercialReadiness || {};
  const assets = preprocess.recognitionAssets || {};
  const rooms = draft.rooms || [];
  const roomRows = rooms.map((room) => `<tr>
    <td>${esc(room.name)}</td><td>${esc(room.type)}</td><td>${esc(room.source || '')}</td>
    <td>${room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview ? '是' : ''}</td>
    <td>${room.semanticNeedsReview || room.sourceEvidence?.semanticNeedsReview ? '是' : ''}</td>
  </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>识别对比 ${esc(designId)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
    header{padding:16px 24px;border-bottom:1px solid #1e293b;background:#111827}
    h1{margin:0 0 6px;font-size:20px}
    .meta{display:flex;flex-wrap:wrap;gap:10px;font-size:13px;color:#94a3b8}
    .meta b{color:#f8fafc}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}
    .panel{background:#111827;border:1px solid #1e293b;border-radius:10px;overflow:hidden}
    .panel h2{margin:0;padding:10px 12px;font-size:14px;background:#1e293b}
    .panel img,.panel object{display:block;width:100%;height:auto;background:#fff}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border-bottom:1px solid #1e293b;padding:8px 10px;text-align:left}
    th{color:#94a3b8;font-weight:600}
    .section{padding:12px 24px 24px}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#1e293b;margin-right:6px}
    .ok{color:#4ade80}.warn{color:#fbbf24}.bad{color:#f87171}
    @media (max-width: 960px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header>
    <h1>原图 vs 识别结果 · ${esc(designId)}</h1>
    <div class="meta">
      <span>期望布局 <b>${esc(result?.expected?.layout || '-')}</b></span>
      <span>识别主房间 <b>${esc(result?.recognized?.mainRoomCount ?? rooms.length)}</b></span>
      <span>布局准确率 <b>${esc(result?.layoutCompare?.layoutAccuracy ?? '-')}</b></span>
      <span>商用状态 <b class="${readiness.status === 'commercial_ready' ? 'ok' : readiness.status === 'blocked' ? 'bad' : 'warn'}">${esc(readiness.status || '-')} ${esc(readiness.score ?? '')}</b></span>
      <span>图例匹配 <b>${esc(assets.matchedCandidateCount ?? 0)}</b></span>
      <span>排除标注线 <b>${esc(assets.excludedAnnotationLineCount ?? 0)}</b></span>
      <span>资产版本 <b>${esc(assets.version || '-')}</b></span>
    </div>
    <div class="meta" style="margin-top:8px">
      ${(readiness.blockingReasons || []).map((r) => `<span class="pill bad">${esc(r)}</span>`).join('') || '<span class="pill ok">无硬阻断</span>'}
    </div>
  </header>
  <div class="grid">
    <section class="panel">
      <h2>原始平面图</h2>
      <img src="${esc(imageRel)}" alt="original"/>
    </section>
    <section class="panel">
      <h2>识别叠加（房间/墙/门/窗/家具/标注）</h2>
      <object type="image/svg+xml" data="${esc(overlayRel)}">识别叠加</object>
    </section>
  </div>
  <div class="section panel">
    <h2>房间明细</h2>
    <table>
      <thead><tr><th>名称</th><th>类型</th><th>来源</th><th>边界复核</th><th>语义复核</th></tr></thead>
      <tbody>${roomRows || '<tr><td colspan="5">无</td></tr>'}</tbody>
    </table>
  </div>
  <div class="section panel">
    <h2>复核清单</h2>
    <ul>${(readiness.reviewChecklist || []).map((item) => `<li>${esc(item)}</li>`).join('') || '<li>无</li>'}</ul>
  </div>
</body>
</html>`;
}

function renderSample(sampleDir, outputDir = sampleDir, { rebuild = false } = {}) {
  const designId = path.basename(sampleDir);
  const job = readJson(path.join(sampleDir, 'job.json'));
  let draft = readJson(path.join(sampleDir, 'recognition-draft.json'));
  const preprocess = readJson(path.join(sampleDir, 'recognition-preprocess.json'));
  const result = readJson(path.join(sampleDir, 'result.json'), {});

  if (!preprocess || !job) {
    throw new Error(`missing preprocess/job in ${sampleDir}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const inputSrc = path.join(sampleDir, 'recognition-input.jpg');
  const inputDst = path.join(outputDir, 'recognition-input.jpg');
  if (fs.existsSync(inputSrc) && path.resolve(inputSrc) !== path.resolve(inputDst)) {
    fs.copyFileSync(inputSrc, inputDst);
  }

  if (rebuild || !draft?.quality?.commercialReadiness) {
    draft = buildRecognitionDraft(job, preprocess);
    fs.writeFileSync(path.join(outputDir, 'recognition-draft.compare.json'), JSON.stringify(draft, null, 2));
  }

  const overlayName = 'recognition-compare-overlay.svg';
  const htmlName = 'recognition-compare.html';
  const svg = buildOverlaySvg(draft, preprocess, { imageHref: './recognition-input.jpg' });
  fs.writeFileSync(path.join(outputDir, overlayName), svg, 'utf8');
  const html = buildCompareHtml({
    designId,
    draft,
    preprocess,
    result,
    overlayRel: `./${overlayName}`,
    imageRel: './recognition-input.jpg'
  });
  fs.writeFileSync(path.join(outputDir, htmlName), html, 'utf8');
  return {
    designId,
    html: path.join(outputDir, htmlName),
    overlay: path.join(outputDir, overlayName),
    status: draft.quality?.commercialReadiness?.status,
    score: draft.quality?.commercialReadiness?.score,
    blockers: draft.quality?.commercialReadiness?.blockingReasons || []
  };
}

function main() {
  const sample = getArg('--sample');
  const benchmarkDir = getArg('--benchmark-dir');
  const limit = Number(getArg('--limit', '6')) || 6;
  const rebuild = process.argv.includes('--rebuild');
  const outRoot = getArg('--output', '');

  const targets = [];
  if (sample) {
    targets.push(path.resolve(sample));
  } else if (benchmarkDir) {
    const samplesDir = path.join(path.resolve(benchmarkDir), 'samples');
    const ids = fs.readdirSync(samplesDir).sort().slice(0, limit);
    for (const id of ids) targets.push(path.join(samplesDir, id));
  } else {
    throw new Error('用法: --sample <dir> 或 --benchmark-dir <dir> [--limit 6] [--rebuild]');
  }

  const results = [];
  for (const dir of targets) {
    const outputDir = outRoot
      ? path.join(path.resolve(outRoot), path.basename(dir))
      : dir;
    const row = renderSample(dir, outputDir, { rebuild });
    results.push(row);
    process.stderr.write(`${row.designId} -> ${row.status}:${row.score} blockers=${row.blockers.join(',') || '-'}\n`);
  }

  if (outRoot) {
    const index = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><title>识别对比索引</title>
      <style>body{font-family:sans-serif;max-width:900px;margin:24px auto;padding:0 16px}a{display:block;padding:8px 0}</style></head>
      <body><h1>识别对比索引</h1>${results.map((r) => `<a href="./${esc(r.designId)}/recognition-compare.html">${esc(r.designId)} · ${esc(r.status)} ${esc(r.score ?? '')}</a>`).join('')}</body></html>`;
    fs.mkdirSync(path.resolve(outRoot), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(outRoot), 'index.html'), index, 'utf8');
  }

  console.log(JSON.stringify({ count: results.length, results }, null, 2));
}

main();
