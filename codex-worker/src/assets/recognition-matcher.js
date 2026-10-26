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
  // Merged geometry stores pixel measurements per original segment in
  // sourceAppearances. Consume those measurements too; otherwise the evidence
  // survives normalization/merge but silently disappears at semantic matching.
  const appearances = [];
  if (line.appearance && typeof line.appearance === 'object') {
    appearances.push({ lineId: line.id || 'line', appearance: line.appearance });
  }
  if (Array.isArray(line.sourceAppearances)) {
    for (const source of line.sourceAppearances) {
      if (source?.appearance && typeof source.appearance === 'object') {
        appearances.push({ lineId: source.lineId || 'source-line', appearance: source.appearance });
      }
    }
  }
  const tone = line.wallEvidence?.tone || line.tone || {};
  // Prefer existing detector tone metrics; use source-pixel measurements when
  // those metrics are absent. Appearance is supporting evidence, never a label.
  const sourceDarkRatios = appearances.map((item) => toNumber(item.appearance.darkPixelRatio, 0));
  const sourceP10 = appearances.map((item) => toNumber(item.appearance.luminanceP10, 255));
  const veryDark = Number.isFinite(Number(tone.veryDarkRatio))
    ? toNumber(tone.veryDarkRatio, 0)
    : (sourceP10.some((value) => value < 95) ? 0.25 : 0);
  const dark = Number.isFinite(Number(tone.darkRatio))
    ? toNumber(tone.darkRatio, 0)
    : Math.max(0, ...sourceDarkRatios);
  const geometryEvidence = line.geometryEvidence || {};
  const topologyEvidence = [];
  if (toNumber(geometryEvidence.junctionCount) > 0) topologyEvidence.push(`junctions:${toNumber(geometryEvidence.junctionCount)}`);
  if (toNumber(geometryEvidence.tJunctionCount) > 0) topologyEvidence.push(`T-junctions:${toNumber(geometryEvidence.tJunctionCount)}`);
  if (toNumber(geometryEvidence.endpointJunctionCount) > 0) topologyEvidence.push(`endpoint-junctions:${toNumber(geometryEvidence.endpointJunctionCount)}`);
  if (toNumber(geometryEvidence.cornerJunctionCount) > 0) topologyEvidence.push(`corner-junctions:${toNumber(geometryEvidence.cornerJunctionCount)}`);
  if (toNumber(geometryEvidence.crossJunctionCount) > 0) topologyEvidence.push(`cross-junctions:${toNumber(geometryEvidence.crossJunctionCount)}`);
  if (toNumber(geometryEvidence.parallelRelationCount) > 0) topologyEvidence.push(`parallel-relations:${toNumber(geometryEvidence.parallelRelationCount)}`);
  if (toNumber(geometryEvidence.nearEndpointGapCount) > 0) topologyEvidence.push(`near-endpoint-gaps:${toNumber(geometryEvidence.nearEndpointGapCount)}`);
  const nearGapLineIds = Array.isArray(geometryEvidence.nearEndpointGapLineIds)
    ? geometryEvidence.nearEndpointGapLineIds.filter(Boolean).sort()
    : [];
  if (nearGapLineIds.length) topologyEvidence.push(`near-endpoint-gap-lines:${nearGapLineIds.join(',')}`);
  if (toNumber(geometryEvidence.nearTJunctionCount) > 0) {
    topologyEvidence.push(`near-T-junctions:${toNumber(geometryEvidence.nearTJunctionCount)}`);
    const nearTLineIds = Array.isArray(geometryEvidence.nearTJunctionLineIds)
      ? geometryEvidence.nearTJunctionLineIds.filter(Boolean).sort()
      : [];
    if (nearTLineIds.length) topologyEvidence.push(`near-T-lines:${nearTLineIds.join(',')}`);
  }
  const appearanceEvidence = [];
  for (const { lineId, appearance } of appearances) {
    const prefix = appearances.length > 1 ? `source:${lineId}:` : '';
    if (Number.isFinite(Number(appearance.meanLuminance))) appearanceEvidence.push(`${prefix}mean-luminance:${toNumber(appearance.meanLuminance).toFixed(1)}`);
    if (Number.isFinite(Number(appearance.centerBackgroundContrast))) appearanceEvidence.push(`${prefix}stroke-contrast:${toNumber(appearance.centerBackgroundContrast).toFixed(1)}`);
    if (Number.isFinite(Number(appearance.luminanceStdDev))) appearanceEvidence.push(`${prefix}luminance-variation:${toNumber(appearance.luminanceStdDev).toFixed(1)}`);
    if (Array.isArray(appearance.meanBGR)) appearanceEvidence.push(`${prefix}mean-BGR:${appearance.meanBGR.map((v) => toNumber(v).toFixed(1)).join(',')}`);
    if (Number.isFinite(Number(appearance.darkPixelRatio))) appearanceEvidence.push(`${prefix}dark-pixel-ratio:${toNumber(appearance.darkPixelRatio).toFixed(3)}`);
    if (Number.isFinite(Number(appearance.luminanceP10))) appearanceEvidence.push(`${prefix}luminance-p10:${toNumber(appearance.luminanceP10).toFixed(1)}`);
  }
  const evidence = (items) => [...items, ...topologyEvidence, ...appearanceEvidence];

  const dashed = Boolean(line.dashed || line.lineStyle === 'dashed' || /dash|demolish/i.test(String(line.source || '')));
  if (dashed) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-demolished'), 0.7, evidence(['dashed-wall-candidate']));
  }

  if (thickness >= 16 && veryDark >= 0.5) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-shear'), 0.8 + Math.min(0.08, thickness / 50), evidence(['very-thick-shear-band']));
  }
  if (thickness >= 14 && veryDark >= 0.45) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-load-bearing'), 0.78 + Math.min(0.1, thickness / 40), evidence(['thick-very-dark-band']));
  }
  if (thickness >= 10 && dark >= 0.5) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-exterior'), 0.72, evidence(['thick-dark-band']));
  }
  if (thickness <= 5 && dark < 0.35) {
    return buildAssetMatch(findSymbolById(catalog, 'railing-balcony'), 0.62, evidence(['thin-light-rail-candidate']));
  }
  if (thickness >= 7 && thickness < 10) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-interior'), 0.68, evidence(['medium-wall-band']));
  }
  if (thickness > 0 && thickness < 9) {
    return buildAssetMatch(findSymbolById(catalog, 'wall-partition'), 0.64, evidence(['thin-wall-band']));
  }

  if (line.source === 'morphology-wall-band' || line.wallSeed === 'structural') {
    return buildAssetMatch(findSymbolById(catalog, 'wall-interior'), 0.66, evidence(['morphology-wall-band']));
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
  const evidence = [assetId];
  if (hasArc) evidence.push('swing-arc');
  if (candidate.wallCandidateId) evidence.push(`wall-candidate:${candidate.wallCandidateId}`);
  if (candidate.gapLength !== undefined && candidate.gapLength !== null && candidate.gapLength !== '') {
    evidence.push(`opening-gap:${toNumber(candidate.gapLength)}`);
  }
  if (candidate.orientation) evidence.push(`orientation:${candidate.orientation}`);
  if (candidate.source) evidence.push(`source:${candidate.source}`);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.72), evidence);
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
  const evidence = [assetId];
  const wallSupport = candidate.wallSupport && typeof candidate.wallSupport === 'object'
    ? candidate.wallSupport : null;
  if (wallSupport?.wallCandidateId) evidence.push(`wall-support:${wallSupport.wallCandidateId}`);
  if (wallSupport?.distance !== undefined && wallSupport.distance !== null && wallSupport.distance !== '') {
    evidence.push(`wall-support-distance:${toNumber(wallSupport.distance).toFixed(1)}`);
  }
  if (wallSupport?.overlapRatio !== undefined && wallSupport.overlapRatio !== null && wallSupport.overlapRatio !== '') {
    evidence.push(`wall-support-overlap:${toNumber(wallSupport.overlapRatio).toFixed(3)}`);
  }
  if (candidate.orientation) evidence.push(`orientation:${candidate.orientation}`);
  if (candidate.source) evidence.push(`source:${candidate.source}`);
  return buildAssetMatch(symbol, toNumber(candidate.confidence, 0.72), evidence);
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

function enrichLineGeometryEvidence(lines = [], options = {}) {
  const endpointTolerance = toNumber(options.endpointTolerance, 5);
  const angleTolerance = toNumber(options.angleToleranceDegrees, 4) * Math.PI / 180;
  const gapAngleTolerance = toNumber(options.gapAngleToleranceDegrees, 12) * Math.PI / 180;
  const gapAlignmentTolerance = toNumber(options.gapAlignmentTolerance, endpointTolerance);
  const nearEndpointGapMax = toNumber(options.nearEndpointGapMax, 16);
  const junctionGapTolerance = toNumber(options.junctionGapTolerance, 8);
  const junctionAngleMinDegrees = toNumber(options.junctionAngleMinDegrees, 20);
  const parallelDistanceMax = toNumber(options.parallelDistanceMax, 48);
  const records = lines.map((line, index) => ({
    line,
    id: line.id || `line-${index + 1}`,
    start: line.start,
    end: line.end,
    angle: Math.atan2(toNumber(line.end?.y) - toNumber(line.start?.y), toNumber(line.end?.x) - toNumber(line.start?.x)),
    length: Math.hypot(toNumber(line.end?.x) - toNumber(line.start?.x), toNumber(line.end?.y) - toNumber(line.start?.y))
  })).filter((item) => item.start && item.end && item.length > 0);
  const evidence = new Map(records.map((item) => [item.id, {
    junctionLineIds: new Set(), tJunctionCount: 0, endpointJunctionCount: 0, cornerJunctionCount: 0, crossJunctionCount: 0,
    parallelLineIds: new Set(), nearEndpointGapLineIds: new Set(), nearEndpointGapCount: 0,
    nearTJunctionLineIds: new Set(), nearTJunctionCount: 0
  }]));
  const projectPointToSegment = (point, segment) => {
    const ax = toNumber(segment.start.x), ay = toNumber(segment.start.y);
    const bx = toNumber(segment.end.x), by = toNumber(segment.end.y);
    const px = toNumber(point.x), py = toNumber(point.y);
    const dx = bx - ax, dy = by - ay;
    const denom = dx * dx + dy * dy;
    const rawT = denom ? ((px - ax) * dx + (py - ay) * dy) / denom : 0;
    const t = Math.max(0, Math.min(1, rawT));
    return {
      t: rawT,
      distanceAlong: rawT * Math.sqrt(denom),
      distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    };
  };
  const pointSegmentDistance = (point, segment) => projectPointToSegment(point, segment).distance;
  const endpoint = (item, which) => item[which];
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const a = records[i], b = records[j];
      const ea = evidence.get(a.id), eb = evidence.get(b.id);
      const angleDelta = Math.abs(Math.atan2(Math.sin(a.angle - b.angle), Math.cos(a.angle - b.angle)));
      if (Math.min(angleDelta, Math.PI - angleDelta) <= angleTolerance) {
        const distanceToLine = Math.min(pointSegmentDistance(a.start, b), pointSegmentDistance(a.end, b),
          pointSegmentDistance(b.start, a), pointSegmentDistance(b.end, a));
        if (distanceToLine <= parallelDistanceMax && Math.min(a.length, b.length) >= 20) {
          ea.parallelLineIds.add(b.id); eb.parallelLineIds.add(a.id);
        }
      }
      const cross = (() => {
        const x1 = a.start.x, y1 = a.start.y, x2 = a.end.x, y2 = a.end.y;
        const x3 = b.start.x, y3 = b.start.y, x4 = b.end.x, y4 = b.end.y;
        const den = (x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
        if (Math.abs(den) < 1e-8) return null;
        const t = ((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/den;
        const u = -((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/den;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return {x:x1+t*(x2-x1), y:y1+t*(y2-y1), t, u};
      })();
      if (cross) {
        ea.junctionLineIds.add(b.id); eb.junctionLineIds.add(a.id);
        const aEndpointHit = Math.min(cross.t, 1 - cross.t) * a.length <= endpointTolerance;
        const bEndpointHit = Math.min(cross.u, 1 - cross.u) * b.length <= endpointTolerance;
        if (aEndpointHit && bEndpointHit) {
          // Keep endpoint contact distinct from a true turn: collinear segments
          // can meet at endpoints too, while a corner requires non-parallel rays.
          ea.endpointJunctionCount += 1; eb.endpointJunctionCount += 1;
          const foldedAngle = Math.min(angleDelta, Math.PI - angleDelta);
          if (foldedAngle >= junctionAngleMinDegrees * Math.PI / 180) {
            ea.cornerJunctionCount += 1; eb.cornerJunctionCount += 1;
          }
        } else if (aEndpointHit || bEndpointHit) {
          ea.tJunctionCount += 1; eb.tJunctionCount += 1;
        } else {
          ea.crossJunctionCount += 1; eb.crossJunctionCount += 1;
        }
      } else {
        const endpointPairs = [
          { first: a.start, second: b.start },
          { first: a.start, second: b.end },
          { first: a.end, second: b.start },
          { first: a.end, second: b.end }
        ].map((pair) => ({
          ...pair,
          dx: toNumber(pair.second.x) - toNumber(pair.first.x),
          dy: toNumber(pair.second.y) - toNumber(pair.first.y)
        })).map((pair) => ({ ...pair, gap: Math.hypot(pair.dx, pair.dy) }));
        const closest = endpointPairs.reduce((best, pair) => pair.gap < best.gap ? pair : best);
        // Parallel collinear segments can meet at a shared endpoint without a
        // finite line intersection. Preserve that connectivity, but do not call
        // it a corner: the folded angle is effectively zero.
        if (closest.gap <= endpointTolerance) {
          ea.endpointJunctionCount += 1;
          eb.endpointJunctionCount += 1;
        }
        const parallelEnoughForGap = Math.min(angleDelta, Math.PI - angleDelta) <= gapAngleTolerance;
        const alongGap = Math.abs(closest.dx * Math.cos(a.angle) + closest.dy * Math.sin(a.angle));
        const perpendicularGap = Math.abs(-closest.dx * Math.sin(a.angle) + closest.dy * Math.cos(a.angle));
        // A short Euclidean endpoint distance alone is not a wall-gap signal:
        // perpendicular corners and offset parallel strokes are common in plans.
        // Require a near-collinear continuation and preserve the counterpart ID.
        if (parallelEnoughForGap
          && closest.gap > endpointTolerance
          && closest.gap <= nearEndpointGapMax
          && alongGap > endpointTolerance
          && perpendicularGap <= gapAlignmentTolerance) {
          ea.nearEndpointGapCount += 1;
          eb.nearEndpointGapCount += 1;
          ea.nearEndpointGapLineIds.add(b.id);
          eb.nearEndpointGapLineIds.add(a.id);
        }
        // Also retain a near-T relation when a branch endpoint nearly reaches
        // the interior of another segment. Do not promote parallel strokes or
        // endpoint-to-endpoint corners to this relation.
        const foldedAngle = Math.min(angleDelta, Math.PI - angleDelta);
        const sufficientlyNonParallel = foldedAngle >= junctionAngleMinDegrees * Math.PI / 180;
        const endpointNearInterior = (branch, target) => [branch.start, branch.end].some((point) => {
          const projection = projectPointToSegment(point, target);
          return projection.t >= 0 && projection.t <= 1
            && projection.distanceAlong > endpointTolerance
            && projection.distanceAlong < target.length - endpointTolerance
            && projection.distance <= junctionGapTolerance;
        });
        if (sufficientlyNonParallel
          && (endpointNearInterior(a, b) || endpointNearInterior(b, a))) {
          ea.nearTJunctionCount += 1;
          eb.nearTJunctionCount += 1;
          ea.nearTJunctionLineIds.add(b.id);
          eb.nearTJunctionLineIds.add(a.id);
        }
      }
    }
  }
  return lines.map((line, index) => {
    const id = line.id || `line-${index + 1}`;
    const item = evidence.get(id);
    if (!item) return { ...line, geometryEvidence: { available: false } };
    return { ...line, geometryEvidence: {
      available: true,
      junctionLineIds: [...item.junctionLineIds].sort(),
      junctionCount: item.junctionLineIds.size,
      tJunctionCount: item.tJunctionCount,
      endpointJunctionCount: item.endpointJunctionCount,
      cornerJunctionCount: item.cornerJunctionCount,
      crossJunctionCount: item.crossJunctionCount,
      parallelLineIds: [...item.parallelLineIds].sort(),
      parallelRelationCount: item.parallelLineIds.size,
      nearEndpointGapLineIds: [...item.nearEndpointGapLineIds].sort(),
      nearEndpointGapCount: item.nearEndpointGapCount,
      nearTJunctionLineIds: [...item.nearTJunctionLineIds].sort(),
      nearTJunctionCount: item.nearTJunctionCount,
      interpretation: 'geometric relations are evidence only; no semantic class inferred'
    }};
  });
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
  const geometryEnrichedLines = enrichLineGeometryEvidence(geometry.lines || []);
  const lines = annotateCandidateList(geometryEnrichedLines, (line) => matchWallLineCandidate(line, catalog));
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
  const allSymbols = catalog.symbols || [];
  const categories = catalog.categories || [];
  const parseOrder = catalog.parsePipeline || [];
  const categoryOrder = new Map(parseOrder.map((id, index) => [id, index]));
  const categoryMeta = new Map(categories.map((category) => [category.id, category]));

  // Do not take the first N catalog entries: that silently starves later
  // categories (doors/windows, furniture, MEP and electrical symbols) from
  // the model context. Select representative symbols per category instead.
  const limits = {
    wall: 3,
    column: 2,
    opening: 5,
    railing: 1,
    outdoor: 2,
    circulation: 2,
    shaft: 2,
    fixture: 2,
    plumbing: 3,
    appliance: 1,
    mep: 2,
    electrical: 2,
    fire_safety: 2,
    furniture: 2,
    annotation: 2
  };
  const selected = [];
  for (const category of [...categories].sort((a, b) =>
    (categoryOrder.get(a.id) ?? 999) - (categoryOrder.get(b.id) ?? 999)
  )) {
    const limit = limits[category.id] || 1;
    const candidates = allSymbols
      .filter((symbol) => symbol.category === category.id)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    selected.push(...candidates.slice(0, limit));
  }

  const symbols = selected.map((symbol) => ({
    id: symbol.id,
    name: symbol.name,
    aliases: (symbol.aliases || []).slice(0, 4),
    category: symbol.category,
    categoryName: categoryMeta.get(symbol.category)?.name || symbol.category,
    modelRole: symbol.modelRole,
    outputField: symbol.outputField,
    scannerIds: (symbol.scannerIds || []).slice(0, 3),
    drawing: {
      lineStyle: symbol.drawingRules?.lineStyle || null,
      relativeThickness: symbol.drawingRules?.relativeThickness || null,
      commonVariants: (symbol.drawingRules?.commonVariants || []).slice(0, 4)
    },
    visualFeatures: (symbol.recognitionHints?.visualFeatures || []).slice(0, 5),
    geometryPriors: (symbol.recognitionHints?.geometryPriors || symbol.recognitionHints?.geometryPrior || []).slice(0, 5),
    rejectIf: (symbol.recognitionHints?.rejectIf || []).slice(0, 4)
  }));

  return {
    version: catalog.version,
    parsePipeline: parseOrder,
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      layer: category.layer,
      symbolCount: allSymbols.filter((symbol) => symbol.category === category.id).length
    })),
    symbolSamples: symbols,
    note: '图例资产用于形成候选解释，不等于已确认检测结果。尺寸线/标注不得当墙；门要结合门扇、开启弧、墙体缺口与邻接空间；窗要结合平行细线/窗框和外墙位置；家具、洁具、电气与暖通符号用于空间语义，不得直接作为墙体。'
  };
}

module.exports = {
  loadRecognitionAssetCatalog,
  annotatePreprocessingWithAssets,
  applyAssetWallRoles,
  buildRecognitionPromptAssetContext,
  shouldExcludeLineFromWalls,
  isAnnotationGeometryLine,
  matchWallLineCandidate,
  enrichLineGeometryEvidence,
  matchFurnitureSymbol,
  matchMepSymbol,
  matchElectricalSymbol,
  matchDoorSymbol,
  matchWindowSymbol
};
