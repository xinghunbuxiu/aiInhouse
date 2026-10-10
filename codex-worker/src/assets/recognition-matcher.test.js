const assert = require('assert');
const {
  buildRecognitionPromptAssetContext,
  loadRecognitionAssetCatalog
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

console.log(`Recognition asset prompt tests passed: ${catalog.symbols.length} catalog symbols; ${context.symbolSamples.length} prompt samples across ${represented.size} categories.`);
