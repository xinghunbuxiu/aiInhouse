const assert = require('assert');
const {
  buildRecognitionPromptAssetContext,
  loadRecognitionAssetCatalog,
  matchWallLineCandidate
} = require('../assets/recognition-matcher');

const catalog = loadRecognitionAssetCatalog();
assert.strictEqual(catalog.available, true, 'recognition asset catalog must load');
assert(catalog.symbols.length >= 120, `expected expanded symbol catalog, got ${catalog.symbols.length}`);

const context = buildRecognitionPromptAssetContext(catalog);
const represented = new Set(context.symbolSamples.map((symbol) => symbol.category));
for (const category of catalog.categories) {
  assert(
    represented.has(category.id),
    `prompt context is missing category: ${category.id}`
  );
}
assert(context.symbolSamples.length > 18, 'prompt context should not truncate the catalog to the first 18 symbols');
assert(context.symbolSamples.some((symbol) => symbol.category === 'opening' && symbol.visualFeatures.length > 0),
  'door/window symbols should include visual evidence');
assert(context.symbolSamples.some((symbol) => symbol.geometryPriors.length > 0),
  'prompt samples should include geometry priors from the catalog');
assert(context.symbolSamples.some((symbol) => symbol.category === 'annotation'),
  'annotation symbols should be represented so they can be distinguished from structure');
assert(context.symbolSamples.every((symbol) => symbol.id && symbol.name && symbol.category),
  'every prompt symbol should have stable identity and category');

for (const categoryId of ['plumbing', 'fire_safety']) {
  assert(catalog.categories.some((category) => category.id === categoryId),
    `catalog is missing expanded category: ${categoryId}`);
  assert(context.symbolSamples.some((symbol) => symbol.category === categoryId),
    `prompt context is missing expanded category: ${categoryId}`);
}
for (const symbolId of [
  'fixture-kitchen-sink',
  'fixture-floor-drain',
  'plumbing-water-meter',
  'plumbing-gas-pipe',
  'electrical-distribution-box',
  'fire-extinguisher',
  'fire-hydrant',
  'annotation-hidden-line'
]) {
  const symbol = catalog.symbols.find((item) => item.id === symbolId);
  assert(symbol, `missing common floorplan symbol: ${symbolId}`);
  assert(symbol.glyphSvg && symbol.glyphSvg.includes('<svg'),
    `symbol must include a reference glyph: ${symbolId}`);
  assert(symbol.recognitionHints?.visualFeatures?.length,
    `symbol must include visual recognition hints: ${symbolId}`);
}

assert(catalog.symbols.every((symbol) => symbol.id && symbol.name && symbol.category && symbol.glyphSvg),
  'every catalog symbol should include stable identity and a reference glyph');

// Treat the catalog as a maintained ontology, not just a loose list of examples.
const categoryIds = catalog.categories.map((category) => category.id);
assert.strictEqual(new Set(categoryIds).size, categoryIds.length,
  'category IDs must be unique');
const symbolIds = catalog.symbols.map((symbol) => symbol.id);
assert.strictEqual(new Set(symbolIds).size, symbolIds.length,
  'symbol IDs must be unique');

for (const category of catalog.categories) {
  assert(catalog.parsePipeline.includes(category.id),
    `category must be present in parsePipeline: ${category.id}`);
  assert(catalog.symbols.some((symbol) => symbol.category === category.id),
    `category must have at least one symbol: ${category.id}`);
}
for (const symbol of catalog.symbols) {
  assert(categoryIds.includes(symbol.category),
    `symbol points to an unknown category: ${symbol.id} -> ${symbol.category}`);
  assert(Array.isArray(symbol.aliases),
    `symbol aliases must be an array: ${symbol.id}`);
  assert(Array.isArray(symbol.recognitionHints?.visualFeatures)
      && symbol.recognitionHints.visualFeatures.length > 0,
    `symbol needs visual recognition features: ${symbol.id}`);
  assert(Array.isArray(symbol.recognitionHints?.geometryPriors)
      && symbol.recognitionHints.geometryPriors.length > 0,
    `symbol needs geometric/context priors: ${symbol.id}`);
  assert(symbol.glyphSvg.startsWith('<svg') && symbol.glyphSvg.includes('</svg>'),
    `symbol SVG reference must be a complete SVG element: ${symbol.id}`);
}
assert(catalog.parsePipeline.every((categoryId) => categoryIds.includes(categoryId)),
  'parsePipeline must not contain unknown categories');


// Geometry relations are attached to the same original line candidates before
// semantic asset matching, so a dark line can be interpreted with its context.
const topologyLines = enrichLineGeometryEvidence([
  { id: 'wall-horizontal', start: { x: 10, y: 50 }, end: { x: 110, y: 50 }, orientation: 'horizontal' },
  { id: 'wall-parallel', start: { x: 10, y: 60 }, end: { x: 110, y: 60 }, orientation: 'horizontal' },
  { id: 'partition-t', start: { x: 55, y: 50 }, end: { x: 55, y: 90 }, orientation: 'vertical' },
  { id: 'isolated', start: { x: 200, y: 200 }, end: { x: 230, y: 200 }, orientation: 'horizontal' }
]);
const horizontalEvidence = topologyLines.find((line) => line.id === 'wall-horizontal').geometryEvidence;
assert(horizontalEvidence.parallelLineIds.includes('wall-parallel'),
  'parallel relation should be retained for matching');
assert(horizontalEvidence.junctionLineIds.includes('partition-t'),
  'T-junction relation should be retained for matching');
assert(horizontalEvidence.tJunctionCount > 0,
  'endpoint-to-segment connection should be recorded as a T-junction');
const unequalLengthJunction = enrichLineGeometryEvidence([
  { id: 'long-horizontal', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
  { id: 'short-vertical', start: { x: 500, y: 0 }, end: { x: 500, y: 10 } }
]);
assert.strictEqual(unequalLengthJunction.find((line) => line.id === 'long-horizontal').geometryEvidence.tJunctionCount, 1,
  'a short branch endpoint on a long segment should be classified as a T-junction using each segment own length');
assert.strictEqual(unequalLengthJunction.find((line) => line.id === 'short-vertical').geometryEvidence.tJunctionCount, 1,
  'junction classification should be symmetric when segment lengths differ');
assert.strictEqual(topologyLines.find((line) => line.id === 'isolated').geometryEvidence.junctionCount, 0,
  'isolated geometry must not inherit unrelated junction evidence');
const topologyMatch = matchWallLineCandidate({
  id: 'wall-horizontal', source: 'morphology-wall-band', thickness: 11,
  geometryEvidence: horizontalEvidence
}, catalog);
assert(topologyMatch.evidence.includes('parallel-relations:1'),
  'wall match evidence should include nearby parallel relations');
assert(topologyMatch.evidence.some((item) => item.startsWith('T-junctions:')),
  'wall match evidence should include T-junction topology');

// Original-pixel appearance must flow into candidate matching as supporting
// evidence, without allowing color alone to label a line as a wall.
const appearanceMatch = matchWallLineCandidate({
  id: 'appearance-wall-candidate',
  source: 'morphology-wall-band',
  thickness: 11,
  appearance: {
    meanLuminance: 72.4,
    luminanceP10: 48,
    luminanceStdDev: 21.2,
    darkPixelRatio: 0.72,
    centerBackgroundContrast: 126,
    meanBGR: [52, 63, 71]
  }
}, catalog);
assert(appearanceMatch, 'structural wall-band candidates should still be matched');
assert(appearanceMatch.evidence.includes('thick-dark-band'),
  'appearance dark ratio should support wall-candidate matching when legacy tone is absent');
assert(appearanceMatch.evidence.includes('mean-luminance:72.4'),
  'asset match must retain measured luminance as traceable evidence');
assert(appearanceMatch.evidence.includes('stroke-contrast:126.0'),
  'asset match must retain stroke/background contrast');
assert(appearanceMatch.evidence.includes('mean-BGR:52.0,63.0,71.0'),
  'asset match must retain sampled color evidence');
assert(!matchWallLineCandidate({
  id: 'color-only-line', source: 'hough-edge',
  appearance: { meanLuminance: 12, darkPixelRatio: 1, centerBackgroundContrast: 220 }
}, catalog),
  'dark appearance alone must not create a wall or object classification');

// Merged-line evidence must reach semantic matching without losing provenance.
const mergedAppearanceMatch = matchWallLineCandidate({
  id: 'merged-appearance-wall-candidate',
  source: 'morphology-wall-band',
  thickness: 11,
  sourceAppearances: [
    { lineId: 'original-a', appearance: { meanLuminance: 80, luminanceP10: 55, darkPixelRatio: 0.2, centerBackgroundContrast: 90 } },
    { lineId: 'original-b', appearance: { meanLuminance: 68, luminanceP10: 42, darkPixelRatio: 0.68, centerBackgroundContrast: 118, meanBGR: [40, 50, 60] } }
  ]
}, catalog);
assert(mergedAppearanceMatch, 'merged structural candidates should still be matched');
assert(mergedAppearanceMatch.evidence.includes('thick-dark-band'),
  'dark ratio from a source segment should support a merged wall candidate');
assert(mergedAppearanceMatch.evidence.includes('source:original-a:mean-luminance:80.0'),
  'merged match should preserve first source appearance and provenance');
assert(mergedAppearanceMatch.evidence.includes('source:original-b:mean-luminance:68.0'),
  'merged match should preserve second source appearance and provenance');
assert(mergedAppearanceMatch.evidence.includes('source:original-b:dark-pixel-ratio:0.680'),
  'merged match should retain per-source dark-pixel measurements');

console.log(`Recognition asset prompt tests passed: ${catalog.symbols.length} catalog symbols; ${context.symbolSamples.length} prompt samples across ${represented.size} categories.`);
