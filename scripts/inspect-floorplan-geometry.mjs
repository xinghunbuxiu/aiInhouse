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
function renderOverlay(features, imageData, width, height, mode, symbols = []) {
  const colors = {
    endpoint: '#00d4ff',
    corner: '#ff5b5b',
    't-junction': '#ffd43b',
    'cross-junction': '#b197fc',
    junction: '#ffffff'
  };
  const lineSvg = features.lines.map(line => {
    const appearance = line.appearance || {};
    const appearanceLabel = [
      Number.isFinite(appearance.meanLuminance) ? `mean luminance ${appearance.meanLuminance}` : '',
      Number.isFinite(appearance.luminanceStdDev) ? `luminance variation ${appearance.luminanceStdDev}` : '',
      Number.isFinite(appearance.darkPixelRatio) ? `dark pixel ratio ${appearance.darkPixelRatio}` : '',
      Number.isFinite(appearance.centerBackgroundContrast) ? `stroke/background contrast ${appearance.centerBackgroundContrast}` : '',
      Array.isArray(appearance.meanBGR) ? `mean BGR ${appearance.meanBGR.join(', ')}` : '',
      Number.isFinite(line.thickness) ? `thickness ${line.thickness}px` : ''
    ].filter(Boolean).join(' · ');
    // Visual intensity encodes measured contrast only; it does not classify a wall.
    const contrast = Number(appearance.centerBackgroundContrast);
    const opacity = Number.isFinite(contrast) ? Math.max(0.45, Math.min(1, 0.45 + contrast / 255)) : 0.88;
    return `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}" stroke="${mode === 'structural' ? '#00e676' : lineColor(line)}" stroke-width="2" opacity="${opacity.toFixed(2)}"><title>${escapeXml(line.id)} · ${escapeXml(line.source)} · ${line.length}px · confidence ${line.confidence ?? 'N/A'}${line.sourceIds ? ` · source IDs ${escapeXml(line.sourceIds.join(', '))}` : ''}${appearanceLabel ? ` · appearance: ${escapeXml(appearanceLabel)}` : ' · appearance evidence unavailable'}</title></line>`;
  }).join('');
  const gapSvg = (features.topology?.disconnectedEndpointPairs || []).map(pair => {
    const [a, b] = pair.endpoints;
    return `<g><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ff1744" stroke-width="2" stroke-dasharray="4 3" opacity=".95"><title>Disconnected endpoints · gap ${pair.gap}px · ${escapeXml(pair.lineIds.join(', '))}</title></line><circle cx="${a.x}" cy="${a.y}" r="3" fill="#ff1744"/><circle cx="${b.x}" cy="${b.y}" r="3" fill="#ff1744"/></g>`;
  }).join('');
  const curveSvg = (features.curves || []).map(curve => {
    const start = { x: curve.center.x + curve.radius * Math.cos(curve.startAngle), y: curve.center.y + curve.radius * Math.sin(curve.startAngle) };
    const end = { x: curve.center.x + curve.radius * Math.cos(curve.endAngle), y: curve.center.y + curve.radius * Math.sin(curve.endAngle) };
    const largeArc = curve.sweepDegrees > 180 ? 1 : 0;
    return `<path d="M ${start.x} ${start.y} A ${curve.radius} ${curve.radius} 0 ${largeArc} 1 ${end.x} ${end.y}" fill="none" stroke="#ff40ff" stroke-width="2.5"><title>${escapeXml(curve.id)} · arc · ${curve.sweepDegrees} degrees · ${escapeXml(curve.source)}</title></path>`;
  }).join('');
  const symbolSvg = symbols.map(symbol => {
    const x = Number(symbol.x ?? symbol.box?.x);
    const y = Number(symbol.y ?? symbol.box?.y);
    const sw = Number(symbol.width ?? symbol.box?.width);
    const sh = Number(symbol.height ?? symbol.box?.height);
    if (![x, y, sw, sh].every(Number.isFinite) || sw <= 0 || sh <= 0) return '';
    const label = `${symbol.type || symbol.label || 'object'} ${Math.round(Number(symbol.confidence || 0) * 100)}%`;
    return `<g><rect x="${x}" y="${y}" width="${sw}" height="${sh}" fill="none" stroke="#00b0ff" stroke-width="2" stroke-dasharray="5 3"><title>${escapeXml(symbol.id || '')} · ${escapeXml(label)} · ${escapeXml((symbol.evidence || []).join(', '))}</title></rect><text x="${x}" y="${Math.max(14, y - 3)}" font-size="12" fill="#00b0ff" stroke="#111" stroke-width=".6" paint-order="stroke">${escapeXml(label)}</text></g>`;
  }).join('');
  const pointSvg = features.points.map(point =>
    `<circle cx="${point.x}" cy="${point.y}" r="${point.type === 'cross-junction' || point.type === 't-junction' ? 5 : 3}" fill="${colors[point.type] || colors.junction}" stroke="#111" stroke-width="1"><title>${escapeXml(point.id)} · ${escapeXml(point.type)} · degree ${point.degree} · ${escapeXml(point.incidentLineIds.join(', '))}</title></circle>`
  ).join('');
  const legendItems = mode === 'structural'
    ? [['#00e676', '墙带/结构支持线'], [colors.endpoint, '端点'], [colors.corner, '角点'], [colors['t-junction'], 'T 连接'], [colors['cross-junction'], '十字交叉'], ['#ff1744', '未连接端点/间隙'], ['#ff40ff', '弧线候选']]
    : [['#00e676', '墙/结构来源线'], ['#ff8c42', '尺寸/标注来源线'], ['#42a5f5', '其他来源线'], [colors.endpoint, '端点'], [colors.corner, '角点'], [colors['t-junction'], 'T 连接'], [colors['cross-junction'], '十字交叉']];
  const legend = legendItems.map(([color, label], index) =>
    `<g transform="translate(16 ${28 + index * 24})"><rect width="12" height="12" fill="${color}"/><text x="20" y="11" font-size="14" fill="#fff">${escapeXml(label)}</text></g>`
  ).join('');
  const panelHeight = 20 + legendItems.length * 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="${imageData}"/><g>${lineSvg}${curveSvg}${gapSvg}${symbolSvg}${pointSvg}</g><g><rect x="8" y="8" width="230" height="${panelHeight}" rx="6" fill="#111" opacity=".78"/>${legend}</g></svg>`;
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
const furnitureSymbols = geometry.furnitureSymbolCandidates || [];
const objectSymbols = [...furnitureSymbols, ...(geometry.doorSymbolCandidates || []), ...(geometry.windowSymbolCandidates || [])];
const mergedFeatures = extractGeometryFeatures(allFeatures.mergedLines.map(line => ({
  ...line,
  source: line.source,
  sourceIds: line.sourceIds
})));
const imageBuffer = fs.readFileSync(imagePath);
const imageData = `data:${imageMime(imagePath)};base64,${imageBuffer.toString('base64')}`;
const dimensions = preprocessing.image || {};
const width = Number(dimensions.width) || 1400;
const height = Number(dimensions.height) || 976;

fs.mkdirSync(outputDir, { recursive: true });
const summaryPath = path.join(outputDir, 'geometry-feature-summary.json');
const allOverlayPath = path.join(outputDir, 'geometry-feature-overlay.svg');
const structuralOverlayPath = path.join(outputDir, 'structural-feature-overlay.svg');
const mergedOverlayPath = path.join(outputDir, 'merged-geometry-overlay.svg');
fs.writeFileSync(summaryPath, JSON.stringify({
  image: path.basename(imagePath),
  coordinateSpace: 'input-image-pixels',
  interpretationWarning: 'Feature counts are raw geometry evidence, not wall/symbol accuracy. The all-lines view includes Hough edges and annotation-like candidates; the structural view is restricted to source-tagged wall/structural/morphology lines.',
  sourceImageMetrics: dimensions,
  sourcePreprocessingQuality: preprocessing.quality || null,
  detectedObjectCandidates: { furniture: furnitureSymbols.length, doors: (geometry.doorSymbolCandidates || []).length, windows: (geometry.windowSymbolCandidates || []).length },
  allLineFeatures: {
    sourceLineCandidateCount: lineCandidates.length,
    ...allFeatures
  },
  structuralLineFeatures: {
    sourceLineCandidateCount: structuralCandidates.length,
    sourceFilter: 'line.source matches wall|structural|morphology',
    ...structuralFeatures
  },
  mergedGeometryFeatures: {
    sourceLineCandidateCount: allFeatures.mergedLines.length,
    sourceIdsPreserved: true,
    ...mergedFeatures
  }
}, null, 2));
fs.writeFileSync(allOverlayPath, renderOverlay(allFeatures, imageData, width, height, 'all', objectSymbols));
fs.writeFileSync(structuralOverlayPath, renderOverlay(structuralFeatures, imageData, width, height, 'structural', objectSymbols));
fs.writeFileSync(mergedOverlayPath, renderOverlay(mergedFeatures, imageData, width, height, 'structural', objectSymbols));
console.log(JSON.stringify({
  image: path.basename(imagePath),
  summaryPath,
  allOverlayPath,
  structuralOverlayPath,
  allLines: allFeatures.summary,
  structuralLines: structuralFeatures.summary
}, null, 2));
