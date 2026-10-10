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

console.log(`Recognition asset prompt tests passed: ${catalog.symbols.length} catalog symbols; ${context.symbolSamples.length} prompt samples across ${represented.size} categories.`);
