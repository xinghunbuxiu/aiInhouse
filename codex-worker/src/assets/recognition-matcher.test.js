const assert = require('assert');
const {
  buildRecognitionPromptAssetContext,
  loadRecognitionAssetCatalog
} = require('../assets/recognition-matcher');

const catalog = loadRecognitionAssetCatalog();
assert.strictEqual(catalog.available, true, 'recognition asset catalog must load');
assert.strictEqual(catalog.symbols.length, 91, 'unexpected recognition symbol count');

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
assert(context.symbolSamples.some((symbol) => symbol.category === 'annotation'),
  'annotation symbols should be represented so they can be distinguished from structure');
assert(context.symbolSamples.every((symbol) => symbol.id && symbol.name && symbol.category),
  'every prompt symbol should have stable identity and category');

console.log(`Recognition asset prompt tests passed: ${context.symbolSamples.length} representative symbols across ${represented.size} categories.`);
