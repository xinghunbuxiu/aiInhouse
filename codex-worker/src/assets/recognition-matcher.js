const {
  loadRecognitionAssetCatalog,
  summarizeRecognitionAssetsForDraft
} = require('./recognition-assets');

const ANNOTATION_REJECT_REASONS = new Set([
  'too-thin-for-wall-band',
  'light-thin-dimension-or-guide-line',
  'dimension-chain-with-short-tick-intersections',
  'dimension-line-near-number-text'
]);

const ANNOTATION_ASSET_PREFIX = 'annotation-';

function isAnnotationGeometryLine(line = {}) {
  const assetId = line.assetMatch?.assetId || '';
  const modelRole = line.assetMatch?.modelRole || '';
  if (modelRole === 'annotation' || modelRole === 'text_label') return true;
  if (assetId.startsWith(ANNOTATION_ASSET_PREFIX)) return true;
  if (line.source === 'annotation-line-candidate') return true;
  const reasons = line.wallRejectReasons || line.wallEvidence?.reasons || [];
  return reasons.some((reason) => ANNOTATION_REJECT_REASONS.has(reason));
}

function shouldExcludeLineFromWalls(line = {}) {
  if (isAnnotationGeometryLine(line)) return true;
  const assetId = line.assetMatch?.assetId || '';
  if (assetId === 'railing-balcony' || assetId === 'railing-glass' || assetId === 'railing-stair') return true;
  if (line.assetMatch?.modelRole === 'railing') return true;
  return false;
}

const WALL_REJECT_REASON_TO_ASSET = {
  'too-thin-for-wall-band': 'annotation-dimension',
  'light-thin-dimension-or-guide-line': 'annotation-dimension',
  'dimension-chain-with-short-tick-intersections': 'annotation-dimension',
  'dimension-line-near-number-text': 'annotation-dimension',
  'isolated-line-no-wall-intersection': null,
  'too-short-for-structural-wall': null
};

const FURNITURE_TYPE_TO_ASSET = {
  bed: 'furniture-bed',
  sofa_or_table: 'furniture-sofa',
  table_or_fixture: 'furniture-table',
  bath_fixture_or_appliance: 'fixture-toilet',
  kitchen_appliance: 'fixture-stove',
  wardrobe: 'furniture-wardrobe',
  cabinet: 'furniture-cabinet',
  nightstand: 'furniture-nightstand',
  chair: 'furniture-chair',
  dining_set: 'furniture-dining-set',
  tv_cabinet: 'furniture-tv-cabinet',
  desk: 'furniture-desk',
  shower: 'fixture-shower',
  washer: 'fixture-washer',
  fridge: 'fixture-fridge',
  dishwasher: 'fixture-dishwasher',
  bidet: 'fixture-bidet',
  dimension_or_auxiliary_mark: 'annotation-dimension'
};

const MEP_TYPE_TO_ASSET = {
  floor_heating: 'floor-heating',
  radiator: 'radiator',
  hvac_indoor: 'HVAC-indoor-unit',
  fresh_air_vent: 'fresh-air-vent'
};

const ELECTRICAL_TYPE_TO_ASSET = {
  power_outlet: 'outlet-power',
  low_voltage_outlet: 'outlet-low-voltage',
  switch_single: 'switch-single',
  ceiling_light: 'light-ceiling',
  light_strip: 'light-strip'
};

const ANNOTATION_TYPE_TO_ASSET = {
  dimension_or_auxiliary_mark: 'annotation-dimension',
  dimension_text: 'annotation-dimension',
  auxiliary_line: 'annotation-dimension',
  tick_mark: 'annotation-dimension',
  drawing_margin_label: 'annotation-title-block',
  axis_bubble: 'annotation-axis',
  elevation_mark: 'annotation-elevation',
  section_cut: 'annotation-section',
  scale_bar: 'annotation-scale',
  title_block: 'annotation-title-block',
  north_mark: 'annotation-north',
  opening_or_auxiliary_frame: 'annotation-opening-frame',
  room_area_mark: 'annotation-room-area',
  room_label: 'annotation-room-label'
};

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function findSymbolById(catalog, id) {
  return (catalog.symbols || []).find((symbol) => symbol.id === id) || null;
}

function buildAssetMatch(symbol, confidence = 0.7, evidence = []) {
  if (!symbol) return null;
  return {
    assetId: symbol.id,
    assetName: symbol.name,
    modelRole: symbol.modelRole,
    outputField: symbol.outputField,
    confidence: Number(confidence.toFixed(3)),
    evidence
  };
}

function matchWallLineCandidate(line = {}, catalog = loadRecognitionAssetCatalog()) {
  const reasons = line.wallRejectReasons || line.wallEvidence?.reasons || line.rejectReasons || [];
  for (const reason of reasons) {
    const assetId = WALL_REJECT_REASON_TO_ASSET[reason];
    if (assetId) {
      return buildAssetMatch(findSymbolById(catalog, assetId), 0.82, [`reject:${reason}`]);
    }
  }

  const thickness = toNumber(line.thickness, 0);
  const tone = line.wallEvidence?.tone || line.tone || {};
  const veryDark = toNumber(tone.veryDarkRatio, 0);
  const dark = toNumber(tone.darkRatio, 0);

  const dashed = Boolean(line.dashed || line.lineStyle === 'dashed' || /dash|demolish/i.test(String(line.source || '')));
  if (dashed) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-demolished'), 0.7, ['dashed-wall-candidate']);
  }

  if (thickness >= 16 && veryDark >= 0.5) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-shear'), 0.8 + Math.min(0.08, thickness / 50), ['very-thick-shear-band']);
  }
  if (thickness >= 14 && veryDark >= 0.45) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-load-bearing'), 0.78 + Math.min(0.1, thickness / 40), ['thick-very-dark-band']);
  }
  if (thickness >= 10 && dark >= 0.5) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-exterior'), 0.72, ['thick-dark-band']);
  }
  if (thickness <= 5 && dark < 0.35) {
    return buildAssetMatch(findSymbolById(catalog, 'railing-balcony'), 0.62, ['thin-light-rail-candidate']);
  }
  if (thickness >= 7 && thickness < 10) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-interior'), 0.68, ['medium-wall-band']);
  }
  if (thickness > 0 && thickness < 9) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-partition'), 0.64, ['thin-wall-band']);
  }

  if (line.source === 'morphology-wall-band' || line.wallSeed === 'structural') {
    return buildAssetMatch(findSymbolById(catalog, 'wall-interior'), 0.66, ['morphology-wall-band']);
  }

  return null;
}

function matchFurnitureSymbol(candidate = {}, catalog = loadRecognitionAssetCatalog()) {
  const type = candidate.type || '';
  const assetId = FURNITURE_TYPE_TO_ASSET[type];
  if (!assetId) return null;
  const symbol = findSymbolById(catalog, assetId);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.6), [type]);
}

function matchMepSymbol(candidate = {}, catalog = loadRecognitionAssetCatalog()) {
  const type = candidate.type || '';
  const assetId = MEP_TYPE_TO_ASSET[type];
  if (!assetId) return null;
  const symbol = findSymbolById(catalog, assetId);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.55), [type]);
}

function matchElectricalSymbol(candidate = {}, catalog = loadRecognitionAssetCatalog()) {
  const type = candidate.type || '';
  const assetId = ELECTRICAL_TYPE_TO_ASSET[type];
  if (!assetId) return null;
  const symbol = findSymbolById(catalog, assetId);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.55), [type]);
}

function matchAnnotationSymbol(candidate = {}, catalog = loadRecognitionAssetCatalog()) {
  const type = candidate.type || '';
  const assetId = ANNOTATION_TYPE_TO_ASSET[type] || 'annotation-dimension';
  const symbol = findSymbolById(catalog, assetId);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.7), [type || 'annotation']);
}

function matchDoorSymbol(candidate = {}, catalog = loadRecognitionAssetCatalog()) {
  const width = toNumber(candidate.width);
  const height = toNumber(candidate.height);
  const hasArc = Boolean(candidate.hasSwingArc || candidate.swingArc);
  const type = String(candidate.type || candidate.kind || candidate.doorType || '').toLowerCase();
  const doorType = String(candidate.doorType || '').toLowerCase();
  const inferred = String(candidate.sourceEvidence?.inferredFrom || candidate.source || '').toLowerCase();

  let assetId = 'door-single-swing';
  if (doorType.includes('entrance') || type.includes('entrance') || inferred.includes('entry') || inferred.includes('entrance')) {
    assetId = type.includes('security') || doorType.includes('security') || type.includes('子母') ? 'door-security' : 'door-entrance';
  } else if (doorType.includes('arch') || type.includes('arch') || type.includes('拱')) {
    assetId = 'door-arch';
  } else if (doorType.includes('fold') || type.includes('fold') || inferred.includes('fold')) {
    assetId = 'door-folding';
  } else if (doorType.includes('pocket') || type.includes('pocket') || inferred.includes('pocket')) {
    assetId = 'door-pocket';
  } else if (doorType.includes('double') || type.includes('double')) {
    assetId = 'door-double-swing';
  } else if (type.includes('pass') || doorType.includes('pass') || type.includes('opening') || inferred.includes('pass-through') || inferred.includes('wall-gap')) {
    assetId = (!hasArc && width > 20) ? 'opening-pass-through' : 'door-single-swing';
  } else if (width > height * 1.4 && !hasArc) {
    assetId = 'door-sliding';
  } else if (width > height * 1.2 && hasArc) {
    assetId = 'door-double-swing';
  }

  const symbol = findSymbolById(catalog, assetId);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.72), [assetId, hasArc ? 'swing-arc' : '']);
}

function matchWindowSymbol(candidate = {}, catalog = loadRecognitionAssetCatalog()) {
  const source = String(candidate.source || '');
  const type = String(candidate.type || candidate.kind || candidate.windowType || '').toLowerCase();
  const windowType = String(candidate.windowType || '').toLowerCase();
  const width = toNumber(candidate.width);
  const height = toNumber(candidate.height);

  let assetId = 'window-standard';
  if (source.includes('bay') || candidate.isBayWindow || type.includes('bay') || windowType.includes('bay')) {
    assetId = 'window-bay';
  } else if (windowType.includes('slid') || type.includes('slid') || type.includes('推拉')) {
    assetId = 'window-sliding';
  } else if (windowType.includes('casement') || type.includes('casement') || type.includes('平开')) {
    assetId = 'window-casement';
  } else if (windowType.includes('high') || type.includes('high') || type.includes('高窗')) {
    assetId = 'window-high';
  } else if (type.includes('french') || type.includes('落地')) {
    assetId = 'window-french';
  } else if (type.includes('louver') || type.includes('百叶')) {
    assetId = 'window-louver';
  } else if (type.includes('skylight') || type.includes('天窗')) {
    assetId = 'window-skylight';
  } else if (height > width * 1.5) {
    assetId = 'window-french';
  } else if (width > 0 && height > 0 && width < 56 && height < 28) {
    assetId = 'window-high';
  }

  const symbol = findSymbolById(catalog, assetId);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.72), [assetId]);
}

function matchBalconyCandidate(candidate = {}, catalog = loadRecognitionAssetCatalog()) {
  const type = String(candidate.type || candidate.kind || candidate.label || '').toLowerCase();
  const area = toNumber(candidate.area, toNumber(candidate.width) * toNumber(candidate.height));
  let assetId = 'balcony-outline';
  if (type.includes('terrace') || type.includes('露台') || area > 18000) {
    assetId = 'terrace-outline';
  } else if (type.includes('court') || type.includes('天井') || type.includes('内院')) {
    assetId = 'courtyard-outline';
  }
  const symbol = findSymbolById(catalog, assetId);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.7), [assetId]);
}

function matchStructuralWallVector(vector = {}, catalog = loadRecognitionAssetCatalog()) {
  const thickness = Math.min(toNumber(vector.width), toNumber(vector.height));
  const area = toNumber(vector.area);
  const aspect = Math.max(toNumber(vector.width), toNumber(vector.height)) / Math.max(1, Math.min(toNumber(vector.width), toNumber(vector.height)));
  const nearRound = Math.abs(toNumber(vector.width) - toNumber(vector.height)) <= Math.max(6, thickness * 0.25);

  if (area < 2500 && aspect < 1.35 && nearRound) {
    return buildAssetMatch(findSymbolById(catalog, 'column-round'), 0.76, ['round-structural-block']);
  }
  if (area < 2500 && aspect < 2.2 && thickness < 48) {
    return buildAssetMatch(findSymbolById(catalog, 'column-rect'), 0.74, ['compact-structural-block']);
  }
  if (thickness >= 20 || area > 10000) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-shear'), 0.78, ['thick-shear-mask']);
  }
  if (thickness >= 18 || area > 8000) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-load-bearing'), 0.76, ['large-structural-mask']);
  }
  return buildAssetMatch(findSymbolById(catalog, 'wall-exterior'), 0.7, ['structural-wall-mask']);
}

function annotateCandidateList(list = [], matcher) {
  return list.map((item) => {
    const assetMatch = matcher(item);
    return assetMatch ? { ...item, assetMatch } : item;
  });
}

function summarizeMatches(items = []) {
  const counts = {};
  for (const item of items) {
    const id = item.assetMatch?.assetId;
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function annotatePreprocessingWithAssets(preprocessing = {}, catalog = loadRecognitionAssetCatalog()) {
  if (!preprocessing || !catalog.available) {
    return {
      ...preprocessing,
      recognitionAssets: summarizeRecognitionAssetsForDraft(catalog)
    };
  }

  const geometry = preprocessing.geometryCandidates || {};
  const lines = annotateCandidateList(geometry.lines || [], (line) => matchWallLineCandidate(line, catalog));
  const furnitureSymbolCandidates = annotateCandidateList(
    geometry.furnitureSymbolCandidates || [],
    (item) => matchFurnitureSymbol(item, catalog)
  );
  const annotationSymbolCandidates = annotateCandidateList(
    geometry.annotationSymbolCandidates || [],
    (item) => matchAnnotationSymbol(item, catalog)
  );
  const doorSymbolCandidates = annotateCandidateList(
    geometry.doorSymbolCandidates || [],
    (item) => matchDoorSymbol(item, catalog)
  );
  const windowSymbolCandidates = annotateCandidateList(
    geometry.windowSymbolCandidates || [],
    (item) => matchWindowSymbol(item, catalog)
  );
  const balconyCandidates = annotateCandidateList(
    geometry.balconyCandidates || [],
    (item) => matchBalconyCandidate(item, catalog)
  );
  const structuralWallVectors = annotateCandidateList(
    geometry.structuralWallVectors || [],
    (item) => matchStructuralWallVector(item, catalog)
  );
  const mepSymbolCandidates = annotateCandidateList(
    geometry.mepSymbolCandidates || [],
    (item) => matchMepSymbol(item, catalog)
  );
  const electricalSymbolCandidates = annotateCandidateList(
    geometry.electricalSymbolCandidates || [],
    (item) => matchElectricalSymbol(item, catalog)
  );

  const matchSummary = {
    lines: summarizeMatches(lines),
    doors: summarizeMatches(doorSymbolCandidates),
    windows: summarizeMatches(windowSymbolCandidates),
    furniture: summarizeMatches(furnitureSymbolCandidates),
    annotations: summarizeMatches(annotationSymbolCandidates),
    balconies: summarizeMatches(balconyCandidates),
    structuralVectors: summarizeMatches(structuralWallVectors),
    mep: summarizeMatches(mepSymbolCandidates),
    electrical: summarizeMatches(electricalSymbolCandidates)
  };

  const matchedCandidateCount = [
    ...lines,
    ...furnitureSymbolCandidates,
    ...annotationSymbolCandidates,
    ...doorSymbolCandidates,
    ...windowSymbolCandidates,
    ...balconyCandidates,
    ...structuralWallVectors,
    ...mepSymbolCandidates,
    ...electricalSymbolCandidates
  ].filter((item) => item.assetMatch).length;

  const excludedAnnotationLineCount = lines.filter((line) => shouldExcludeLineFromWalls(line)).length;

  return {
    ...preprocessing,
    recognitionAssets: {
      ...summarizeRecognitionAssetsForDraft(catalog),
      matchSummary,
      matchedCandidateCount,
      excludedAnnotationLineCount
    },
    geometryCandidates: {
      ...geometry,
      lines,
      furnitureSymbolCandidates,
      annotationSymbolCandidates,
      doorSymbolCandidates,
      windowSymbolCandidates,
      balconyCandidates,
      structuralWallVectors,
      mepSymbolCandidates,
      electricalSymbolCandidates
    }
  };
}

function applyAssetWallRoles(walls = [], preprocessing = {}) {
  const bounds = getEnvelopeFromWalls(walls);
  const thicknessMedian = median(walls.map((wall) => toNumber(wall.thickness, 10)));

  return walls.map((wall) => {
    const thickness = toNumber(wall.thickness, 10);
    const onEnvelope = isWallOnEnvelope(wall, bounds, 18);
    let structuralType = 'interior';
    let assetId = 'wall-interior';

    if (onEnvelope) {
      structuralType = 'exterior';
      assetId = 'wall-exterior';
    } else if (thickness >= thicknessMedian + 4 && thickness >= 14) {
      structuralType = 'load_bearing';
      assetId = 'wall-load-bearing';
    } else if (thickness <= thicknessMedian - 2 && thickness <= 9) {
      structuralType = 'partition';
      assetId = 'wall-partition';
    }

    const catalog = loadRecognitionAssetCatalog();
    const symbol = findSymbolById(catalog, assetId);

    return {
      ...wall,
      wallRole: structuralType === 'exterior' ? 'exterior' : 'interior',
      isExterior: structuralType === 'exterior',
      structuralType,
      assetMatch: buildAssetMatch(symbol, toNumber(wall.confidence, 0.7), [
        onEnvelope ? 'envelope' : 'interior',
        `thickness:${thickness}`
      ])
    };
  });
}

function getEnvelopeFromWalls(walls = []) {
  const xs = walls.flatMap((wall) => [toNumber(wall.start?.x), toNumber(wall.end?.x)]);
  const ys = walls.flatMap((wall) => [toNumber(wall.start?.y), toNumber(wall.end?.y)]);
  if (!xs.length || !ys.length) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

function isWallOnEnvelope(wall, bounds, tolerance = 16) {
  if (wall.orientation === 'horizontal') {
    const y = toNumber(wall.start?.y);
    return Math.abs(y - bounds.minY) <= tolerance || Math.abs(y - bounds.maxY) <= tolerance;
  }
  const x = toNumber(wall.start?.x);
  return Math.abs(x - bounds.minX) <= tolerance || Math.abs(x - bounds.maxX) <= tolerance;
}

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 10;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildRecognitionPromptAssetContext(catalog = loadRecognitionAssetCatalog()) {
  const symbols = (catalog.symbols || []).slice(0, 18).map((symbol) => ({
    id: symbol.id,
    name: symbol.name,
    category: symbol.category,
    modelRole: symbol.modelRole,
    drawing: symbol.drawingRules?.lineStyle,
    rejectIf: (symbol.recognitionHints?.rejectIf || []).slice(0, 3)
  }));

  return {
    version: catalog.version,
    parsePipeline: catalog.parsePipeline || [],
    symbolSamples: symbols,
    note: '尺寸线/标注不得当墙；门需门扇+弧；窗需平行细线或凸窗盒；承重墙通常更粗更黑。'
  };
}

module.exports = {
  annotatePreprocessingWithAssets,
  applyAssetWallRoles,
  buildRecognitionPromptAssetContext,
  shouldExcludeLineFromWalls,
  isAnnotationGeometryLine,
  matchWallLineCandidate,
  matchFurnitureSymbol,
  matchMepSymbol,
  matchElectricalSymbol,
  matchDoorSymbol,
  matchWindowSymbol
};
