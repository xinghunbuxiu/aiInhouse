import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractGeometryFeatures } = require('../codex-worker/src/recognizers/geometry-feature-detector.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] || fallback;
}
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}
function imageMime(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
}
function lineColor(line) {
  return /dimension|annotation|leader|text|measure/i.test(line.source) ? '#ff8c42'
    : /wall|structural|morphology/i.test(line.source) ? '#00e676' : '#42a5f5';
}
function renderOverlay(features, imageData, width, height, mode) {
  const colors = {
    endpoint: '#00d4ff',
    corner: '#ff5b5b',
    't-junction': '#ffd43b',
    'cross-junction': '#b197fc',
    junction: '#ffffff'
  };
  const lineSvg = features.lines.map(line =>
    `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}" stroke="${mode === 'structural' ? '#00e676' : lineColor(line)}" stroke-width="2" opacity=".88"><title>${escapeXml(line.id)} · ${escapeXml(line.source)} · ${line.length}px · confidence ${line.confidence ?? 'N/A'}</title></line>`
  ).join('');
  const pointSvg = features.points.map(point =>
    `<circle cx="${point.x}" cy="${point.y}" r="${point.type === 'cross-junction' || point.type === 't-junction' ? 5 : 3}" fill="${colors[point.type] || colors.junction}" stroke="#111" stroke-width="1"><title>${escapeXml(point.id)} · ${escapeXml(point.type)} · degree ${point.degree} · ${escapeXml(point.incidentLineIds.join(', '))}</title></circle>`
  ).join('');
  const legendItems = mode === 'structural'
    ? [['#00e676', '墙带/结构支持线'], [colors.endpoint, '端点'], [colors.corner, '角点'], [colors['t-junction'], 'T 连接'], [colors['cross-junction'], '十字交叉']]
    : [['#00e676', '墙/结构来源线'], ['#ff8c42', '尺寸/标注来源线'], ['#42a5f5', '其他来源线'], [colors.endpoint, '端点'], [colors.corner, '角点'], [colors['t-junction'], 'T 连接'], [colors['cross-junction'], '十字交叉']];
  const legend = legendItems.map(([color, label], index) =>
    `<g transform="translate(16 ${28 + index * 24})"><rect width="12" height="12" fill="${color}"/><text x="20" y="11" font-size="14" fill="#fff">${escapeXml(label)}</text></g>`
  ).join('');
  const panelHeight = 20 + legendItems.length * 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="${imageData}"/><g>${lineSvg}${pointSvg}</g><g><rect x="8" y="8" width="230" height="${panelHeight}" rx="6" fill="#111" opacity=".78"/>${legend}</g></svg>`;
}

const imagePath = path.resolve(arg('--image'));
const preprocessPath = path.resolve(arg('--preprocess'));
const outputDir = path.resolve(arg('--output', path.join(root, 'tmp/geometry-feature-sample')));
if (!fs.existsSync(imagePath)) throw new Error(`Input image not found: ${imagePath}`);
if (!fs.existsSync(preprocessPath)) throw new Error(`Preprocess report not found: ${preprocessPath}`);
const preprocessing = JSON.parse(fs.readFileSync(preprocessPath, 'utf8'));
const geometry = preprocessing.geometryCandidates || {};
const lineCandidates = Array.isArray(geometry.lines) ? geometry.lines : [];
const allFeatures = extractGeometryFeatures(lineCandidates);
const structuralCandidates = lineCandidates.filter(line => /wall|structural|morphology/i.test(String(line.source || '')));
const structuralFeatures = extractGeometryFeatures(structuralCandidates);
const imageBuffer = fs.readFileSync(imagePath);
const imageData = `data:${imageMime(imagePath)};base64,${imageBuffer.toString('base64')}`;
const dimensions = preprocessing.image || {};
const width = Number(dimensions.width) || 1400;
const height = Number(dimensions.height) || 976;

fs.mkdirSync(outputDir, { recursive: true });
const summaryPath = path.join(outputDir, 'geometry-feature-summary.json');
const allOverlayPath = path.join(outputDir, 'geometry-feature-overlay.svg');
const structuralOverlayPath = path.join(outputDir, 'structural-feature-overlay.svg');
fs.writeFileSync(summaryPath, JSON.stringify({
  image: path.basename(imagePath),
  coordinateSpace: 'input-image-pixels',
  interpretationWarning: 'Feature counts are raw geometry evidence, not wall/symbol accuracy. The all-lines view includes Hough edges and annotation-like candidates; the structural view is restricted to source-tagged wall/structural/morphology lines.',
  sourceImageMetrics: dimensions,
  sourcePreprocessingQuality: preprocessing.quality || null,
  allLineFeatures: {
    sourceLineCandidateCount: lineCandidates.length,
    ...allFeatures
  },
  structuralLineFeatures: {
    sourceLineCandidateCount: structuralCandidates.length,
    sourceFilter: 'line.source matches wall|structural|morphology',
    ...structuralFeatures
  }
}, null, 2));
fs.writeFileSync(allOverlayPath, renderOverlay(allFeatures, imageData, width, height, 'all'));
fs.writeFileSync(structuralOverlayPath, renderOverlay(structuralFeatures, imageData, width, height, 'structural'));
console.log(JSON.stringify({
  image: path.basename(imagePath),
  summaryPath,
  allOverlayPath,
  structuralOverlayPath,
  allLines: allFeatures.summary,
  structuralLines: structuralFeatures.summary
}, null, 2));
