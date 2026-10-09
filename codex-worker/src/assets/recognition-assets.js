const fs = require('fs');
const path = require('path');

const CANDIDATE_PATHS = [
  path.resolve(__dirname, '../../../backend/data/recognition-assets.json'),
  path.resolve(process.cwd(), 'backend/data/recognition-assets.json'),
  path.resolve(process.cwd(), '../backend/data/recognition-assets.json'),
  path.resolve(process.cwd(), 'data/recognition-assets.json')
];

function resolveCatalogPath() {
  return CANDIDATE_PATHS.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadRecognitionAssetCatalog() {
  const catalogPath = resolveCatalogPath();
  if (!catalogPath) {
    return {
      version: '0.0.0',
      title: '平面图制图标准识别资产',
      symbols: [],
      categories: [],
      parsePipeline: [],
      available: false
    };
  }

  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return {
      ...catalog,
      available: true,
      path: catalogPath
    };
  } catch (error) {
    return {
      version: '0.0.0',
      title: '平面图制图标准识别资产',
      symbols: [],
      categories: [],
      parsePipeline: [],
      available: false,
      error: error.message
    };
  }
}

function summarizeRecognitionAssetsForDraft(catalog = loadRecognitionAssetCatalog()) {
  const symbols = catalog.symbols || [];
  return {
    version: catalog.version || '0.0.0',
    available: Boolean(catalog.available),
    parsePipeline: catalog.parsePipeline || [],
    symbolCount: symbols.length,
    byCategory: (catalog.categories || []).map((category) => ({
      id: category.id,
      name: category.name,
      layer: category.layer,
      count: symbols.filter((symbol) => symbol.category === category.id).length
    })),
    scannerBindings: symbols.reduce((acc, symbol) => {
      for (const scannerId of symbol.scannerIds || []) {
        if (!acc[scannerId]) acc[scannerId] = [];
        acc[scannerId].push({
          id: symbol.id,
          name: symbol.name,
          modelRole: symbol.modelRole,
          hints: symbol.recognitionHints || {}
        });
      }
      return acc;
    }, {})
  };
}

module.exports = {
  loadRecognitionAssetCatalog,
  summarizeRecognitionAssetsForDraft,
  resolveCatalogPath
};
