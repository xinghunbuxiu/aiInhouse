const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const dataFile = path.resolve(__dirname, '..', 'data', 'recognition-assets.json');
const glyphDir = path.resolve(process.cwd(), 'uploads', 'recognition-assets', 'glyphs');

function readCatalog() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (error) {
    return {
      version: '0.0.0',
      title: '平面图制图标准识别资产',
      description: '',
      standardRefs: [],
      categories: [],
      parsePipeline: [],
      symbols: [],
      updatedAt: null,
      error: error.message
    };
  }
}

function ensureGlyphFiles(catalog) {
  fs.mkdirSync(glyphDir, { recursive: true });
  for (const symbol of catalog.symbols || []) {
    if (!symbol?.id || !symbol.glyphSvg) continue;
    const filePath = path.join(glyphDir, `${symbol.id}.svg`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, symbol.glyphSvg, 'utf8');
    }
  }
}

function withGlyphUrl(symbol) {
  return {
    ...symbol,
    glyphUrl: `/uploads/recognition-assets/glyphs/${symbol.id}.svg`
  };
}

function filterSymbols(symbols, query = {}) {
  const { category, layer, q, scannerId } = query;
  let list = [...symbols];

  if (category) {
    list = list.filter((item) => item.category === category);
  }
  if (layer) {
    list = list.filter((item) => {
      const categoryMeta = query._categoryLayerMap?.[item.category];
      return categoryMeta === layer || item.layer === layer;
    });
  }
  if (scannerId) {
    list = list.filter((item) => (item.scannerIds || []).includes(scannerId));
  }
  if (q) {
    const keyword = String(q).toLowerCase();
    list = list.filter((item) => [
      item.id,
      item.name,
      ...(item.aliases || []),
      item.modelRole,
      item.outputField,
      ...(item.standardRefs || []),
      ...(item.recognitionHints?.visualFeatures || []),
      item.commercialNotes
    ].join(' ').toLowerCase().includes(keyword));
  }

  return list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

router.get('/', authMiddleware, (req, res) => {
  const catalog = readCatalog();
  ensureGlyphFiles(catalog);

  const categoryLayerMap = Object.fromEntries(
    (catalog.categories || []).map((category) => [category.id, category.layer])
  );

  const symbols = filterSymbols(
    (catalog.symbols || []).map(withGlyphUrl),
    { ...req.query, _categoryLayerMap: categoryLayerMap }
  );

  res.json({
    success: true,
    data: {
      version: catalog.version,
      title: catalog.title,
      description: catalog.description,
      updatedAt: catalog.updatedAt,
      standardRefs: catalog.standardRefs || [],
      categories: catalog.categories || [],
      parsePipeline: catalog.parsePipeline || [],
      total: symbols.length,
      symbols
    }
  });
});

router.get('/catalog', authMiddleware, (req, res) => {
  const catalog = readCatalog();
  ensureGlyphFiles(catalog);

  const categories = catalog.categories || [];
  const symbols = (catalog.symbols || []).map(withGlyphUrl);

  res.json({
    success: true,
    data: {
      version: catalog.version,
      title: catalog.title,
      description: catalog.description,
      updatedAt: catalog.updatedAt,
      standardRefs: catalog.standardRefs || [],
      parsePipeline: catalog.parsePipeline || [],
      categories: categories.map((category) => ({
        ...category,
        symbolCount: symbols.filter((symbol) => symbol.category === category.id).length
      })),
      scannerIndex: symbols.reduce((acc, symbol) => {
        for (const scannerId of symbol.scannerIds || []) {
          if (!acc[scannerId]) acc[scannerId] = [];
          acc[scannerId].push(symbol.id);
        }
        return acc;
      }, {}),
      symbols: symbols.map((symbol) => ({
        id: symbol.id,
        name: symbol.name,
        category: symbol.category,
        modelRole: symbol.modelRole,
        outputField: symbol.outputField,
        scannerIds: symbol.scannerIds || [],
        aliases: symbol.aliases || [],
        priority: symbol.priority || 0,
        recognitionHints: symbol.recognitionHints || {},
        drawingRules: symbol.drawingRules || {},
        glyphUrl: symbol.glyphUrl
      }))
    }
  });
});

router.get('/:id', authMiddleware, (req, res) => {
  const catalog = readCatalog();
  ensureGlyphFiles(catalog);

  const symbol = (catalog.symbols || []).find((item) => item.id === req.params.id);
  if (!symbol) {
    res.status(404).json({ success: false, message: '识别图元不存在' });
    return;
  }

  const category = (catalog.categories || []).find((item) => item.id === symbol.category) || null;

  res.json({
    success: true,
    data: {
      ...withGlyphUrl(symbol),
      categoryMeta: category,
      related: (catalog.symbols || [])
        .filter((item) => item.category === symbol.category && item.id !== symbol.id)
        .slice(0, 8)
        .map((item) => ({
          id: item.id,
          name: item.name,
          glyphUrl: `/uploads/recognition-assets/glyphs/${item.id}.svg`
        }))
    }
  });
});

module.exports = router;
