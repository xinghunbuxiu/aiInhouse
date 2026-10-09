const fs = require('fs');
const path = require('path');
const { recognitionMode } = require('../config');
const { runAiRecognition } = require('./ai-command');
const { runExternalRecognition, getRecognitionDraftFile } = require('./external-command');
const { runRecognitionPreprocess } = require('./preprocess-command');
const {
  isMlWallEnabled,
  resolveSourceImage,
  runMlWallInference,
  attachMlWallsToPreprocessing
} = require('./ml-wall-command');
const { repairRecognitionTopology } = require('./topology');
const { validateFloorplanDraft } = require('./spatial-reasoning');
const { summarizeRecognitionAssetsForDraft } = require('../assets/recognition-assets');
const {
  annotatePreprocessingWithAssets,
  applyAssetWallRoles,
  buildRecognitionPromptAssetContext,
  shouldExcludeLineFromWalls,
  isAnnotationGeometryLine,
  matchWallLineCandidate,
  matchFurnitureSymbol,
  matchDoorSymbol,
  matchWindowSymbol
} = require('../assets/recognition-matcher');

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function inferRoomType(name = '') {
  const normalized = String(name || '').toLowerCase();

  if (normalized.includes('客厅') || normalized.includes('living')) {
    return 'living';
  }

  if (normalized.includes('卧') || normalized.includes('bed')) {
    return 'bedroom';
  }

  if (normalized.includes('厨') || normalized.includes('kitchen')) {
    return 'kitchen';
  }

  if (normalized.includes('卫') || normalized.includes('bath')) {
    return 'bathroom';
  }

  if (normalized.includes('餐') || normalized.includes('dining')) {
    return 'dining';
  }

  if (normalized.includes('阳台') || normalized.includes('balcony')) {
    return 'balcony';
  }

  if (normalized.includes('门厅') || normalized.includes('玄关') || normalized.includes('entry') || normalized.includes('foyer')) {
    return 'entry';
  }

  return 'space';
}

function normalizeOcrText(text = '') {
  return String(text || '').replace(/\s+/g, '').trim();
}

function normalizeOcrCandidate(candidate = {}) {
  const text = normalizeOcrText(candidate.text || candidate.label || candidate.name || candidate.value);
  if (!text) {
    return null;
  }

  const box = candidate.box || candidate.bounds || candidate.boundingBox || {};
  const x = toNumber(candidate.x, toNumber(box.x, toNumber(candidate.left)));
  const y = toNumber(candidate.y, toNumber(box.y, toNumber(candidate.top)));
  const width = toNumber(candidate.width, toNumber(box.width, toNumber(candidate.w)));
  const height = toNumber(candidate.height, toNumber(box.height, toNumber(candidate.h)));
  const center = candidate.center || {};
  return {
    text,
    type: inferRoomType(text),
    x,
    y,
    width,
    height,
    center: {
      x: toNumber(center.x, width ? x + width / 2 : x),
      y: toNumber(center.y, height ? y + height / 2 : y)
    },
    confidence: toNumber(candidate.confidence, 0.72),
    source: candidate.source || 'ocr-candidate'
  };
}

function collectOcrCandidates(job = {}, preprocessing = {}) {
  return [
    ...(preprocessing?.ocrCandidates || []),
    ...(job?.floor_plan?.ocr_candidates || []),
    ...(job?.floor_plan?.room_labels || []),
    ...(job?.job?.input_payload?.ocrCandidates || []),
    ...(job?.job?.input_payload?.roomLabels || [])
  ];
}

function roomContainsPoint(room = {}, point = {}, tolerance = 8) {
  return point.x >= toNumber(room.x) - tolerance
    && point.y >= toNumber(room.y) - tolerance
    && point.x <= toNumber(room.x) + toNumber(room.width) + tolerance
    && point.y <= toNumber(room.y) + toNumber(room.height) + tolerance;
}

function assignOcrSemantics(geometryRooms = [], ocrCandidates = []) {
  const labels = ocrCandidates
    .map(normalizeOcrCandidate)
    .filter((label) => label && label.type !== 'space');
  if (!geometryRooms.length || !labels.length) {
    return geometryRooms;
  }

  const usedLabels = new Set();
  return geometryRooms.map((room) => {
    const roomCenterPoint = roomCenter(room);
    let best = null;
    for (const label of labels) {
      if (usedLabels.has(label)) {
        continue;
      }
      const inside = roomContainsPoint(room, label.center);
      const distance = Math.hypot(roomCenterPoint.x - label.center.x, roomCenterPoint.y - label.center.y);

      // Room semantics must come from a label physically inside that room.
      // Distance-only matching caused labels in elevator shafts, corridors, or
      // neighboring rooms to leak across boundaries and misclassify the room.
      if (!inside) {
        continue;
      }
      const score = 2 + label.confidence * 0.3 - distance / Math.max(Math.hypot(toNumber(room.width), toNumber(room.height)), 1);
      if (!best || score > best.score) {
        best = { label, score, distance, inside };
      }
    }

    if (!best) {
      return room;
    }

    usedLabels.add(best.label);
    return {
      ...room,
      name: best.label.text,
      type: best.label.type,
      confidence: Number(Math.min(0.9, Math.max(toNumber(room.confidence, 0.7), best.label.confidence)).toFixed(2)),
      source: 'opencv-wall-grid-with-ocr-semantics',
      sourceEvidence: {
        ...(room.sourceEvidence || {}),
        ocrText: best.label.text,
        ocrSource: best.label.source,
        ocrDistance: Number(best.distance.toFixed(1)),
        ocrInsideRoom: best.inside
      }
    };
  });
}

function inferExpectedLayout(job = {}) {
  const text = [
    job?.floor_plan?.room,
    job?.house?.layout,
    job?.house?.room,
    job?.house?.description,
    job?.floor_plan?.name,
    job?.job?.input_payload?.processNotes
  ].filter(Boolean).join(' ');

  const roomCount = toNumber(job?.house?.room_count, 0);
  const bedroomMatch = String(text).match(/(\d+)\s*室/);
  const hallMatch = String(text).match(/(\d+)\s*厅/);
  const bathMatch = String(text).match(/(\d+)\s*卫/);
  const kitchenMatch = String(text).match(/(\d+)\s*厨/);

  return {
    text,
    roomCount,
    bedrooms: bedroomMatch ? Number(bedroomMatch[1]) : roomCount || 0,
    halls: hallMatch ? Number(hallMatch[1]) : 0,
    kitchens: kitchenMatch ? Number(kitchenMatch[1]) : (/室|厅|卫/.test(text) ? 1 : 0),
    baths: bathMatch ? Number(bathMatch[1]) : 0,
    isChineseApartment: /室|厅|卫|主卧|客厅|餐厅|阳台|厨房/.test(text)
  };
}

function buildExpectedSpacesFromLayout(job = {}) {
  const layout = inferExpectedLayout(job);
  const mainTarget = (layout.bedrooms || 0) + (layout.halls || 0) + (layout.kitchens || 0) + (layout.baths || 0);
  if (mainTarget < 2) {
    return [];
  }

  const spaces = [];
  for (let i = 0; i < (layout.bedrooms || 0); i += 1) {
    spaces.push({
      name: i === 0 ? '主卧' : i === 1 ? '次卧' : `卧室${i + 1}`,
      type: 'bedroom',
      source: 'layout-count-from-plan-label'
    });
  }
  if ((layout.halls || 0) >= 1) {
    spaces.push({ name: '客厅', type: 'living', source: 'layout-count-from-plan-label' });
  }
  if ((layout.halls || 0) >= 2) {
    spaces.push({ name: '餐厅', type: 'dining', source: 'layout-count-from-plan-label' });
  }
  if ((layout.kitchens || 0) >= 1) {
    spaces.push({ name: '厨房', type: 'kitchen', source: 'layout-count-from-plan-label' });
  }
  for (let i = 0; i < (layout.baths || 0); i += 1) {
    const bathCount = layout.baths || 0;
    spaces.push({
      name: bathCount > 1 && i === 0 ? '主卫' : bathCount > 1 ? '公卫' : '卫生间',
      type: 'bathroom',
      source: 'layout-count-from-plan-label'
    });
  }
  return spaces;
}

function isMlGridActive(preprocessing = {}) {
  return Boolean(preprocessing?.mlWall?.enabled)
    && (preprocessing?.geometryCandidates?.mlWallSegmentCount || 0) >= 6;
}

function isJunkGridCell(room = {}, preprocessing = {}) {
  const width = toNumber(room.width);
  const height = toNumber(room.height);
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  const pixelArea = width * height;
  const aspect = maxDim / Math.max(1, minDim);
  const imageArea = toNumber(preprocessing?.image?.width) * toNumber(preprocessing?.image?.height);
  const edgeScore = toNumber(room.sourceEvidence?.edgeScore, 0);
  const mlRelax = isMlGridActive(preprocessing);

  const minArea = mlRelax ? 3600 : 4800;
  const minSide = mlRelax ? 48 : 55;

  if (minDim < minSide || pixelArea < minArea) {
    return true;
  }
  if (aspect >= 3.5 && minDim < (mlRelax ? 72 : 88)) {
    return true;
  }
  if (imageArea && pixelArea < imageArea * 0.008 && edgeScore < 0.58) {
    return true;
  }
  if (pixelArea < 5200 && aspect >= 2.8 && minDim < 65) {
    return true;
  }
  return false;
}

function assignSemanticsByLayoutCounts(rooms = [], job = {}, preprocessing = {}) {
  const layout = inferExpectedLayout(job);
  const mainTarget = (layout.bedrooms || 0) + (layout.halls || 0) + (layout.kitchens || 0) + (layout.baths || 0);
  if (!mainTarget || mainTarget < 3) {
    return rooms;
  }

  const pool = rooms.filter((room) => isResidualUnclassifiedRoom(room) && !isJunkGridCell(room, preprocessing));
  if (pool.length < 2) {
    return rooms;
  }

  const byAreaDesc = [...pool].sort((a, b) => roomPixelArea(b) - roomPixelArea(a));
  const byAreaAsc = [...pool].sort((a, b) => roomPixelArea(a) - roomPixelArea(b));
  const assignments = [];
  const used = new Set();
  const take = (room) => {
    if (!room || used.has(room.id)) return false;
    used.add(room.id);
    return true;
  };
  const gridSource = isMlGridActive(preprocessing) ? 'ml-wall-grid' : 'opencv-wall-grid';
  const overheadBeforeBedrooms = (layout.halls >= 1 ? 1 : 0)
    + (layout.halls >= 2 ? 1 : 0)
    + (layout.baths || 0)
    + ((layout.kitchens || 0) >= 1 ? 1 : 0);
  const bedroomSlotsInDefault = Math.max(0, pool.length - overheadBeforeBedrooms);
  const cellLimited = pool.length < mainTarget
    && (layout.bedrooms || 0) > 0
    && pool.length > overheadBeforeBedrooms
    && bedroomSlotsInDefault < (layout.bedrooms || 0);

  if (layout.halls >= 1) {
    const room = byAreaDesc.find((r) => take(r));
    if (room) assignments.push({ room, type: 'living', name: '客厅' });
  }

  if (cellLimited) {
    // 格数少于户型目标：优先保卧室，再补厨/卫
    if (layout.halls >= 2) {
      const room = byAreaDesc.find((r) => !used.has(r.id));
      if (room && take(room)) assignments.push({ room, type: 'dining', name: '餐厅' });
    }
    const bedroomCount = Math.max(0, layout.bedrooms || 0);
    for (let i = 0; i < bedroomCount; i += 1) {
      const room = byAreaDesc.find((r) => !used.has(r.id));
      if (room && take(room)) {
        const name = i === 0 ? '主卧' : i === 1 ? '次卧' : `卧室${i + 1}`;
        assignments.push({ room, type: 'bedroom', name });
      }
    }
    if ((layout.kitchens || 0) >= 1) {
      const room = byAreaDesc.find((r) => !used.has(r.id));
      if (room && take(room)) assignments.push({ room, type: 'kitchen', name: '厨房' });
    }
    const bathCount = Math.max(0, layout.baths || 0);
    for (let i = 0; i < bathCount; i += 1) {
      const room = byAreaAsc.find((r) => !used.has(r.id));
      if (room && take(room)) {
        const name = bathCount > 1 && i === 0 ? '主卫' : bathCount > 1 ? '公卫' : '卫生间';
        assignments.push({ room, type: 'bathroom', name });
      }
    }
  } else {
    if (layout.halls >= 2) {
      const room = byAreaDesc.find((r) => !used.has(r.id));
      if (room && take(room)) assignments.push({ room, type: 'dining', name: '餐厅' });
    }

    const bathCount = Math.max(0, layout.baths || 0);
    for (let i = 0; i < bathCount; i += 1) {
      const room = byAreaAsc.find((r) => !used.has(r.id));
      if (room && take(room)) {
        const name = bathCount > 1 && i === 0 ? '主卫' : bathCount > 1 ? '公卫' : '卫生间';
        assignments.push({ room, type: 'bathroom', name });
      }
    }

    if ((layout.kitchens || 0) >= 1) {
      const room = byAreaDesc.find((r) => !used.has(r.id) && roomPixelArea(r) < roomPixelArea(byAreaDesc[0]) * 0.55)
        || byAreaAsc.find((r) => !used.has(r.id));
      if (room && take(room)) assignments.push({ room, type: 'kitchen', name: '厨房' });
    }

    const bedroomCount = Math.max(0, layout.bedrooms || 0);
    for (let i = 0; i < bedroomCount; i += 1) {
      const room = byAreaDesc.find((r) => !used.has(r.id));
      if (room && take(room)) {
        const name = i === 0 ? '主卧' : i === 1 ? '次卧' : `卧室${i + 1}`;
        assignments.push({ room, type: 'bedroom', name });
      }
    }
  }

  return rooms
    .map((room) => {
      const match = assignments.find((item) => item.room.id === room.id);
      if (match) {
        return {
          ...room,
          name: match.name,
          type: match.type,
          source: `${gridSource}-layout-count-semantics`,
          confidence: Number(Math.min(0.82, Math.max(toNumber(room.confidence, 0.68), 0.76)).toFixed(2)),
          sourceEvidence: {
            ...(room.sourceEvidence || {}),
            layoutCountAssigned: true,
            expectedLayout: {
              bedrooms: layout.bedrooms,
              halls: layout.halls,
              kitchens: layout.kitchens,
              baths: layout.baths
            }
          }
        };
      }
      if (isJunkGridCell(room, preprocessing) || isResidualUnclassifiedRoom(room)) {
        return null;
      }
      return room;
    })
    .filter(Boolean);
}

function getGeometryBounds(preprocessing = {}) {
  const points = [];
  for (const line of preprocessing?.geometryCandidates?.lines || []) {
    if (line?.start && line?.end) {
      points.push(line.start, line.end);
    }
  }
  for (const contour of preprocessing?.geometryCandidates?.contours || []) {
    points.push(
      { x: contour.x, y: contour.y },
      { x: toNumber(contour.x) + toNumber(contour.width), y: toNumber(contour.y) + toNumber(contour.height) }
    );
  }

  if (!points.length) {
    const image = preprocessing?.image || {};
    return {
      x: 40,
      y: 40,
      width: Math.max(420, toNumber(image.width, 1000) - 80),
      height: Math.max(320, toNumber(image.height, 760) - 80)
    };
  }

  const xs = points.map((point) => toNumber(point.x));
  const ys = points.map((point) => toNumber(point.y));
  const minX = Math.max(0, Math.min(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(320, maxX - minX),
    height: Math.max(240, maxY - minY)
  };
}

function scaleRoom(bounds, spec) {
  const room = {
    x: bounds.x + spec.x * bounds.width,
    y: bounds.y + spec.y * bounds.height,
    width: spec.width * bounds.width,
    height: spec.height * bounds.height
  };

  return {
    ...spec,
    x: Math.round(room.x),
    y: Math.round(room.y),
    width: Math.round(room.width),
    height: Math.round(room.height),
    area: spec.area || Math.max(4, Math.round((room.width * room.height) / 5200))
  };
}

function buildChineseApartmentRooms(job, preprocessing) {
  const layout = inferExpectedLayout(job);
  const candidateLineCount = preprocessing?.geometryCandidates?.lines?.length || 0;
  const candidateContourCount = preprocessing?.geometryCandidates?.contours?.length || 0;
  const shouldUseApartmentTemplate = layout.isChineseApartment
    || layout.bedrooms >= 2
    || layout.halls >= 1
    || layout.baths >= 1
    || /uploads\/file-|source-plan|floor-?plan|户型|平面/.test(String(job?.assets?.source_url || job?.assets?.local_source_file || job?.floor_plan?.image_url || ''))
    || candidateLineCount >= 80 && candidateContourCount <= 10;

  if (!shouldUseApartmentTemplate) {
    return [];
  }

  const bounds = getGeometryBounds(preprocessing);
  const bedroomCount = Math.max(2, layout.bedrooms || 2);
  const bathCount = Math.max(1, layout.baths || 1);
  const base = [
    { id: 'master-bedroom', name: '主卧', type: 'bedroom', area: 16, x: 0.17, y: 0.05, width: 0.28, height: 0.37, confidence: 0.74, source: 'layout-template-from-plan-labels' },
    { id: 'bathroom', name: '主卫', type: 'bathroom', area: 7, x: 0.46, y: 0.05, width: 0.19, height: 0.29, confidence: 0.7, source: 'layout-template-from-plan-labels' },
    { id: 'boy-bedroom', name: bedroomCount >= 3 ? '男孩卧' : '次卧', type: 'bedroom', area: 13, x: 0.65, y: 0.18, width: 0.29, height: 0.31, confidence: 0.73, source: 'layout-template-from-plan-labels' },
    { id: 'living-room', name: '客厅', type: 'living', area: 25, x: 0.12, y: 0.48, width: 0.42, height: 0.39, confidence: 0.74, source: 'layout-template-from-plan-labels' },
    { id: 'dining-room', name: '餐厅', type: 'dining', area: 10, x: 0.54, y: 0.55, width: 0.18, height: 0.22, confidence: 0.68, source: 'layout-template-from-plan-labels' },
    { id: 'entry', name: '门厅', type: 'entry', area: 7, x: 0.72, y: 0.56, width: 0.14, height: 0.20, confidence: 0.66, source: 'layout-template-from-plan-labels' },
    { id: 'kitchen', name: '厨房', type: 'kitchen', area: 10, x: 0.75, y: 0.49, width: 0.20, height: 0.25, confidence: 0.72, source: 'layout-template-from-plan-labels' },
    { id: 'balcony', name: '阳台', type: 'balcony', area: 8, x: 0.02, y: 0.44, width: 0.14, height: 0.29, confidence: 0.67, source: 'layout-template-from-plan-labels' }
  ];

  if (bedroomCount >= 4) {
    base.push({ id: 'secondary-bedroom', name: '次卧', type: 'bedroom', area: 11, x: 0.54, y: 0.30, width: 0.22, height: 0.24, confidence: 0.68, source: 'layout-template-from-plan-labels' });
  }
  if (bedroomCount >= 4) {
    base.push({ id: 'bedroom-4', name: '卧室3', type: 'bedroom', area: 10, x: 0.05, y: 0.24, width: 0.21, height: 0.24, confidence: 0.66, source: 'layout-template-from-plan-labels' });
  }
  if (bathCount >= 2) {
    base.push({ id: 'common-bathroom', name: '公卫', type: 'bathroom', area: 5, x: 0.62, y: 0.42, width: 0.13, height: 0.16, confidence: 0.66, source: 'layout-template-from-plan-labels' });
  }

  return base.map((room) => ({
    ...scaleRoom(bounds, room),
    boundaryNeedsReview: true,
    boundaryReviewReason: 'template-room-without-direct-image-geometry',
    sourceEvidence: {
      semanticTemplateOnly: true,
      boundaryNeedsReview: true,
      boundaryReviewReason: 'template-room-without-direct-image-geometry'
    }
  }));
}

function expectedRoomTarget(job) {
  const layout = inferExpectedLayout(job);
  if (!layout.isChineseApartment && !layout.bedrooms && !layout.halls && !layout.baths) {
    return 0;
  }

  const target = (layout.bedrooms || 0)
    + (layout.halls || 0)
    + (layout.kitchens || 0)
    + (layout.baths || 0)
    + 1; // balcony/entry is commonly visible in domestic apartment plans.
  return Math.max(4, Math.min(12, target || 0));
}

function normalizeRooms(parseResult = {}) {
  const rooms = Array.isArray(parseResult.rooms) ? parseResult.rooms : [];

  return rooms.map((room, index) => {
    const width = toNumber(room.width, 100);
    const height = toNumber(room.height, room.length || 80);
    const x = toNumber(room.x, 40 + (index % 3) * 120);
    const y = toNumber(room.y, 40 + Math.floor(index / 3) * 110);

    return {
      id: room.id || `room-${index + 1}`,
      name: room.name || `空间 ${index + 1}`,
      type: room.type || inferRoomType(room.name),
      area: toNumber(room.area, Math.max(6, Math.round((width * height) / 900))),
      x,
      y,
      width,
      height,
      confidence: room.confidence || 0.88
    };
  });
}

function normalizeSegments(items = [], type) {
  return items.map((item, index) => ({
    id: item.id || `${type}-${index + 1}`,
    type: item.type || type,
    x: toNumber(item.x, 0),
    y: toNumber(item.y, 0),
    width: toNumber(item.width, type === 'door' ? 12 : 18),
    height: toNumber(item.height, 8),
    confidence: item.confidence || 0.78
  }));
}

function hasUsableParseRooms(parseResult = {}) {
  const rooms = Array.isArray(parseResult.rooms) ? parseResult.rooms : [];
  if (!rooms.length) {
    return false;
  }

  return rooms.every((room) => (
    Number.isFinite(Number(room.x))
    && Number.isFinite(Number(room.y))
    && Number(room.width) >= 40
    && Number(room.height || room.length) >= 40
  ));
}

function wallLength(wall = {}) {
  const start = wall.start || (Array.isArray(wall.from) ? { x: wall.from[0], y: wall.from[1] } : null);
  const end = wall.end || (Array.isArray(wall.to) ? { x: wall.to[0], y: wall.to[1] } : null);
  if (!start || !end) {
    return 0;
  }
  return Math.hypot(toNumber(end.x) - toNumber(start.x), toNumber(end.y) - toNumber(start.y));
}

function hasUsableParseWalls(parseResult = {}) {
  const walls = Array.isArray(parseResult.walls) ? parseResult.walls : [];
  return walls.filter((wall) => wallLength(wall) >= 40).length >= 4;
}

function synthesizeRooms(job) {
  const sourceType = job?.job?.source_type || job?.floor_plan?.source_type || 'digital';
  const houseName = job?.house?.name || job?.floor_plan?.name || '标准户型';

  const baseRooms = [
    { id: 'living', name: '客厅', type: 'living', area: 24, x: 40, y: 40, width: 160, height: 120, confidence: 0.72 },
    { id: 'master', name: '主卧', type: 'bedroom', area: 18, x: 220, y: 40, width: 130, height: 120, confidence: 0.68 },
    { id: 'kitchen', name: '厨房', type: 'kitchen', area: 10, x: 40, y: 180, width: 120, height: 90, confidence: 0.66 },
    { id: 'bath', name: '卫生间', type: 'bathroom', area: 6, x: 180, y: 180, width: 80, height: 90, confidence: 0.64 }
  ];

  if (sourceType === 'hand_drawn') {
    return baseRooms.map((room) => ({
      ...room,
      sourceHint: `${houseName} 手绘稿推断`
    }));
  }

  return baseRooms.map((room) => ({
    ...room,
    confidence: room.confidence + 0.08,
    sourceHint: `${houseName} 电子图推断`
  }));
}

function buildWallsFromRooms(rooms = []) {
  return rooms.flatMap((room) => {
    const x1 = toNumber(room.x);
    const y1 = toNumber(room.y);
    const x2 = x1 + toNumber(room.width);
    const y2 = y1 + toNumber(room.height);

    return [
      { id: `${room.id}-w1`, start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, thickness: 12, confidence: room.confidence },
      { id: `${room.id}-w2`, start: { x: x2, y: y1 }, end: { x: x2, y: y2 }, thickness: 12, confidence: room.confidence },
      { id: `${room.id}-w3`, start: { x: x2, y: y2 }, end: { x: x1, y: y2 }, thickness: 12, confidence: room.confidence },
      { id: `${room.id}-w4`, start: { x: x1, y: y2 }, end: { x: x1, y: y1 }, thickness: 12, confidence: room.confidence }
    ];
  });
}

function buildWallsFromGeometryCandidates(preprocessing = {}) {
  const mlWalls = preprocessing?.geometryCandidates?.mlWallSegments;
  if (Array.isArray(mlWalls) && mlWalls.length >= 4) {
    return mlWalls.slice(0, 120).map((wall, index) => ({
      id: wall.id || `ml-wall-${index + 1}`,
      start: wall.start || { x: 0, y: 0 },
      end: wall.end || { x: 0, y: 0 },
      thickness: toNumber(wall.thickness, wall.orientation === 'horizontal' ? 10 : 12),
      confidence: toNumber(wall.confidence, 0.86),
      source: 'ml-wall-unet',
      originalSource: wall.source || 'ml-wall-unet',
      sourceCandidateId: wall.id || '',
      orientation: wall.orientation || (
        Math.abs(toNumber(wall.end?.y) - toNumber(wall.start?.y))
          <= Math.abs(toNumber(wall.end?.x) - toNumber(wall.start?.x))
          ? 'horizontal'
          : 'vertical'
      )
    }));
  }

  const lines = preprocessing?.geometryCandidates?.lines || [];
  const wallBandLines = lines
    .filter((line) => line.source === 'morphology-wall-band' || line.source === 'wall-grid-support-line')
    .filter((line) => !shouldExcludeLineFromWalls(line))
    .filter((line) => line.orientation === 'horizontal' || line.orientation === 'vertical');
  const sourceLines = wallBandLines.length >= 8
    ? wallBandLines
    : lines
      .filter((line) => line.source !== 'annotation-line-candidate')
      .filter((line) => !shouldExcludeLineFromWalls(line));

  return sourceLines
    .filter((line) => line.source !== 'annotation-line-candidate')
    .filter((line) => !shouldExcludeLineFromWalls(line))
    .filter((line) => line.orientation === 'horizontal' || line.orientation === 'vertical')
    .slice(0, 80)
    .map((line, index) => ({
      id: `candidate-wall-${index + 1}`,
      start: line.start || { x: 0, y: 0 },
      end: line.end || { x: 0, y: 0 },
      thickness: toNumber(line.thickness, line.orientation === 'horizontal' ? 10 : 12),
      confidence: line.source === 'wall-grid-support-line'
        ? (line.length > 120 ? 0.74 : 0.68)
        : (line.length > 120 ? 0.78 : 0.72),
      source: line.source || 'preprocess-line-candidate',
      originalSource: line.source || 'preprocess-line-candidate',
      sourceCandidateId: line.id || '',
      wallEvidence: line.wallEvidence || null,
      assetMatch: line.assetMatch || null,
      orientation: line.orientation
    }));
}

function buildRoomsFromContours(preprocessing = {}, sourceType = 'digital') {
  const contours = preprocessing?.geometryCandidates?.contours || [];
  const imageArea = toNumber(preprocessing?.image?.width) * toNumber(preprocessing?.image?.height);
  return contours
    .filter((contour) => contour.width >= 45 && contour.height >= 45)
    .filter((contour) => {
      const contourArea = toNumber(contour.width) * toNumber(contour.height);
      return !imageArea || contourArea < imageArea * 0.45;
    })
    .slice(0, 12)
    .map((contour, index) => ({
      id: `candidate-room-${index + 1}`,
      name: `候选空间 ${index + 1}`,
      type: 'space',
      area: Math.max(4, Math.round((toNumber(contour.width) * toNumber(contour.height)) / 900)),
      x: toNumber(contour.x),
      y: toNumber(contour.y),
      width: toNumber(contour.width, 100),
      height: toNumber(contour.height, 80),
      confidence: sourceType === 'hand_drawn' ? 0.55 : 0.64,
      source: 'preprocess-contour-candidate'
    }));
}

function clusterValues(values = [], tolerance = 18) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - last.mean) > tolerance) {
      clusters.push({ values: [value], mean: value });
      continue;
    }
    last.values.push(value);
    last.mean = last.values.reduce((sum, item) => sum + item, 0) / last.values.length;
  }
  return clusters.map((cluster) => Math.round(cluster.mean));
}

function lineCoversSpan(line, axisStart, axisEnd, tolerance = 18) {
  const start = line.orientation === 'horizontal'
    ? Math.min(toNumber(line.start?.x), toNumber(line.end?.x))
    : Math.min(toNumber(line.start?.y), toNumber(line.end?.y));
  const end = line.orientation === 'horizontal'
    ? Math.max(toNumber(line.start?.x), toNumber(line.end?.x))
    : Math.max(toNumber(line.start?.y), toNumber(line.end?.y));
  return start <= axisStart + tolerance && end >= axisEnd - tolerance;
}

function lineSpan(line) {
  if (line.orientation === 'horizontal') {
    return {
      fixed: (toNumber(line.start?.y) + toNumber(line.end?.y)) / 2,
      start: Math.min(toNumber(line.start?.x), toNumber(line.end?.x)),
      end: Math.max(toNumber(line.start?.x), toNumber(line.end?.x))
    };
  }
  return {
    fixed: (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2,
    start: Math.min(toNumber(line.start?.y), toNumber(line.end?.y)),
    end: Math.max(toNumber(line.start?.y), toNumber(line.end?.y))
  };
}

function mergeIntervals(intervals = []) {
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
      continue;
    }
    last.end = Math.max(last.end, interval.end);
    last.weight = Math.max(last.weight || 0, interval.weight || 0);
    last.ids = [...(last.ids || []), ...(interval.ids || [])];
  }
  return merged;
}

function scoreWallAt(lines, orientation, fixedCoord, axisStart, axisEnd, tolerance = 24) {
  const spanLength = Math.max(1, axisEnd - axisStart);
  const intervals = [];
  let strongest = 0;
  for (const line of lines) {
    if (line.orientation !== orientation) {
      continue;
    }
    const span = lineSpan(line);
    const fixedDistance = Math.abs(span.fixed - fixedCoord);
    if (fixedDistance > tolerance) {
      continue;
    }
    const overlapStart = Math.max(axisStart, span.start - tolerance * 0.45);
    const overlapEnd = Math.min(axisEnd, span.end + tolerance * 0.45);
    if (overlapEnd <= overlapStart) {
      continue;
    }
    const sourceWeight = line.source === 'morphology-wall-band'
      ? 1
      : (line.source === 'wall-grid-support-line' || line.source === 'ml-wall-grid-support-line')
        ? 0.96
        : 0.68;
    const confidenceWeight = Math.max(0.45, Math.min(1, toNumber(line.confidence, 0.62)));
    const distanceWeight = Math.max(0.25, 1 - fixedDistance / (tolerance + 1));
    const weight = sourceWeight * confidenceWeight * distanceWeight;
    strongest = Math.max(strongest, weight);
    intervals.push({
      start: overlapStart,
      end: overlapEnd,
      weight,
      ids: [line.id].filter(Boolean)
    });
  }

  const merged = mergeIntervals(intervals);
  const covered = merged.reduce((sum, interval) => sum + (interval.end - interval.start) * Math.max(0.35, interval.weight || 0), 0);
  const coverage = Math.max(0, Math.min(1, covered / spanLength));
  return {
    coverage,
    strongest,
    score: Number(Math.max(coverage, strongest * 0.45).toFixed(3)),
    wallIds: [...new Set(merged.flatMap((interval) => interval.ids || []))]
  };
}

function findWallAt(lines, orientation, fixedCoord, axisStart, axisEnd, tolerance = 18) {
  return lines.find((line) => {
    if (line.orientation !== orientation) {
      return false;
    }
    const fixed = orientation === 'horizontal'
      ? (toNumber(line.start?.y) + toNumber(line.end?.y)) / 2
      : (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2;
    return Math.abs(fixed - fixedCoord) <= tolerance && lineCoversSpan(line, axisStart, axisEnd, tolerance);
  });
}

function isRoomCandidateContained(inner, outer, tolerance = 8) {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function overlapsRoom(a, b) {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlapArea = xOverlap * yOverlap;
  const smallerArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return overlapArea / smallerArea;
}

function roomNeedsSemanticOrBoundaryReview(room = {}) {
  return Boolean(
    room.semanticNeedsReview
    || room.boundaryNeedsReview
    || room.sourceEvidence?.semanticNeedsReview
    || room.sourceEvidence?.boundaryNeedsReview
  );
}

function isWallMaskInteriorRoom(room = {}) {
  return room.source === 'opencv-wall-mask-room-interior'
    || room.source === 'ml-wall-mask-room-interior'
    || room.sourceEvidence?.source === 'wall-mask-grid-room'
    || room.sourceEvidence?.source === 'wall-mask-room-interior'
    || room.sourceEvidence?.source === 'ml-wall-mask-room-interior';
}

function selectRoomCandidates(candidates = [], maxRooms = 12) {
  const ordered = [...candidates].sort((a, b) => {
    const aMask = isWallMaskInteriorRoom(a);
    const bMask = isWallMaskInteriorRoom(b);
    if (aMask && bMask) {
      const perimeterDelta = toNumber(b.sourceEvidence?.perimeterWallScore) - toNumber(a.sourceEvidence?.perimeterWallScore);
      if (Math.abs(perimeterDelta) > 0.05) {
        return perimeterDelta;
      }
      const confidenceDelta = toNumber(b.confidence) - toNumber(a.confidence);
      if (Math.abs(confidenceDelta) > 0.03) {
        return confidenceDelta;
      }
      const aStrip = Math.min(a.width, a.height) < 105 && Math.max(a.width, a.height) / Math.max(1, Math.min(a.width, a.height)) > 3.4;
      const bStrip = Math.min(b.width, b.height) < 105 && Math.max(b.width, b.height) / Math.max(1, Math.min(b.width, b.height)) > 3.4;
      if (aStrip !== bStrip) {
        return aStrip ? 1 : -1;
      }
      return (b.width * b.height) - (a.width * a.height);
    }
    if (aMask !== bMask) {
      const scoreDelta = (b.sourceEvidence?.edgeScore || 0) - (a.sourceEvidence?.edgeScore || 0);
      if (Math.abs(scoreDelta) > 0.08) {
        return scoreDelta;
      }
      return aMask ? -1 : 1;
    }
    const scoreDelta = (b.sourceEvidence?.edgeScore || 0) - (a.sourceEvidence?.edgeScore || 0);
    if (Math.abs(scoreDelta) > 0.04) {
      return scoreDelta;
    }
    return (a.width * a.height) - (b.width * b.height);
  });

  const selected = [];
  for (const candidate of ordered) {
    if (selected.some((room) => overlapsRoom(candidate, room) > (isWallMaskInteriorRoom(candidate) || isWallMaskInteriorRoom(room) ? 0.58 : 0.82))) {
      continue;
    }
    if (selected.some((room) => isRoomCandidateContained(candidate, room) && (room.sourceEvidence?.edgeScore || 0) >= (candidate.sourceEvidence?.edgeScore || 0) + 0.12)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxRooms) {
      break;
    }
  }

  return selected
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((room, index) => ({
      ...room,
      id: `grid-room-${index + 1}`,
      name: `候选空间 ${index + 1}`
    }));
}

function buildRoomCandidateFromGridCell({ x1, x2, y1, y2, lines, candidates }) {
  const width = x2 - x1;
  const height = y2 - y1;
  const area = width * height;
  const top = scoreWallAt(lines, 'horizontal', y1, x1, x2);
  const bottom = scoreWallAt(lines, 'horizontal', y2, x1, x2);
  const left = scoreWallAt(lines, 'vertical', x1, y1, y2);
  const right = scoreWallAt(lines, 'vertical', x2, y1, y2);
  const edgeScores = [top, bottom, left, right].map((edge) => edge.score);
  const strongEdges = edgeScores.filter((score) => score >= 0.55).length;
  const weakEdges = edgeScores.filter((score) => score >= 0.34).length;
  const edgeScore = edgeScores.reduce((sum, score) => sum + score, 0) / 4;
  const minEdge = Math.min(...edgeScores);
  const fromMl = lines.some((line) => line.source === 'ml-wall-grid-support-line');

  return {
    id: `grid-room-${candidates.length + 1}`,
    name: `候选空间 ${candidates.length + 1}`,
    type: 'space',
    area: Math.max(4, Math.round(area / 5200)),
    x: x1,
    y: y1,
    width,
    height,
    confidence: Number(Math.min(0.84, 0.45 + edgeScore * 0.42 + strongEdges * 0.025).toFixed(2)),
    source: fromMl ? 'ml-wall-grid' : 'opencv-wall-grid',
    sourceEvidence: {
      closedEdges: strongEdges,
      weakEdges,
      edgeScore: Number(edgeScore.toFixed(3)),
      minEdge: Number(minEdge.toFixed(3)),
      edgeScores: edgeScores.map((score) => Number(score.toFixed(3))),
      wallIds: [...new Set([top, bottom, left, right].flatMap((edge) => edge.wallIds || []))],
      mlDerived: fromMl
    }
  };
}

function pruneGeometryRoomsByLayout(rooms = [], job) {
  const target = expectedRoomTarget(job);
  if (!target || rooms.length <= target + 1) {
    return rooms;
  }

  const minArea = Math.max(2400, rooms.reduce((sum, room) => sum + room.width * room.height, 0) / rooms.length * 0.3);
  const ranked = rooms.map((room) => {
    const pixelArea = room.width * room.height;
    const shortSide = Math.min(room.width, room.height);
    const longSide = Math.max(room.width, room.height);
    const edgeScore = room.sourceEvidence?.edgeScore || 0;
    const stripPenalty = shortSide < 58 ? 0.22 : shortSide < 72 && longSide > shortSide * 4 ? 0.14 : 0;
    const smallPenalty = pixelArea < minArea ? 0.12 : 0;
    const score = edgeScore + Math.min(0.18, pixelArea / 240000) - stripPenalty - smallPenalty;
    return { room, score };
  }).sort((a, b) => b.score - a.score);

  const keepCount = Math.min(rooms.length, Math.max(target, target + 1));
  return ranked
    .slice(0, keepCount)
    .map((item) => item.room)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((room, index) => ({
      ...room,
      id: `grid-room-${index + 1}`,
      name: `候选空间 ${index + 1}`,
      sourceEvidence: {
        ...(room.sourceEvidence || {}),
        layoutPruned: true,
        expectedRoomTarget: target
      }
    }));
}

function buildRoomsFromWallMaskInteriors(preprocessing = {}) {
  const mlInteriors = preprocessing?.geometryCandidates?.mlRoomInteriorCandidates || [];
  const opencvInteriors = preprocessing?.geometryCandidates?.roomInteriorCandidates || [];
  const interiors = mlInteriors.length >= 2 ? mlInteriors : opencvInteriors;
  const fromMl = mlInteriors.length >= 2;
  const imageArea = toNumber(preprocessing?.image?.width) * toNumber(preprocessing?.image?.height);
  return interiors
    .map((candidate, index) => {
      const x = Math.round(toNumber(candidate.x));
      const y = Math.round(toNumber(candidate.y));
      const width = Math.round(toNumber(candidate.width));
      const height = Math.round(toNumber(candidate.height));
      const area = width * height;
      if (width < 42 || height < 42 || area < 2200) {
        return null;
      }
      if (imageArea && area > imageArea * 0.42) {
        return null;
      }
      const perimeterWallScore = toNumber(candidate.perimeterWallScore, fromMl ? 0.45 : 0);
      const fillRatio = toNumber(candidate.fillRatio, 0);
      const reportedStrongEdges = toNumber(candidate.strongEdges, 0);
      const edgeScore = Math.max(0.38, Math.min(0.9, 0.3 + perimeterWallScore * 0.56 + fillRatio * 0.08 + reportedStrongEdges * 0.025));
      const closedEdges = reportedStrongEdges || (edgeScore >= 0.7 ? 4 : edgeScore >= 0.58 ? 3 : 2);
      const roomSource = fromMl ? 'ml-wall-mask-room-interior' : 'opencv-wall-mask-room-interior';
      return {
        id: `mask-room-${index + 1}`,
        name: `候选空间 ${index + 1}`,
        type: 'space',
        area: Math.max(4, Math.round(area / 5200)),
        x,
        y,
        width,
        height,
        confidence: Number(Math.min(0.86, toNumber(candidate.confidence, 0.62) + (fromMl ? 0.06 : 0.03)).toFixed(2)),
        source: roomSource,
        sourceEvidence: {
          closedEdges,
          weakEdges: Math.max(3, closedEdges),
          edgeScore: Number(edgeScore.toFixed(3)),
          minEdge: Number(Math.max(0.24, edgeScore - 0.18).toFixed(3)),
          edgeScores: [edgeScore, edgeScore, edgeScore, edgeScore].map((score) => Number(score.toFixed(3))),
          fillRatio: Number(fillRatio.toFixed(3)),
          perimeterWallScore: Number(perimeterWallScore.toFixed(3)),
          roomInteriorCandidateId: candidate.id,
          source: candidate.source || (fromMl ? 'ml-wall-mask-room-interior' : 'wall-mask-room-interior'),
          mlDerived: fromMl
        }
      };
    })
    .filter(Boolean);
}

function buildRoomsFromWallGrid(preprocessing = {}) {
  const lines = (preprocessing?.geometryCandidates?.lines || [])
    .filter((line) => line.source !== 'annotation-line-candidate')
    .filter((line) => (
      line.source === 'morphology-wall-band'
      || line.source === 'wall-grid-support-line'
      || line.source === 'ml-wall-grid-support-line'
      || line.source === 'hough-edge'
    ))
    .filter((line) => line.orientation === 'horizontal' || line.orientation === 'vertical');
  if (lines.length < 6) {
    return [];
  }

  const gridLines = lines.filter((line) => (
    line.source === 'morphology-wall-band'
    || line.source === 'wall-grid-support-line'
    || line.source === 'ml-wall-grid-support-line'
    || toNumber(line.confidence, 0) >= 0.55
  ));
  const xs = clusterValues(gridLines
    .filter((line) => line.orientation === 'vertical')
    .map((line) => Math.round((toNumber(line.start?.x) + toNumber(line.end?.x)) / 2)));
  const ys = clusterValues(gridLines
    .filter((line) => line.orientation === 'horizontal')
    .map((line) => Math.round((toNumber(line.start?.y) + toNumber(line.end?.y)) / 2)));

  if (xs.length < 2 || ys.length < 2) {
    return [];
  }

  const imageArea = toNumber(preprocessing?.image?.width) * toNumber(preprocessing?.image?.height);
  const candidates = [];
  const recoveryCandidates = [];
  const maxGridStep = Math.min(6, Math.max(2, Math.ceil(Math.max(xs.length, ys.length) / 4)));
  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let yi = 0; yi < ys.length - 1; yi += 1) {
      for (let xj = xi + 1; xj < Math.min(xs.length, xi + maxGridStep + 1); xj += 1) {
        for (let yj = yi + 1; yj < Math.min(ys.length, yi + maxGridStep + 1); yj += 1) {
      const x1 = xs[xi];
      const x2 = xs[xj];
      const y1 = ys[yi];
      const y2 = ys[yj];
      const width = x2 - x1;
      const height = y2 - y1;
      const area = width * height;
      if (width < 45 || height < 45 || area < 2600) {
        continue;
      }
      const isAdjacentCell = xj === xi + 1 && yj === yi + 1;
      if (imageArea && area > imageArea * (isAdjacentCell ? 0.55 : 0.42)) {
        continue;
      }

      const candidate = buildRoomCandidateFromGridCell({ x1, x2, y1, y2, lines, candidates });
      const { strongEdges, weakEdges, edgeScore } = {
        strongEdges: candidate.sourceEvidence.closedEdges,
        weakEdges: candidate.sourceEvidence.weakEdges,
        edgeScore: candidate.sourceEvidence.edgeScore
      };
      if (weakEdges >= 3 && edgeScore >= 0.42) {
        recoveryCandidates.push({
          ...candidate,
          sourceEvidence: {
            ...(candidate.sourceEvidence || {}),
            gridSpan: { x: xj - xi, y: yj - yi },
            recoveryCandidateOnly: true
          }
        });
      }
      if (strongEdges < 3 && !(weakEdges === 4 && edgeScore >= 0.48)) {
        continue;
      }
      if (!isAdjacentCell && edgeScore < 0.56) {
        continue;
      }

      candidates.push({
        ...candidate,
        sourceEvidence: {
          ...(candidate.sourceEvidence || {}),
          gridSpan: { x: xj - xi, y: yj - yi }
        }
      });
    }
  }
    }
  }

  const filteredCandidates = candidates.filter((candidate) => !isJunkGridCell(candidate, preprocessing));
  const maskRooms = buildRoomsFromWallMaskInteriors(preprocessing).filter((room) => !isJunkGridCell(room, preprocessing));
  const maxRooms = isMlGridActive(preprocessing) ? 16 : 12;
  const selected = selectRoomCandidates([...maskRooms, ...filteredCandidates], maxRooms);
  selected.allGridCandidates = [...maskRooms, ...recoveryCandidates, ...filteredCandidates];
  return selected;
}

function roomCenter(room) {
  return {
    x: toNumber(room.x) + toNumber(room.width) / 2,
    y: toNumber(room.y) + toNumber(room.height) / 2
  };
}

function roomPixelArea(room = {}) {
  return Math.max(1, toNumber(room.width) * toNumber(room.height));
}

function normalizedRoomArea(room = {}, maxArea = 1) {
  return roomPixelArea(room) / Math.max(1, maxArea);
}

function assignSemanticsByTemplate(geometryRooms = [], templateRooms = [], options = {}) {
  const {
    maxDistanceRatio = 0.28,
    source = 'opencv-wall-grid-with-template-semantics',
    confidenceCap = 0.82,
    confidenceBoost = 0.08,
    scoreLimit = 0.92,
    areaWeight = 0.62,
    includeTemplateBounds = false,
    needsReview = false
  } = options;

  if (!geometryRooms.length || templateRooms.length < 4) {
    return geometryRooms;
  }

  const usedTemplates = new Set(geometryRooms
    .map((room) => room.sourceEvidence?.semanticTemplateRoomId)
    .filter(Boolean));
  const protectedTemplateNames = new Set(geometryRooms
    .filter((room) => room.source === 'opencv-wall-grid-with-ocr-semantics')
    .map((room) => room.name)
    .filter(Boolean));
  const bounds = getGeometryBounds({
    geometryCandidates: {
      contours: includeTemplateBounds ? [...geometryRooms, ...templateRooms] : geometryRooms
    }
  });
  const maxDistance = Math.hypot(bounds.width, bounds.height) * maxDistanceRatio;
  const assignableRooms = geometryRooms.filter((room) => !(room.type && room.type !== 'space' && !/^候选空间/.test(String(room.name || ''))));
  const geometryMaxArea = Math.max(1, ...assignableRooms.map(roomPixelArea));
  const templateMaxArea = Math.max(1, ...templateRooms.map((room) => toNumber(room.area, 1)));
  const candidates = [];

  for (const room of assignableRooms) {
    const center = roomCenter(room);
    const roomAreaRatio = normalizedRoomArea(room, geometryMaxArea);
    for (const template of templateRooms) {
      if (usedTemplates.has(template.id) || protectedTemplateNames.has(template.name)) {
        continue;
      }
      const templateCenter = roomCenter(template);
      const distance = Math.hypot(center.x - templateCenter.x, center.y - templateCenter.y);
      if (distance > maxDistance) {
        continue;
      }

      const templateAreaRatio = toNumber(template.area, 1) / templateMaxArea;
      const areaDelta = Math.abs(roomAreaRatio - templateAreaRatio);
      const aspect = toNumber(room.width) / Math.max(1, toNumber(room.height));
      const stripPenalty = Math.min(toNumber(room.width), toNumber(room.height)) < 64 && ['living', 'bedroom', 'kitchen'].includes(template.type)
        ? 0.18
        : 0;
      const edgeBonus = Math.min(0.12, toNumber(room.sourceEvidence?.edgeScore, 0) * 0.12);
      const compactAspectPenalty = ['bathroom', 'kitchen', 'entry'].includes(template.type) && (aspect > 2.4 || aspect < 0.35)
        ? 0.7
        : 0;
      const bedroomAspectPenalty = template.type === 'bedroom' && aspect > 4.4 ? 0.16 : 0;
      const livingAspectPenalty = template.type === 'living' && aspect < 1.18 ? 0.08 : 0;
      const aspectPenalty = compactAspectPenalty + bedroomAspectPenalty + livingAspectPenalty;
      const score = distance / Math.max(maxDistance, 1)
        + areaDelta * areaWeight
        + stripPenalty
        + aspectPenalty
        - edgeBonus;
      candidates.push({
        room,
        template,
        distance,
        score
      });
    }
  }

  const roomToTemplate = new Map();
  const claimedTemplates = new Set(usedTemplates);
  for (const candidate of candidates.sort((a, b) => a.score - b.score)) {
    if (candidate.score > scoreLimit || roomToTemplate.has(candidate.room.id) || claimedTemplates.has(candidate.template.id)) {
      continue;
    }
    roomToTemplate.set(candidate.room.id, candidate);
    claimedTemplates.add(candidate.template.id);
  }

  return geometryRooms.map((room) => {
    if (room.type && room.type !== 'space' && !/^候选空间/.test(String(room.name || ''))) {
      return room;
    }

    const best = roomToTemplate.get(room.id);
    if (!best) {
      return room;
    }

    return {
      ...room,
      name: best.template.name,
      type: best.template.type,
      confidence: Number(Math.min(confidenceCap, Math.max(toNumber(room.confidence, 0.64), toNumber(room.confidence, 0.64) + confidenceBoost)).toFixed(2)),
      source,
      sourceEvidence: {
        ...(room.sourceEvidence || {}),
        semanticTemplateRoomId: best.template.id,
        semanticTemplateDistance: Number(best.distance.toFixed(1)),
        semanticTemplateScore: Number(best.score.toFixed(3)),
        ...(needsReview ? { semanticNeedsReview: true } : {})
      }
    };
  });
}

function assignTemplateSemantics(geometryRooms = [], templateRooms = []) {
  return assignSemanticsByTemplate(geometryRooms, templateRooms, {
    maxDistanceRatio: 0.28,
    source: 'opencv-wall-grid-with-template-semantics',
    confidenceCap: 0.82,
    confidenceBoost: 0.08,
    scoreLimit: 0.9,
    areaWeight: 0.62,
    includeTemplateBounds: false,
    needsReview: false
  });
}

function assignReviewSemantics(geometryRooms = [], templateRooms = []) {
  return assignSemanticsByTemplate(geometryRooms, templateRooms, {
    maxDistanceRatio: 0.42,
    source: 'opencv-wall-grid-with-review-semantics',
    confidenceCap: 0.76,
    confidenceBoost: 0,
    scoreLimit: 1.45,
    areaWeight: 0.42,
    includeTemplateBounds: true,
    needsReview: true
  });
}

function supplementRoomsWithOcrLabels(geometryRooms = [], templateRooms = [], ocrCandidates = [], job) {
  const target = expectedRoomTarget(job);
  const labels = ocrCandidates
    .map(normalizeOcrCandidate)
    .filter((label) => label && label.type !== 'space');
  if (!labels.length || !templateRooms.length) {
    return geometryRooms;
  }

  const existingNames = new Set(geometryRooms.map((room) => room.name).filter(Boolean));
  const existingLabelTexts = new Set(geometryRooms
    .map((room) => room.sourceEvidence?.ocrText)
    .filter(Boolean));
  const usedTemplates = new Set(geometryRooms
    .map((room) => room.sourceEvidence?.semanticTemplateRoomId)
    .filter(Boolean));
  const supplemented = [...geometryRooms];
  const maxRooms = Math.min(12, Math.max(target || 0, geometryRooms.length + labels.length));
  const bounds = getGeometryBounds({ geometryCandidates: { contours: [...geometryRooms, ...templateRooms] } });
  const maxRelabelDistance = Math.hypot(bounds.width, bounds.height) * 0.34;

  for (const label of labels) {
    if (existingLabelTexts.has(label.text) || existingNames.has(label.text)) {
      continue;
    }
    if (supplemented.length >= maxRooms) {
      break;
    }

    let relabelCandidate = null;
    for (const room of supplemented) {
      if (room.sourceEvidence?.ocrText || room.type !== label.type || room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview) {
        continue;
      }
      const center = roomCenter(room);
      const distance = Math.hypot(center.x - label.center.x, center.y - label.center.y);
      if (distance > maxRelabelDistance) {
        continue;
      }
      if (!relabelCandidate || distance < relabelCandidate.distance) {
        relabelCandidate = { room, distance };
      }
    }

    if (relabelCandidate) {
      const index = supplemented.findIndex((room) => room.id === relabelCandidate.room.id);
      supplemented[index] = {
        ...supplemented[index],
        name: label.text,
        type: label.type,
        confidence: Number(Math.min(0.9, Math.max(toNumber(supplemented[index].confidence, 0.7), label.confidence)).toFixed(2)),
        source: 'opencv-wall-grid-with-ocr-semantics',
        sourceEvidence: {
          ...(supplemented[index].sourceEvidence || {}),
          ocrText: label.text,
          ocrSource: label.source,
          ocrDistance: Number(relabelCandidate.distance.toFixed(1)),
          ocrRelabeledSameTypeRoom: true
        }
      };
      existingNames.add(label.text);
      existingLabelTexts.add(label.text);
      continue;
    }

    let best = null;
    for (const template of templateRooms) {
      if (usedTemplates.has(template.id)) {
        continue;
      }
      const templateType = template.type || inferRoomType(template.name);
      if (template.name !== label.text && templateType !== label.type) {
        continue;
      }
      const center = roomCenter(template);
      const distance = Math.hypot(center.x - label.center.x, center.y - label.center.y);
      if (!best || distance < best.distance) {
        best = { template, distance };
      }
    }

    if (!best) {
      continue;
    }

    usedTemplates.add(best.template.id);
    existingNames.add(label.text);
    existingLabelTexts.add(label.text);
    supplemented.push({
      ...best.template,
      id: `ocr-supplemental-${best.template.id || supplemented.length + 1}`,
      name: label.text,
      type: label.type,
      confidence: Number(Math.min(0.76, Math.max(0.68, label.confidence - 0.08)).toFixed(2)),
      source: 'ocr-label-supplemental',
      semanticNeedsReview: true,
      boundaryNeedsReview: true,
      boundaryReviewReason: 'ocr-label-without-stable-geometry-room',
      sourceEvidence: {
        ...(best.template.sourceEvidence || {}),
        ocrText: label.text,
        ocrSource: label.source,
        ocrSupplementedBecause: 'label-without-stable-geometry-room',
        semanticTemplateRoomId: best.template.id,
        semanticTemplateDistance: Number(best.distance.toFixed(1)),
        semanticNeedsReview: true,
        boundaryNeedsReview: true,
        boundaryReviewReason: 'ocr-label-without-stable-geometry-room'
      }
    });
  }

  return supplemented
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((room, index) => ({
      ...room,
      outputOrder: index + 1
    }));
}

function recoverCriticalTemplateRoomsFromGrid(geometryRooms = [], templateRooms = [], gridCandidates = [], job) {
  const target = expectedRoomTarget(job);
  if (!target || !geometryRooms.length || !gridCandidates.length || !templateRooms.length) {
    return geometryRooms;
  }

  const usedTemplateIds = new Set(geometryRooms
    .map((room) => room.sourceEvidence?.semanticTemplateRoomId)
    .filter(Boolean));
  const existingNames = new Set(geometryRooms.map((room) => room.name).filter(Boolean));
  const recovered = [...geometryRooms];
  const bounds = getGeometryBounds({ geometryCandidates: { contours: [...geometryRooms, ...templateRooms] } });
  const maxDistance = Math.hypot(bounds.width, bounds.height) * 0.32;

  function scoreGridCandidateForTemplate(candidate, template, options = {}) {
    const templateCenter = roomCenter(template);
    const center = roomCenter(candidate);
    const distance = Math.hypot(center.x - templateCenter.x, center.y - templateCenter.y);
    if (distance > maxDistance) {
      return null;
    }
    const edgeScore = toNumber(candidate.sourceEvidence?.edgeScore, 0);
    const weakEdges = toNumber(candidate.sourceEvidence?.weakEdges, 0);
    const pixelArea = roomPixelArea(candidate);
    const areaRatio = pixelArea / Math.max(1, roomPixelArea(template));
    const minAreaRatio = options.minAreaRatio ?? 0.08;
    const maxAreaRatio = options.maxAreaRatio ?? 1.7;
    const minEdgeScore = options.minEdgeScore ?? 0.46;
    const minWeakEdges = options.minWeakEdges ?? 3;
    if (weakEdges < minWeakEdges || edgeScore < minEdgeScore || areaRatio < minAreaRatio || areaRatio > maxAreaRatio) {
      return null;
    }

    const minDimension = Math.min(toNumber(candidate.width), toNumber(candidate.height));
    const aspect = Math.max(toNumber(candidate.width), toNumber(candidate.height)) / Math.max(1, minDimension);
    if (options.maxAspect && aspect > options.maxAspect) {
      return null;
    }
    if (options.minDimension && minDimension < options.minDimension) {
      return null;
    }

    const score = distance / Math.max(maxDistance, 1)
      + Math.abs(1 - Math.min(1.6, areaRatio)) * 0.2
      + Math.max(0, aspect - 3.4) * 0.04
      - edgeScore * 0.18;
    return { candidate, distance, score, areaRatio, edgeScore, weakEdges, aspect, minDimension };
  }

  function bestGridCandidateForTemplate(template, options = {}) {
    let best = null;
    for (const candidate of gridCandidates) {
      if (recovered.some((room, index) => index !== options.replaceIndex && overlapsRoom(candidate, room) > 0.5)) {
        continue;
      }
      const scored = scoreGridCandidateForTemplate(candidate, template, options);
      if (scored && (!best || scored.score < best.score)) {
        best = scored;
      }
    }
    return best;
  }

  for (const template of templateRooms) {
    const isKitchenRecovery = template.id === 'kitchen';
    if (!isKitchenRecovery || usedTemplateIds.has(template.id) || existingNames.has(template.name)) {
      continue;
    }

    const best = bestGridCandidateForTemplate(template);
    if (!best) {
      continue;
    }
    recovered.push({
      ...best.candidate,
      id: `grid-recovered-${template.id}`,
      name: template.name,
      type: template.type,
      confidence: Number(Math.min(0.78, Math.max(toNumber(best.candidate.confidence, 0.66), 0.7)).toFixed(2)),
      source: 'opencv-wall-grid-template-recovered',
      sourceEvidence: {
        ...(best.candidate.sourceEvidence || {}),
        semanticTemplateRoomId: template.id,
        semanticTemplateDistance: Number(best.distance.toFixed(1)),
        semanticTemplateScore: Number(best.score.toFixed(3)),
        recoveredBecause: 'critical-template-near-wall-grid-candidate',
        semanticNeedsReview: true
      }
    });
    usedTemplateIds.add(template.id);
    existingNames.add(template.name);
  }

  for (const template of templateRooms) {
    if (template.type !== 'bedroom' || !usedTemplateIds.has(template.id)) {
      continue;
    }

    const existingIndex = recovered.findIndex((room) => room.sourceEvidence?.semanticTemplateRoomId === template.id);
    const existing = existingIndex >= 0 ? recovered[existingIndex] : null;
    if (!existing || existing.source === 'opencv-wall-grid-with-ocr-semantics') {
      continue;
    }

    const minDimension = Math.min(toNumber(existing.width), toNumber(existing.height));
    const aspect = Math.max(toNumber(existing.width), toNumber(existing.height)) / Math.max(1, minDimension);
    const existingCenter = roomCenter(existing);
    const templateCenter = roomCenter(template);
    const existingDistance = Math.hypot(existingCenter.x - templateCenter.x, existingCenter.y - templateCenter.y);
    const shouldReplace = existing.sourceEvidence?.semanticNeedsReview
      && (minDimension < 90 || aspect > 3.2 || existingDistance > Math.hypot(bounds.width, bounds.height) * 0.24);
    if (!shouldReplace) {
      continue;
    }

    const best = bestGridCandidateForTemplate(template, {
      replaceIndex: existingIndex,
      minEdgeScore: 0.42,
      minWeakEdges: 3,
      minAreaRatio: 0.12,
      maxAreaRatio: 2.1,
      minDimension: 90,
      maxAspect: 3.6
    });
    if (!best || best.distance >= existingDistance * 0.92 || roomPixelArea(best.candidate) <= roomPixelArea(existing) * 1.6) {
      continue;
    }

    recovered[existingIndex] = {
      ...best.candidate,
      id: existing.id,
      name: template.name,
      type: template.type,
      confidence: Number(Math.min(0.82, Math.max(toNumber(best.candidate.confidence, 0.66), 0.74)).toFixed(2)),
      source: 'opencv-wall-grid-template-recovered',
      sourceEvidence: {
        ...(best.candidate.sourceEvidence || {}),
        semanticTemplateRoomId: template.id,
        semanticTemplateDistance: Number(best.distance.toFixed(1)),
        semanticTemplateScore: Number(best.score.toFixed(3)),
        recoveredBecause: 'template-replaced-strip-room-boundary',
        replacedRoomBounds: {
          x: existing.x,
          y: existing.y,
          width: existing.width,
          height: existing.height
        },
        semanticNeedsReview: true
      }
    };
  }

  return recovered
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((room, index) => ({
      ...room,
      outputOrder: index + 1
    }));
}

function recoverOcrLabeledRoomsFromGrid(geometryRooms = [], ocrCandidates = [], gridCandidates = []) {
  const labels = ocrCandidates
    .map(normalizeOcrCandidate)
    .filter((label) => label && label.type !== 'space');
  if (!labels.length || !geometryRooms.length || !gridCandidates.length) {
    return geometryRooms;
  }

  const recovered = [...geometryRooms];
  for (const label of labels) {
    const existingIndex = recovered.findIndex((room) => room.name === label.text || room.sourceEvidence?.ocrText === label.text);
    const existing = existingIndex >= 0 ? recovered[existingIndex] : null;
    const existingCenter = existing ? roomCenter(existing) : null;
    const existingDistance = existingCenter
      ? Math.hypot(existingCenter.x - label.center.x, existingCenter.y - label.center.y)
      : Infinity;
    if (existing && (roomContainsPoint(existing, label.center, 24) || existingDistance <= Math.hypot(toNumber(existing.width), toNumber(existing.height)) * 0.85)) {
      if (!existing.sourceEvidence?.ocrText) {
        const { semanticNeedsReview, ...roomWithoutSemanticReview } = existing;
        const { semanticNeedsReview: evidenceSemanticNeedsReview, ...sourceEvidence } = existing.sourceEvidence || {};
        recovered[existingIndex] = {
          ...roomWithoutSemanticReview,
          name: label.text,
          type: label.type,
          confidence: Number(Math.min(0.9, Math.max(toNumber(existing.confidence, 0.7), label.confidence)).toFixed(2)),
          source: 'opencv-wall-grid-with-ocr-semantics',
          sourceEvidence: {
            ...sourceEvidence,
            ocrText: label.text,
            ocrSource: label.source,
            ocrDistance: Number(existingDistance.toFixed(1)),
            ocrInsideRoom: roomContainsPoint(existing, label.center, 24),
            ocrConfirmedExistingRoom: true
          }
        };
      }
      continue;
    }

    let best = null;
    for (const candidate of gridCandidates) {
      if (candidate.type && candidate.type !== 'space') {
        continue;
      }
      const labelInside = roomContainsPoint(candidate, label.center, 28);
      const center = roomCenter(candidate);
      const distance = Math.hypot(center.x - label.center.x, center.y - label.center.y);
      const maxDistance = Math.hypot(toNumber(candidate.width), toNumber(candidate.height)) * 0.82;
      if (!labelInside && distance > maxDistance) {
        continue;
      }
      const edgeScore = toNumber(candidate.sourceEvidence?.edgeScore, 0);
      const weakEdges = toNumber(candidate.sourceEvidence?.weakEdges, 0);
      if (weakEdges < 3 || edgeScore < 0.42) {
        continue;
      }
      const overlapsOther = recovered.some((room, index) => index !== existingIndex && overlapsRoom(candidate, room) > 0.58);
      if (overlapsOther) {
        continue;
      }
      const score = (labelInside ? -0.35 : 0)
        + distance / Math.max(maxDistance, 1)
        - edgeScore * 0.2;
      if (!best || score < best.score) {
        best = { candidate, distance, labelInside, score };
      }
    }

    if (!best) {
      continue;
    }

    const recoveredRoom = {
      ...best.candidate,
      id: existing?.id || `grid-ocr-recovered-${label.text}`,
      name: label.text,
      type: label.type,
      confidence: Number(Math.min(0.9, Math.max(toNumber(best.candidate.confidence, 0.66), label.confidence)).toFixed(2)),
      source: 'opencv-wall-grid-with-ocr-semantics',
      sourceEvidence: {
        ...(best.candidate.sourceEvidence || {}),
        ocrText: label.text,
        ocrSource: label.source,
        ocrDistance: Number(best.distance.toFixed(1)),
        ocrInsideRoom: best.labelInside,
        recoveredBecause: existing ? 'ocr-label-replaced-distant-room-boundary' : 'ocr-label-near-wall-grid-candidate'
      }
    };

    if (existingIndex >= 0) {
      recovered[existingIndex] = recoveredRoom;
    } else {
      recovered.push(recoveredRoom);
    }
  }

  return recovered
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((room, index) => ({
      ...room,
      outputOrder: index + 1
    }));
}

function supplementBalconyCandidates(rooms = [], preprocessing = {}) {
  const candidates = preprocessing?.geometryCandidates?.balconyCandidates || [];
  if (!candidates.length) {
    return rooms;
  }

  const imageArea = toNumber(preprocessing?.image?.width) * toNumber(preprocessing?.image?.height);
  const imageWidth = toNumber(preprocessing?.image?.width);
  const ranked = candidates
    .filter((candidate) => toNumber(candidate.confidence, 0) >= 0.7)
    .filter((candidate) => candidate.nearStructuralWall || candidate.nearImageEdge)
    .filter((candidate) => {
      const areaRatio = toNumber(candidate.area) / Math.max(1, imageArea);
      return areaRatio >= 0.012 && areaRatio <= 0.055;
    })
    .filter((candidate) => !rooms.some((room) => (
      room.type !== 'balcony'
      && !roomNeedsSemanticOrBoundaryReview(room)
      && overlapsRoom(candidate, room) > 0.42
    )))
    .sort((a, b) => {
      const leftBiasA = toNumber(a.x) < imageWidth * 0.35 ? 0.08 : 0;
      const leftBiasB = toNumber(b.x) < imageWidth * 0.35 ? 0.08 : 0;
      return (toNumber(b.confidence) + leftBiasB) - (toNumber(a.confidence) + leftBiasA);
    });

  const best = ranked[0];
  if (!best) {
    return rooms;
  }

  const hasReliableVisualBalcony = rooms.some((room) => (
    room.type === 'balcony'
    && !room.sourceEvidence?.semanticNeedsReview
    && toNumber(room.confidence, 0) >= 0.74
    && candidates.some((candidate) => overlapsRoom(candidate, room) >= 0.55)
  ));
  if (hasReliableVisualBalcony) {
    return rooms;
  }

  const replacedSemanticBalconies = rooms
    .filter((room) => (
      room.type === 'balcony'
      && !room.sourceEvidence?.balconyCandidateId
      && candidates.every((candidate) => overlapsRoom(candidate, room) < 0.55)
    ))
    .map((room) => room.id)
    .filter(Boolean);
  const hasConfirmedOutlineClosure = Boolean(
    best.outlineCorrection?.source === 'long-vertical-balcony-outline'
    && best.outlineCorrection?.supportingHorizontalLineId
    && best.nearStructuralWall
    && toNumber(best.confidence, 0) >= 0.8
    && toNumber(best.lineDensity, 0) >= 0.15
  );

  const withoutWeakBalcony = rooms.filter((room) => {
    if (
      room.type === 'balcony'
      && (
        room.sourceEvidence?.semanticNeedsReview
        || toNumber(room.confidence, 0) < 0.74
        || (!room.sourceEvidence?.balconyCandidateId && candidates.every((candidate) => overlapsRoom(candidate, room) < 0.55))
      )
    ) {
      return false;
    }

    const replaceableOverlap = room.type !== 'balcony'
      && roomNeedsSemanticOrBoundaryReview(room)
      && ['living', 'dining', 'entry', 'space'].includes(room.type || 'space')
      && overlapsRoom(best, room) > 0.62
      && toNumber(best.area) <= roomPixelArea(room) * 1.18;

    return !replaceableOverlap;
  });
  return [
    ...withoutWeakBalcony,
    {
      id: 'thin-outline-balcony',
      name: '阳台',
      type: 'balcony',
      area: Math.max(4, Math.round(toNumber(best.area) / 5200)),
      x: toNumber(best.x),
      y: toNumber(best.y),
      width: toNumber(best.width),
      height: toNumber(best.height),
      confidence: Number(Math.min(0.82, toNumber(best.confidence, 0.74)).toFixed(2)),
      source: 'thin-outline-balcony-candidate',
      boundaryNeedsReview: !hasConfirmedOutlineClosure,
      sourceEvidence: {
        balconyCandidateId: best.id,
        replacedSemanticBalconyIds: replacedSemanticBalconies,
        lineDensity: best.lineDensity,
        interiorLineDensity: best.interiorLineDensity,
        nearStructuralWall: best.nearStructuralWall,
        nearImageEdge: best.nearImageEdge,
        semanticNeedsReview: !hasConfirmedOutlineClosure,
        boundaryNeedsReview: !hasConfirmedOutlineClosure,
        boundaryReviewReason: hasConfirmedOutlineClosure
          ? 'confirmed-by-perpendicular-outline-closure'
          : 'thin-outline-balcony-needs-wall-attachment-review',
        semanticConfirmedBy: hasConfirmedOutlineClosure ? 'perpendicular-balcony-outline-closure' : ''
      }
    }
  ].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function findBalconyRoomBoundaryConflicts(rooms = [], preprocessing = {}) {
  const candidates = preprocessing?.geometryCandidates?.balconyCandidates || [];
  return candidates
    .filter((candidate) => candidate.source === 'thin-outline-balcony-candidate')
    .filter((candidate) => toNumber(candidate.confidence, 0) >= 0.78)
    .filter((candidate) => candidate.nearStructuralWall || candidate.nearImageEdge)
    .filter((candidate) => !isMergedBayWindowOutlineCandidate(candidate, preprocessing))
    .filter((candidate) => !rooms.some((room) => room.type === 'balcony' && overlapsRoom(candidate, room) >= 0.55))
    .map((candidate) => {
      const overlappingRooms = rooms
        .filter((room) => room.type !== 'balcony')
        .map((room) => ({
          id: room.id,
          type: room.type,
          name: room.name,
          overlapRatio: Number(overlapsRoom(candidate, room).toFixed(3))
        }))
        .filter((room) => room.overlapRatio >= 0.28)
        .sort((a, b) => b.overlapRatio - a.overlapRatio);

      // 只保留真正侵占边界的房间：强重叠全部保留；否则只盯最高重叠的 1 间
      const strong = overlappingRooms.filter((room) => room.overlapRatio >= 0.42);
      const reviewRooms = strong.length
        ? strong
        : (overlappingRooms[0] ? [overlappingRooms[0]] : []);

      return {
        candidate,
        overlappingRooms: reviewRooms,
        rawOverlapCount: overlappingRooms.length
      };
    })
    .filter((item) => (
      item.overlappingRooms.some((room) => room.overlapRatio >= 0.42)
      || (item.rawOverlapCount >= 2 && item.overlappingRooms[0]?.overlapRatio >= 0.35)
    ));
}

function isMergedBayWindowOutlineCandidate(candidate = {}, preprocessing = {}) {
  const aspectRatio = toNumber(candidate.aspectRatio, toNumber(candidate.width) / Math.max(1, toNumber(candidate.height)));
  const imageWidth = toNumber(preprocessing?.image?.width, 0);
  if (aspectRatio < 2.2 || toNumber(candidate.x) < imageWidth * 0.5) {
    return false;
  }

  const x1 = toNumber(candidate.x);
  const x2 = x1 + toNumber(candidate.width);
  const y1 = toNumber(candidate.y);
  const y2 = y1 + toNumber(candidate.height);
  const outlineXs = (preprocessing?.geometryCandidates?.lines || [])
    .filter((line) => line.orientation === 'vertical')
    .filter((line) => ['hough-edge', 'wall-grid-support-line'].includes(line.source))
    .filter((line) => toNumber(line.length, 0) >= 105)
    .map((line) => ({
      x: (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2,
      y1: Math.min(toNumber(line.start?.y), toNumber(line.end?.y)),
      y2: Math.max(toNumber(line.start?.y), toNumber(line.end?.y))
    }))
    .filter((line) => line.x >= x1 + toNumber(candidate.width) * 0.55 && line.x <= x2 + 20)
    .filter((line) => Math.max(0, Math.min(y2, line.y2) - Math.max(y1, line.y1)) >= 20)
    .map((line) => line.x)
    .sort((a, b) => a - b)
    .filter((x, index, all) => index === 0 || Math.abs(x - all[index - 1]) > 24);

  return outlineXs.length >= 2;
}

function markRoomsWithBalconyBoundaryConflicts(rooms = [], preprocessing = {}) {
  const conflicts = findBalconyRoomBoundaryConflicts(rooms, preprocessing);
  if (!conflicts.length) {
    return rooms;
  }

  // 每个未确认阳台候选只硬标「最高重叠」的一间，其余 typed 房间只记 soft note
  const hardFlagRoomIds = new Set();
  const softByRoomId = new Map();
  for (const conflict of conflicts) {
    const ranked = [...conflict.overlappingRooms].sort((a, b) => b.overlapRatio - a.overlapRatio);
    const primary = ranked[0];
    if (!primary) {
      continue;
    }
    hardFlagRoomIds.add(primary.id);
    for (const room of ranked) {
      const list = softByRoomId.get(room.id) || [];
      list.push({
        balconyCandidateId: conflict.candidate.id,
        x: conflict.candidate.x,
        y: conflict.candidate.y,
        width: conflict.candidate.width,
        height: conflict.candidate.height,
        confidence: conflict.candidate.confidence,
        overlapRatio: room.overlapRatio,
        primaryConflict: room.id === primary.id
      });
      softByRoomId.set(room.id, list);
    }
  }

  return rooms.map((room) => {
    const conflictsForRoom = softByRoomId.get(room.id);
    if (!conflictsForRoom?.length) {
      return room;
    }

    const maxOverlap = Math.max(...conflictsForRoom.map((item) => toNumber(item.overlapRatio)));
    const typedStable = room.type && room.type !== 'space' && !/^候选空间/.test(String(room.name || ''));
    const shouldHardFlag = hardFlagRoomIds.has(room.id)
      && maxOverlap >= 0.42
      && !(typedStable && maxOverlap < 0.62 && toNumber(room.confidence, 0) >= 0.72);

    if (!shouldHardFlag) {
      return {
        ...room,
        sourceEvidence: {
          ...(room.sourceEvidence || {}),
          balconyBoundaryConflicts: conflictsForRoom,
          balconyBoundarySoftNote: 'non-primary-or-typed-light-balcony-overlap'
        }
      };
    }

    return {
      ...room,
      boundaryNeedsReview: true,
      sourceEvidence: {
        ...(room.sourceEvidence || {}),
        boundaryNeedsReview: true,
        boundaryReviewReason: 'overlaps-unconfirmed-balcony-candidate',
        balconyBoundaryConflicts: conflictsForRoom
      }
    };
  });
}

function isResidualUnclassifiedRoom(room = {}) {
  return !room.type || room.type === 'space' || /^候选空间/.test(String(room.name || ''));
}

function classifyResidualCandidateSpaces(rooms = []) {
  return rooms.filter((room) => !isResidualUnclassifiedRoom(room));
}

function stripSemanticReview(room = {}, source) {
  const { semanticNeedsReview, ...roomWithoutReview } = room;
  const { semanticNeedsReview: evidenceSemanticNeedsReview, ...sourceEvidence } = room.sourceEvidence || {};
  const confidenceFloor = source === 'opencv-wall-grid-template-recovered-confirmed' ? 0.8 : 0.78;
  return {
    ...roomWithoutReview,
    confidence: Number(Math.min(0.84, Math.max(toNumber(room.confidence, 0.72), confidenceFloor)).toFixed(2)),
    source,
    sourceEvidence: {
      ...sourceEvidence,
      semanticConfirmedBy: 'layout-geometry-template-evidence'
    }
  };
}

function canConfirmReviewSemantic(room = {}, templateUseCount = new Map()) {
  if (!room.sourceEvidence?.semanticNeedsReview) {
    return false;
  }
  if (room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview) {
    return false;
  }

  const templateId = room.sourceEvidence?.semanticTemplateRoomId || '';
  if (!templateId || templateUseCount.get(templateId) !== 1) {
    return false;
  }

  const edgeScore = toNumber(room.sourceEvidence?.edgeScore, 0);
  const weakEdges = toNumber(room.sourceEvidence?.weakEdges, 0);
  const templateScore = toNumber(room.sourceEvidence?.semanticTemplateScore, 99);
  const minDimension = Math.min(toNumber(room.width), toNumber(room.height));
  const aspect = Math.max(toNumber(room.width), toNumber(room.height)) / Math.max(1, minDimension);

  if (room.source === 'opencv-wall-grid-template-recovered') {
    if (room.type === 'kitchen') {
      return weakEdges >= 4 && edgeScore >= 0.46 && templateScore <= 0.2 && minDimension >= 90;
    }
    if (room.type === 'bedroom') {
      return weakEdges >= 3 && edgeScore >= 0.46 && templateScore <= 0.12 && minDimension >= 90 && aspect <= 3.6;
    }
  }

  if (room.source !== 'opencv-wall-grid-with-review-semantics') {
    return false;
  }

  if (weakEdges < 4 || edgeScore < 0.54 || templateScore > 0.82) {
    return false;
  }

  if (room.type === 'bedroom') {
    return minDimension >= 90 && aspect <= 3.2;
  }
  if (room.type === 'balcony') {
    return minDimension >= 48 && aspect <= 4.2;
  }
  if (room.type === 'entry') {
    return minDimension >= 64 && aspect <= 3.8 && templateScore <= 0.78;
  }
  if (room.type === 'living' || room.type === 'dining') {
    return minDimension >= 56 && aspect <= 5;
  }

  return false;
}

function confirmSemanticsWithLayoutEvidence(rooms = []) {
  const templateUseCount = rooms.reduce((acc, room) => {
    const templateId = room.sourceEvidence?.semanticTemplateRoomId;
    if (templateId) {
      acc.set(templateId, (acc.get(templateId) || 0) + 1);
    }
    return acc;
  }, new Map());

  return rooms.map((room) => {
    if (!canConfirmReviewSemantic(room, templateUseCount)) {
      return room;
    }

    const source = room.source === 'opencv-wall-grid-template-recovered'
      ? 'opencv-wall-grid-template-recovered-confirmed'
      : 'opencv-wall-grid-with-layout-confirmed-semantics';
    return stripSemanticReview(room, source);
  });
}

function stabilizePublicRoomSemantics(rooms = [], job = {}) {
  const layout = inferExpectedLayout(job);
  const publicTypes = new Set(['living', 'dining', 'entry', 'space']);
  const blockedTypes = new Set(['bedroom', 'kitchen', 'bathroom', 'balcony']);
  const nextRooms = [...rooms];
  const hasLiving = nextRooms.some((room) => room.type === 'living' || room.name === '客厅');
  const hasDining = nextRooms.some((room) => room.type === 'dining' || room.name === '餐厅');

  if (!hasLiving) {
    const livingCandidate = nextRooms
      .filter((room) => !blockedTypes.has(room.type))
      .sort((a, b) => roomPixelArea(b) - roomPixelArea(a))[0];
    if (livingCandidate) {
      const index = nextRooms.findIndex((room) => room.id === livingCandidate.id);
      nextRooms[index] = {
        ...nextRooms[index],
        name: '客厅',
        type: 'living',
        confidence: Number(Math.min(0.78, Math.max(toNumber(nextRooms[index].confidence, 0.62), 0.7)).toFixed(2)),
        source: nextRooms[index].source === 'opencv-wall-grid-with-ocr-semantics'
          ? nextRooms[index].source
          : 'opencv-wall-grid-with-public-room-fallback',
        sourceEvidence: {
          ...(nextRooms[index].sourceEvidence || {}),
          publicRoomFallback: 'largest-unclassified-public-room',
          semanticNeedsReview: !nextRooms[index].sourceEvidence?.ocrText
        },
        semanticNeedsReview: !nextRooms[index].sourceEvidence?.ocrText
      };
    }
  }

  if (!hasDining && layout.halls >= 2) {
    const livingRoom = nextRooms.find((room) => room.type === 'living' || room.name === '客厅');
    const livingCenter = livingRoom ? roomCenter(livingRoom) : null;
    const diningCandidate = nextRooms
      .filter((room) => room.id !== livingRoom?.id)
      .filter((room) => publicTypes.has(room.type || 'space'))
      .sort((a, b) => {
        if (livingCenter) {
          const aCenter = roomCenter(a);
          const bCenter = roomCenter(b);
          const distanceDelta = Math.hypot(aCenter.x - livingCenter.x, aCenter.y - livingCenter.y)
            - Math.hypot(bCenter.x - livingCenter.x, bCenter.y - livingCenter.y);
          if (Math.abs(distanceDelta) > 18) {
            return distanceDelta;
          }
        }
        return roomPixelArea(b) - roomPixelArea(a);
      })[0];

    if (diningCandidate) {
      const index = nextRooms.findIndex((room) => room.id === diningCandidate.id);
      nextRooms[index] = {
        ...nextRooms[index],
        name: '餐厅',
        type: 'dining',
        confidence: Number(Math.min(0.76, Math.max(toNumber(nextRooms[index].confidence, 0.62), 0.68)).toFixed(2)),
        source: nextRooms[index].source === 'opencv-wall-grid-with-ocr-semantics'
          ? nextRooms[index].source
          : 'opencv-wall-grid-with-public-room-fallback',
        sourceEvidence: {
          ...(nextRooms[index].sourceEvidence || {}),
          publicRoomFallback: 'second-hall-near-living-room',
          semanticNeedsReview: !nextRooms[index].sourceEvidence?.ocrText
        },
        semanticNeedsReview: !nextRooms[index].sourceEvidence?.ocrText
      };
    }
  }

  return nextRooms;
}

function repairApartmentRoomPartition(rooms = [], preprocessing = {}) {
  const next = rooms.map((room) => ({ ...room, sourceEvidence: { ...(room.sourceEvidence || {}) } }));
  const byType = (type) => next.find((room) => room.type === type);
  const bedroom = next.find((room) => room.type === 'bedroom' && /男孩|次卧/.test(String(room.name || '')));
  const master = next.find((room) => room.type === 'bedroom' && /主卧/.test(String(room.name || '')));
  const bath = byType('bathroom');
  const living = byType('living');
  const dining = byType('dining');
  const entry = byType('entry');
  const reviewKitchen = next.find((room) => room.type === 'kitchen' && room.sourceEvidence?.semanticNeedsReview);
  const unclassified = next.find((room) => room.type === 'space');

  const hasRightLowerPartitionPattern = bedroom && living && dining && entry && reviewKitchen
    && overlapsRoom(reviewKitchen, bedroom) >= 0.25
    && overlapsRoom(reviewKitchen, dining) >= 0.25
    && toNumber(entry.x) >= toNumber(reviewKitchen.x) + toNumber(reviewKitchen.width) - 12;
  if (!hasRightLowerPartitionPattern) {
    return rooms;
  }

  const lowerTop = toNumber(living.y);
  const lowerBottom = lowerTop + toNumber(living.height);
  const entryLeft = toNumber(reviewKitchen.x);
  const kitchenLeft = toNumber(entry.x);
  const rightOutline = Math.max(
    kitchenLeft + toNumber(entry.width),
    ...(preprocessing?.geometryCandidates?.balconyCandidates || [])
      .filter((candidate) => toNumber(candidate.x) + toNumber(candidate.width) > kitchenLeft)
      .filter((candidate) => {
        const candidateTop = toNumber(candidate.y);
        const candidateBottom = candidateTop + toNumber(candidate.height);
        return Math.max(0, Math.min(lowerBottom, candidateBottom) - Math.max(lowerTop, candidateTop)) >= 40;
      })
      .map((candidate) => toNumber(candidate.x) + toNumber(candidate.width))
  );

  Object.assign(reviewKitchen, {
    name: '门厅',
    type: 'entry',
    x: entryLeft,
    y: lowerTop,
    width: Math.max(64, kitchenLeft - entryLeft),
    height: lowerBottom - lowerTop,
    confidence: Math.max(0.8, toNumber(reviewKitchen.confidence, 0.7)),
    source: 'wall-axis-partition-confirmed'
  });
  delete reviewKitchen.semanticNeedsReview;
  delete reviewKitchen.sourceEvidence.semanticNeedsReview;
  reviewKitchen.sourceEvidence.partitionConfirmedBy = 'lower-public-room-wall-axes';

  Object.assign(entry, {
    name: '厨房',
    type: 'kitchen',
    x: kitchenLeft,
    y: lowerTop,
    width: Math.max(toNumber(entry.width), rightOutline - kitchenLeft),
    height: lowerBottom - lowerTop,
    confidence: Math.max(0.8, toNumber(entry.confidence, 0.7)),
    source: 'wall-axis-partition-confirmed'
  });
  delete entry.semanticNeedsReview;
  delete entry.sourceEvidence.semanticNeedsReview;
  entry.sourceEvidence.partitionConfirmedBy = 'entry-kitchen-and-exterior-window-axes';

  dining.width = Math.max(64, entryLeft - toNumber(dining.x));
  dining.sourceEvidence.partitionConfirmedBy = 'dining-entry-shared-wall-axis';

  if (unclassified && bath) {
    Object.assign(unclassified, {
      name: '楼梯/过道',
      type: 'circulation',
      x: toNumber(bath.x),
      y: toNumber(bath.y) + toNumber(bath.height),
      width: Math.max(64, toNumber(bedroom.x) - toNumber(bath.x)),
      height: Math.max(64, lowerTop - (toNumber(bath.y) + toNumber(bath.height))),
      confidence: 0.8,
      source: 'wall-axis-partition-confirmed'
    });
    unclassified.sourceEvidence.partitionConfirmedBy = 'bath-bedroom-and-living-wall-axes';
  }

  if (master && bath && living) {
    const masterRight = toNumber(bath.x);
    master.x = toNumber(living.x);
    master.width = Math.max(80, masterRight - master.x);
    master.sourceEvidence.partitionConfirmedBy = 'living-left-and-bath-shared-wall-axes';
  }

  const balcony = next.find((room) => room.type === 'balcony');
  if (balcony && living) {
    const balconyBottom = toNumber(balcony.y) + toNumber(balcony.height);
    if (toNumber(balcony.y) < lowerTop && lowerTop - toNumber(balcony.y) <= 12) {
      balcony.y = lowerTop;
      balcony.height = balconyBottom - lowerTop;
      balcony.sourceEvidence.volumeTrimmedToInnerWall = true;
    }
    const balconyInnerEdge = toNumber(balcony.x) + toNumber(balcony.width);
    const livingRight = toNumber(living.x) + toNumber(living.width);
    if (balconyInnerEdge > toNumber(living.x) && balconyInnerEdge - toNumber(living.x) <= 24) {
      living.x = balconyInnerEdge;
      living.width = livingRight - balconyInnerEdge;
      living.sourceEvidence.partitionConfirmedBy = 'balcony-living-shared-inner-wall-axis';
    }
  }

  return next;
}

function supplementRoomsWithTemplate(geometryRooms = [], templateRooms = [], job) {
  const target = expectedRoomTarget(job);
  if (!target || !geometryRooms.length || !templateRooms.length) {
    return geometryRooms;
  }

  const usedTemplateIds = new Set(geometryRooms
    .map((room) => room.sourceEvidence?.semanticTemplateRoomId)
    .filter(Boolean));
  const existingNames = new Set(geometryRooms.map((room) => room.name).filter(Boolean));
  const needsCriticalSupplement = templateRooms.some((template) => (
    template.id === 'kitchen'
    && !usedTemplateIds.has(template.id)
    && !existingNames.has(template.name)
  ));

  if (geometryRooms.length >= Math.max(2, Math.floor(target * 0.62)) && !needsCriticalSupplement && geometryRooms.length >= target) {
    return geometryRooms;
  }

  const supplemented = [...geometryRooms];
  const maxDistance = Math.max(
    120,
    Math.hypot(
      Math.max(...templateRooms.map((room) => room.x + room.width)) - Math.min(...templateRooms.map((room) => room.x)),
      Math.max(...templateRooms.map((room) => room.y + room.height)) - Math.min(...templateRooms.map((room) => room.y))
    ) * 0.16
  );

  for (const template of templateRooms) {
    if (supplemented.length >= target) {
      break;
    }
    if (geometryRooms.length >= Math.max(2, Math.floor(target * 0.62)) && template.id !== 'kitchen') {
      continue;
    }
    if (usedTemplateIds.has(template.id) || existingNames.has(template.name)) {
      continue;
    }

    const center = roomCenter(template);
    const hasNearbyGeometry = geometryRooms.some((room) => {
      const other = roomCenter(room);
      return Math.hypot(center.x - other.x, center.y - other.y) <= maxDistance;
    });
    if (hasNearbyGeometry) {
      continue;
    }

    supplemented.push({
      ...template,
      id: `supplemental-${template.id || supplemented.length + 1}`,
      confidence: Number(Math.max(0.52, Math.min(0.68, toNumber(template.confidence, 0.62) - 0.08)).toFixed(2)),
      source: 'layout-template-supplemental',
      semanticNeedsReview: true,
      boundaryNeedsReview: true,
      boundaryReviewReason: 'expected-critical-room-without-stable-geometry-room',
      sourceEvidence: {
        supplementedBecause: 'partial-opencv-wall-grid',
        expectedRoomTarget: target,
        geometryRoomCount: geometryRooms.length,
        semanticTemplateRoomId: template.id,
        semanticNeedsReview: true,
        boundaryNeedsReview: true,
        boundaryReviewReason: 'expected-critical-room-without-stable-geometry-room'
      }
    });
    usedTemplateIds.add(template.id);
    existingNames.add(template.name);
  }

  return supplemented
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((room, index) => ({
      ...room,
      outputOrder: index + 1
    }));
}

function inferTemplateOpeningsFromRooms(rooms = []) {
  const allRooms = [...rooms];
  const bedroomRooms = allRooms.filter((room) => room.type === 'bedroom').slice(0, 3);
  const bathroom = allRooms.find((room) => room.type === 'bathroom');
  const kitchen = allRooms.find((room) => room.type === 'kitchen');
  const entry = allRooms.find((room) => room.type === 'entry');
  const balcony = allRooms.find((room) => room.type === 'balcony')
    || rooms.find((room) => room.type === 'balcony' && room.source === 'thin-outline-balcony-candidate' && toNumber(room.confidence, 0) >= 0.78);
  const roomNeedsOpeningReview = (room) => Boolean(room?.boundaryNeedsReview || room?.sourceEvidence?.boundaryNeedsReview);
  const doors = [
    ...bedroomRooms.map((room, index) => ({
      id: `door-${room.id || index + 1}`,
      type: 'door',
      x: room.x + room.width * 0.18,
      y: room.y + room.height,
      width: 32,
      height: 10,
      confidence: roomNeedsOpeningReview(room) ? 0.46 : 0.48,
      source: 'semantic-room-opening-prior',
      sourceEvidence: {
        roomId: room.id,
        roomName: room.name,
        roomType: room.type,
        inferredFrom: 'room-opening-prior'
      }
    })),
    bathroom && {
      id: `door-${bathroom.id}`,
      type: 'door',
      x: bathroom.x + bathroom.width * 0.25,
      y: bathroom.y + bathroom.height,
      width: 28,
      height: 10,
      confidence: roomNeedsOpeningReview(bathroom) ? 0.46 : 0.48,
      source: 'semantic-room-opening-prior',
      sourceEvidence: {
        roomId: bathroom.id,
        roomName: bathroom.name,
        roomType: bathroom.type,
        inferredFrom: 'room-opening-prior'
      }
    },
    kitchen && {
      id: `door-${kitchen.id}`,
      type: 'door',
      x: kitchen.x,
      y: kitchen.y + kitchen.height * 0.45,
      width: 10,
      height: 32,
      confidence: roomNeedsOpeningReview(kitchen) ? 0.46 : 0.48,
      source: 'semantic-room-opening-prior',
      sourceEvidence: roomNeedsOpeningReview(kitchen)
        ? {
          roomId: kitchen.id,
          roomName: kitchen.name,
          roomType: kitchen.type,
          needsVisualConfirmation: true,
          inferredFrom: 'kitchen-room-opening-prior'
        }
        : {}
    },
    entry && {
      id: `door-${entry.id}`,
      type: 'door',
      x: entry.x - Math.max(28, entry.width * 0.28),
      y: entry.y + entry.height,
      width: Math.max(52, entry.width * 0.34),
      height: 10,
      confidence: roomNeedsOpeningReview(entry) ? 0.44 : 0.46,
      source: 'semantic-room-opening-prior',
      sourceEvidence: {
        roomId: entry.id,
        roomName: entry.name,
        roomType: entry.type,
        edge: 'entry-exterior-bottom-left',
        needsVisualConfirmation: true,
        inferredFrom: 'entry-room-exterior-door-prior'
      }
    }
  ].filter(Boolean);

  const windows = [
    ...bedroomRooms.map((room, index) => ({
      id: `window-${room.id || index + 1}`,
      type: 'window',
      x: room.x + room.width * 0.5,
      y: room.y,
      width: Math.max(48, room.width * 0.38),
      height: 8,
      confidence: roomNeedsOpeningReview(room) ? 0.48 : 0.5,
      source: 'semantic-room-opening-prior',
      sourceEvidence: roomNeedsOpeningReview(room)
        ? {
          roomId: room.id,
          roomName: room.name,
          roomType: room.type,
          needsVisualConfirmation: true,
          inferredFrom: 'bedroom-room-opening-prior'
        }
        : {}
    })),
    kitchen && {
      id: `window-${kitchen.id}`,
      type: 'window',
      x: kitchen.x + kitchen.width,
      y: kitchen.y + kitchen.height * 0.54,
      width: 8,
      height: Math.max(48, kitchen.height * 0.42),
      confidence: roomNeedsOpeningReview(kitchen) ? 0.46 : 0.48,
      source: 'semantic-room-opening-prior',
      sourceEvidence: roomNeedsOpeningReview(kitchen)
        ? {
          roomId: kitchen.id,
          roomName: kitchen.name,
          roomType: kitchen.type,
          needsVisualConfirmation: true,
          inferredFrom: 'kitchen-room-opening-prior'
        }
        : {}
    },
    balcony && {
      id: `window-${balcony.id}`,
      type: 'window',
      x: balcony.x,
      y: balcony.y + balcony.height * 0.5,
      width: 8,
      height: Math.max(60, balcony.height * 0.65),
      confidence: balcony.source === 'thin-outline-balcony-candidate' ? 0.46 : 0.48,
      source: 'semantic-room-opening-prior',
      sourceEvidence: balcony.source === 'thin-outline-balcony-candidate'
        ? {
          inferredFromBalconyCandidate: true,
          balconyCandidateId: balcony.sourceEvidence?.balconyCandidateId || balcony.id,
          needsManualReview: true
        }
        : {}
    }
  ].filter(Boolean);

  return { doors, windows };
}

function inferDoorsFromSymbolCandidates(preprocessing = {}) {
  const candidates = preprocessing?.geometryCandidates?.doorSymbolCandidates || [];
  return candidates
    .filter((candidate) => toNumber(candidate.confidence, 0) >= 0.5)
    .map((candidate, index) => {
      const center = candidate.center || {};
      const horizontal = candidate.orientation === 'horizontal';
      const assetMatch = candidate.assetMatch || null;
      const assetMatched = Boolean(assetMatch?.assetId);
      const hasWall = Boolean(candidate.wallCandidateId || candidate.leftSupport || candidate.rightSupport);
      return {
        id: `door-symbol-${index + 1}`,
        type: 'door',
        x: toNumber(center.x, toNumber(candidate.x) + toNumber(candidate.width) / 2),
        y: toNumber(center.y, toNumber(candidate.y) + toNumber(candidate.height) / 2),
        width: horizontal ? Math.max(24, toNumber(candidate.width, 32)) : 10,
        height: horizontal ? 10 : Math.max(24, toNumber(candidate.height, 32)),
        confidence: Number(Math.min(0.88, toNumber(candidate.confidence, 0.58) + 0.04 + (assetMatched ? 0.03 : 0)).toFixed(2)),
        source: candidate.source || 'door-opening-scanner',
        sourceEvidence: {
          scannerId: candidate.id,
          scannerSource: candidate.source,
          wallCandidateId: candidate.wallCandidateId || '',
          orientation: candidate.orientation,
          gapLength: candidate.gapLength,
          leftSupport: candidate.leftSupport,
          rightSupport: candidate.rightSupport,
          doorType: candidate.doorType || '',
          hasSwingArc: Boolean(candidate.hasSwingArc),
          assetMatch,
          confirmedOpening: assetMatched || hasWall || toNumber(candidate.confidence, 0) >= 0.7,
          inferredFrom: 'wall-gap-between-supported-wall-runs'
        }
      };
    });
}

function wallSupportsRoomEdge(walls = [], edge = {}) {
  const tolerance = 34;
  const orientation = edge.side === 'top' || edge.side === 'bottom' ? 'horizontal' : 'vertical';
  const fixed = orientation === 'horizontal' ? edge.y : edge.x;
  const start = orientation === 'horizontal' ? edge.x1 : edge.y1;
  const end = orientation === 'horizontal' ? edge.x2 : edge.y2;

  let best = null;
  for (const wall of walls) {
    if (wall.orientation !== orientation) {
      continue;
    }
    const wallFixed = orientation === 'horizontal'
      ? (toNumber(wall.start?.y) + toNumber(wall.end?.y)) / 2
      : (toNumber(wall.start?.x) + toNumber(wall.end?.x)) / 2;
    const fixedDistance = Math.abs(wallFixed - fixed);
    if (fixedDistance > tolerance) {
      continue;
    }

    const wallStart = orientation === 'horizontal'
      ? Math.min(toNumber(wall.start?.x), toNumber(wall.end?.x))
      : Math.min(toNumber(wall.start?.y), toNumber(wall.end?.y));
    const wallEnd = orientation === 'horizontal'
      ? Math.max(toNumber(wall.start?.x), toNumber(wall.end?.x))
      : Math.max(toNumber(wall.start?.y), toNumber(wall.end?.y));
    const overlap = Math.max(0, Math.min(end, wallEnd) - Math.max(start, wallStart));
    const edgeLength = Math.max(1, end - start);
    const overlapRatio = overlap / edgeLength;
    if (overlapRatio < 0.28) {
      continue;
    }

    const score = overlapRatio + Math.max(0, 1 - fixedDistance / tolerance) * 0.35 + toNumber(wall.confidence, 0.6) * 0.2;
    if (!best || score > best.score) {
      best = { wall, fixedDistance, overlapRatio, score };
    }
  }

  return best;
}

function inferWallLineWindowsFromRooms(rooms = [], walls = [], preprocessing = {}) {
  if (!rooms.length || !walls.length) {
    return [];
  }

  const bounds = getGeometryBounds({ geometryCandidates: { lines: walls } });
  const planRight = bounds.x + bounds.width;
  const planBottom = bounds.y + bounds.height;
  const exteriorBandX = Math.max(72, bounds.width * 0.18);
  const exteriorBandY = Math.max(72, bounds.height * 0.18);
  const windowRooms = rooms
    .filter((room) => ['bedroom', 'living', 'dining', 'kitchen', 'balcony'].includes(room.type))
    .filter((room) => !room.boundaryNeedsReview || room.source === 'thin-outline-balcony-candidate' || room.sourceEvidence?.semanticConfirmedBy);
  const candidates = [];

  for (const room of windowRooms) {
    const x = toNumber(room.x);
    const y = toNumber(room.y);
    const width = toNumber(room.width);
    const height = toNumber(room.height);
    if (width < 44 || height < 44) {
      continue;
    }

    const edges = [
      {
        side: 'top',
        x1: x + width * 0.18,
        x2: x + width * 0.82,
        y,
        exteriorScore: Math.max(0, 1 - Math.abs(y - bounds.y) / exteriorBandY)
      },
      {
        side: 'bottom',
        x1: x + width * 0.18,
        x2: x + width * 0.82,
        y: y + height,
        exteriorScore: Math.max(0, 1 - Math.abs(planBottom - (y + height)) / exteriorBandY)
      },
      {
        side: 'left',
        x,
        y1: y + height * 0.18,
        y2: y + height * 0.82,
        exteriorScore: Math.max(0, 1 - Math.abs(x - bounds.x) / exteriorBandX)
      },
      {
        side: 'right',
        x: x + width,
        y1: y + height * 0.18,
        y2: y + height * 0.82,
        exteriorScore: Math.max(0, 1 - Math.abs(planRight - (x + width)) / exteriorBandX)
      }
    ];

    const rankedEdges = edges
      .map((edge) => {
        const support = wallSupportsRoomEdge(walls, edge);
        return {
          edge,
          support,
          score: edge.exteriorScore + (support?.score || 0)
        };
      })
      .filter((item) => item.edge.exteriorScore >= 0.2 && item.support)
      .sort((a, b) => b.score - a.score);

    const best = rankedEdges[0];
    if (!best) {
      continue;
    }

    const horizontal = best.edge.side === 'top' || best.edge.side === 'bottom';
    const openingLength = horizontal
      ? Math.max(56, Math.min(width * 0.48, best.edge.x2 - best.edge.x1))
      : Math.max(56, Math.min(height * 0.5, best.edge.y2 - best.edge.y1));
    const centerX = horizontal
      ? (best.edge.x1 + best.edge.x2) / 2
      : best.edge.x;
    const centerY = horizontal
      ? best.edge.y
      : (best.edge.y1 + best.edge.y2) / 2;

    candidates.push({
      id: `window-wall-${room.id || candidates.length + 1}`,
      type: 'window',
      x: Number(centerX.toFixed(1)),
      y: Number(centerY.toFixed(1)),
      width: horizontal ? Number(openingLength.toFixed(1)) : 8,
      height: horizontal ? 8 : Number(openingLength.toFixed(1)),
      confidence: Number(Math.min(0.82, 0.56 + best.edge.exteriorScore * 0.12 + best.support.overlapRatio * 0.16).toFixed(2)),
      source: 'wall-line-window-candidate',
      sourceEvidence: {
        roomId: room.id,
        roomName: room.name,
        roomType: room.type,
        edge: best.edge.side,
        exteriorScore: Number(best.edge.exteriorScore.toFixed(2)),
        supportingWallId: best.support.wall.id,
        supportingWallDistance: Number(best.support.fixedDistance.toFixed(1)),
        supportingWallOverlapRatio: Number(best.support.overlapRatio.toFixed(2)),
        inferredFrom: 'detected-wall-line-and-exterior-room-edge',
        needsVisualConfirmation: true
      }
    });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${Math.round(candidate.x / 24)}:${Math.round(candidate.y / 24)}:${candidate.width > candidate.height ? 'h' : 'v'}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function inferBalconyOutlineWindows(rooms = [], walls = []) {
  const candidates = [];
  for (const room of rooms.filter((candidate) => candidate.type === 'balcony')) {
    const x = toNumber(room.x);
    const y = toNumber(room.y);
    const width = toNumber(room.width);
    const height = toNumber(room.height);
    if (width < 44 || height < 44) {
      continue;
    }

    const edges = [
      { side: 'top', x1: x + width * 0.12, x2: x + width * 0.88, y },
      { side: 'bottom', x1: x + width * 0.12, x2: x + width * 0.88, y: y + height },
      { side: 'left', x, y1: y + height * 0.12, y2: y + height * 0.88 },
      { side: 'right', x: x + width, y1: y + height * 0.12, y2: y + height * 0.88 }
    ];

    for (const edge of edges) {
      if (!roomEdgeFacesExterior(edge, rooms, room.id)) {
        continue;
      }
      const horizontal = edge.side === 'top' || edge.side === 'bottom';
      const support = wallSupportsRoomEdge(walls, edge);
      if (!support || support.overlapRatio < 0.32 || support.fixedDistance > 22) {
        continue;
      }
      const centerX = horizontal ? (edge.x1 + edge.x2) / 2 : edge.x;
      const centerY = horizontal ? edge.y : (edge.y1 + edge.y2) / 2;
      const length = horizontal ? edge.x2 - edge.x1 : edge.y2 - edge.y1;
      candidates.push({
        id: `window-balcony-outline-${room.id || candidates.length + 1}-${edge.side}`,
        type: 'window',
        x: Number(centerX.toFixed(1)),
        y: Number(centerY.toFixed(1)),
        width: horizontal ? Number(Math.max(44, length).toFixed(1)) : 8,
        height: horizontal ? 8 : Number(Math.max(44, length).toFixed(1)),
        confidence: Number(Math.min(0.78, 0.62 + (support ? 0.08 : 0) + toNumber(room.confidence, 0.6) * 0.08).toFixed(2)),
        source: 'semantic-room-opening-prior',
        sourceEvidence: {
          roomId: room.id,
          roomName: room.name,
          roomType: room.type,
          edge: edge.side,
          supportingWallId: `balcony-glazing-boundary-${room.id || candidates.length + 1}-${edge.side}`,
          expectedWallOrientation: edge.orientation,
          supportingWallId: support?.wall?.id || '',
          supportingWallOverlapRatio: support ? Number(support.overlapRatio.toFixed(2)) : 0,
          expectedWallOrientation: horizontal ? 'horizontal' : 'vertical',
          inferredFrom: 'accepted-balcony-exterior-outline',
          proposedBalconyOutlineWindow: true,
          needsVisualConfirmation: true
        }
      });
    }
  }

  return candidates;
}

function inferBalconyGlazingOutlineWindows(rooms = [], preprocessing = {}) {
  const lines = preprocessing?.geometryCandidates?.lines || [];
  const candidates = [];

  for (const room of rooms.filter((candidate) => candidate.type === 'balcony')) {
    const x = toNumber(room.x);
    const y = toNumber(room.y);
    const width = toNumber(room.width);
    const height = toNumber(room.height);
    const edges = [
      { side: 'left', orientation: 'vertical', axis: x, start: y, end: y + height, length: height },
      { side: 'right', orientation: 'vertical', axis: x + width, start: y, end: y + height, length: height },
      { side: 'top', orientation: 'horizontal', axis: y, start: x, end: x + width, length: width },
      { side: 'bottom', orientation: 'horizontal', axis: y + height, start: x, end: x + width, length: width }
    ];

    for (const edge of edges) {
      const matching = lines.filter((line) => {
        if (line.source !== 'hough-edge' || line.orientation !== edge.orientation) {
          return false;
        }
        const axis = edge.orientation === 'vertical'
          ? (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2
          : (toNumber(line.start?.y) + toNumber(line.end?.y)) / 2;
        const start = edge.orientation === 'vertical'
          ? Math.min(toNumber(line.start?.y), toNumber(line.end?.y))
          : Math.min(toNumber(line.start?.x), toNumber(line.end?.x));
        const end = edge.orientation === 'vertical'
          ? Math.max(toNumber(line.start?.y), toNumber(line.end?.y))
          : Math.max(toNumber(line.start?.x), toNumber(line.end?.x));
        const overlap = Math.max(0, Math.min(end, edge.end) - Math.max(start, edge.start));
        return Math.abs(axis - edge.axis) <= 18
          && overlap / Math.max(1, edge.length) >= 0.68;
      });
      const axes = [...new Set(matching.map((line) => Math.round(edge.orientation === 'vertical'
        ? (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2
        : (toNumber(line.start?.y) + toNumber(line.end?.y)) / 2)))]
        .sort((a, b) => a - b);
      if (matching.length < 3 || axes.length < 3 || axes.at(-1) - axes[0] > 22) {
        continue;
      }
      const axis = axes[Math.floor(axes.length / 2)];
      const vertical = edge.orientation === 'vertical';
      candidates.push({
        id: `window-balcony-glazing-${room.id || candidates.length + 1}-${edge.side}`,
        type: 'window',
        x: vertical ? axis : Number((x + width / 2).toFixed(1)),
        y: vertical ? Number((y + height / 2).toFixed(1)) : axis,
        width: vertical ? 8 : Number(width.toFixed(1)),
        height: vertical ? Number(height.toFixed(1)) : 8,
        confidence: Number(Math.min(0.92, 0.76 + matching.length * 0.02).toFixed(2)),
        source: 'balcony-glazing-outline-scanner',
        sourceEvidence: {
          roomId: room.id || '',
          roomType: 'balcony',
          edge: edge.side,
          parallelOutlineCount: matching.length,
          parallelOutlineAxes: axes,
          inferredFrom: 'three-or-more-long-parallel-balcony-glazing-lines',
          acceptedAsExteriorWindow: true
        }
      });
    }
  }

  return candidates.sort((a, b) => (
    toNumber(b.sourceEvidence?.parallelOutlineCount) - toNumber(a.sourceEvidence?.parallelOutlineCount)
  )).slice(0, 2);
}

function inferRawBalconyOutlineReviewWindows(preprocessing = {}, rooms = [], walls = []) {
  const rawBalconies = preprocessing?.geometryCandidates?.balconyCandidates || [];
  const acceptedBalconies = rooms.filter((room) => room.type === 'balcony');
  const candidates = [];

  for (const raw of rawBalconies) {
    if (isMergedBayWindowOutlineCandidate(raw, preprocessing)) {
      continue;
    }
    if (acceptedBalconies.some((room) => rectOverlapRatio(raw, room) >= 0.55 || room.sourceEvidence?.balconyCandidateId === raw.id)) {
      continue;
    }

    const x = toNumber(raw.x);
    const y = toNumber(raw.y);
    const width = toNumber(raw.width);
    const height = toNumber(raw.height);
    if (width < 70 || height < 70) {
      continue;
    }

    const pseudoRoomId = `raw-${raw.id || candidates.length + 1}`;
    const edges = [
      { side: 'top', x1: x + width * 0.1, x2: x + width * 0.9, y },
      { side: 'bottom', x1: x + width * 0.1, x2: x + width * 0.9, y: y + height },
      { side: 'left', x, y1: y + height * 0.1, y2: y + height * 0.9 },
      { side: 'right', x: x + width, y1: y + height * 0.1, y2: y + height * 0.9 }
    ];

    for (const edge of edges) {
      if (!roomEdgeFacesExterior(edge, rooms, pseudoRoomId)) {
        continue;
      }
      const horizontal = edge.side === 'top' || edge.side === 'bottom';
      const support = wallSupportsRoomEdge(walls, edge);
      if (!support || support.overlapRatio < 0.32 || support.fixedDistance > 22) {
        continue;
      }
      const centerX = horizontal ? (edge.x1 + edge.x2) / 2 : edge.x;
      const centerY = horizontal ? edge.y : (edge.y1 + edge.y2) / 2;
      const length = horizontal ? edge.x2 - edge.x1 : edge.y2 - edge.y1;
      candidates.push({
        id: `window-raw-balcony-outline-${raw.id || candidates.length + 1}-${edge.side}`,
        type: 'window',
        x: Number(centerX.toFixed(1)),
        y: Number(centerY.toFixed(1)),
        width: horizontal ? Number(Math.max(44, length).toFixed(1)) : 8,
        height: horizontal ? 8 : Number(Math.max(44, length).toFixed(1)),
        confidence: Number(Math.min(0.66, 0.48 + toNumber(raw.confidence, 0.6) * 0.14 + (support ? 0.06 : 0)).toFixed(2)),
        source: 'semantic-room-opening-prior',
        sourceEvidence: {
          rawBalconyCandidateId: raw.id,
          edge: edge.side,
          supportingWallId: support?.wall?.id || '',
          supportingWallOverlapRatio: support ? Number(support.overlapRatio.toFixed(2)) : 0,
          expectedWallOrientation: horizontal ? 'horizontal' : 'vertical',
          inferredFrom: 'unresolved-balcony-outline-candidate',
          proposedBalconyOutlineWindow: true,
          needsVisualConfirmation: true
        }
      });
    }
  }

  return candidates.slice(0, 6);
}

function inferBayWindowOutlineCandidates(preprocessing = {}) {
  const lines = preprocessing?.geometryCandidates?.lines || [];
  const imageWidth = toNumber(preprocessing?.image?.width, 0);
  const imageHeight = toNumber(preprocessing?.image?.height, 0);
  if (!imageWidth || !imageHeight) {
    return [];
  }

  const supportLines = lines.filter((line) => (
    line.source === 'wall-grid-support-line'
    && line.orientation === 'vertical'
  ));
  const candidates = [];

  for (const line of lines) {
    if (line.orientation !== 'vertical') {
      continue;
    }
    const x = (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2;
    const y1 = Math.min(toNumber(line.start?.y), toNumber(line.end?.y));
    const y2 = Math.max(toNumber(line.start?.y), toNumber(line.end?.y));
    const length = y2 - y1;
    if (x < imageWidth * 0.78 || y1 < imageHeight * 0.2 || y2 > imageHeight * 0.72 || length < 105) {
      continue;
    }

    const directSupport = line.source === 'wall-grid-support-line'
      && toNumber(line.wallEvidence?.tone?.meanGray, 0) >= 180;
    const nearbySupport = line.source !== 'wall-grid-support-line' && supportLines.find((support) => (
      Math.abs(toNumber(support.start?.x) - x) <= 18
      && Math.abs(Math.max(toNumber(support.start?.y), toNumber(support.end?.y)) - y2) <= 60
    ));
    if (!directSupport && !nearbySupport) {
      continue;
    }

    candidates.push({
      id: `window-bay-outline-${line.id || candidates.length + 1}`,
      type: 'window',
      x: Number(x.toFixed(1)),
      y: Number(((y1 + y2) / 2).toFixed(1)),
      width: 8,
      height: Number(length.toFixed(1)),
      confidence: directSupport ? 0.84 : 0.78,
      source: 'bay-window-outline-scanner',
      sourceEvidence: {
        outlineLineId: line.id || '',
        supportingLineId: directSupport ? line.id : nearbySupport?.id || '',
        expectedWallOrientation: 'vertical',
        inferredFrom: 'exterior-bay-outline-with-return-support',
        acceptedAsExteriorWindow: true
      }
    });
  }

  return candidates.filter((candidate, index, all) => all.findIndex((other) => (
    Math.abs(toNumber(other.x) - toNumber(candidate.x)) <= 20
    && Math.abs(toNumber(other.y) - toNumber(candidate.y)) <= 45
  )) === index).slice(0, 3);
}

function inferBathroomExteriorGapWindows(rooms = [], walls = []) {
  const candidates = [];
  for (const room of rooms.filter((candidate) => candidate.type === 'bathroom')) {
    const roomTop = toNumber(room.y);
    const roomBottom = roomTop + toNumber(room.height);
    for (const edge of [
      { side: 'left', x: toNumber(room.x) },
      { side: 'right', x: toNumber(room.x) + toNumber(room.width) }
    ]) {
      const lowerWall = walls
        .filter((wall) => wall.orientation === 'vertical')
        .map((wall) => ({
          wall,
          x: (toNumber(wall.start?.x) + toNumber(wall.end?.x)) / 2,
          y1: Math.min(toNumber(wall.start?.y), toNumber(wall.end?.y))
        }))
        .filter((item) => Math.abs(item.x - edge.x) <= 18)
        .filter((item) => item.y1 >= roomTop + 36 && item.y1 <= roomBottom - 20)
        .sort((a, b) => a.y1 - b.y1)[0];
      if (!lowerWall) {
        continue;
      }
      const gapLength = lowerWall.y1 - roomTop;
      if (gapLength < 42 || gapLength > 110) {
        continue;
      }
      candidates.push({
        id: `window-bathroom-gap-${room.id || candidates.length + 1}-${edge.side}`,
        type: 'window',
        x: Number(edge.x.toFixed(1)),
        y: Number((roomTop + gapLength / 2).toFixed(1)),
        width: 8,
        height: Number(gapLength.toFixed(1)),
        confidence: 0.81,
        source: 'exterior-wall-gap-scanner',
        sourceEvidence: {
          roomId: room.id || '',
          roomType: room.type,
          edge: edge.side,
          lowerWallId: lowerWall.wall.id || '',
          expectedWallOrientation: 'vertical',
          inferredFrom: 'exterior-vertical-wall-gap',
          acceptedAsExteriorWindow: true
        }
      });
    }
  }
  return candidates.slice(0, 2);
}

function preferVisualWindowCandidates(draft = {}, preprocessing = {}) {
  const symbolWindows = inferWindowsFromSymbolCandidates(preprocessing, draft.rooms || [], draft.walls || []);
  const acceptedSymbolWindows = symbolWindows
    .filter((candidate) => candidate.sourceEvidence?.acceptedAsExteriorWindow);
  const proposedSymbolWindows = symbolWindows
    .filter((candidate) => (
      candidate.sourceEvidence?.proposedStrongWallWindowCandidate
      || candidate.sourceEvidence?.proposedRawBalconyWindowCandidate
    ));
  const balconyGlazingWindows = inferBalconyGlazingOutlineWindows(draft.rooms || [], preprocessing);
  const visualWindows = [
    ...acceptedSymbolWindows,
    ...proposedSymbolWindows,
    ...balconyGlazingWindows,
    ...inferBalconyOutlineWindows(draft.rooms || [], draft.walls || []),
    ...inferRawBalconyOutlineReviewWindows(preprocessing, draft.rooms || [], draft.walls || []),
    ...inferBayWindowOutlineCandidates(preprocessing),
    ...inferBathroomExteriorGapWindows(draft.rooms || [], draft.walls || []),
    ...inferWallLineWindowsFromRooms(draft.rooms || [], draft.walls || [], preprocessing)
  ];
  if (!visualWindows.length) {
    return draft;
  }

  const existingWindows = Array.isArray(draft.windows) ? draft.windows : [];
  const reliableExisting = existingWindows.filter((window) => (
    window.source
    && window.source !== 'semantic-room-opening-prior'
      && toNumber(window.confidence, 0) >= 0.62
      && !(window.source === 'wall-line-window-candidate' && acceptedSymbolWindows.some((symbol) => (
        (toNumber(symbol.width) >= toNumber(symbol.height)) === (toNumber(window.width) >= toNumber(window.height))
        && Math.abs(toNumber(symbol.x) - toNumber(window.x)) <= Math.max(48, Math.max(toNumber(window.width), toNumber(symbol.width)) * 0.55)
        && Math.abs(toNumber(symbol.y) - toNumber(window.y)) <= Math.max(36, Math.max(toNumber(window.height), toNumber(symbol.height)) * 0.75)
      )))
  ));
  const merged = [...reliableExisting];

  for (const candidate of visualWindows) {
    if (candidate.source === 'wall-line-window-candidate') {
      const coveredBySymbol = acceptedSymbolWindows.some((symbol) => (
        (toNumber(symbol.width) >= toNumber(symbol.height)) === (toNumber(candidate.width) >= toNumber(candidate.height))
        && Math.abs(toNumber(symbol.x) - toNumber(candidate.x)) <= Math.max(48, Math.max(toNumber(candidate.width), toNumber(symbol.width)) * 0.55)
        && Math.abs(toNumber(symbol.y) - toNumber(candidate.y)) <= Math.max(36, Math.max(toNumber(candidate.height), toNumber(symbol.height)) * 0.75)
      ));
      if (coveredBySymbol) {
        continue;
      }
    }

    const duplicate = merged.some((window) => (
      Math.hypot(toNumber(window.x) - toNumber(candidate.x), toNumber(window.y) - toNumber(candidate.y)) <= 42
      && (toNumber(window.width) >= toNumber(window.height)) === (toNumber(candidate.width) >= toNumber(candidate.height))
      && Math.max(toNumber(window.width), toNumber(window.height)) >= Math.min(toNumber(candidate.width), toNumber(candidate.height)) * 0.5
    ));
    if (!duplicate) {
      merged.push(candidate);
    }
  }

  return {
    ...draft,
    walls: [
      ...(draft.walls || []),
      ...balconyGlazingWindows.map((window) => {
        const vertical = toNumber(window.height) >= toNumber(window.width);
        const halfSpan = (vertical ? toNumber(window.height) : toNumber(window.width)) / 2;
        return {
          id: window.sourceEvidence?.supportingWallId,
          start: vertical
            ? { x: window.x, y: window.y - halfSpan }
            : { x: window.x - halfSpan, y: window.y },
          end: vertical
            ? { x: window.x, y: window.y + halfSpan }
            : { x: window.x + halfSpan, y: window.y },
          thickness: 8,
          confidence: window.confidence,
          source: 'balcony-glazing-boundary',
          wallRole: 'exterior',
          isExterior: true
        };
      })
    ],
    windows: merged,
    quality: {
      ...(draft.quality || {}),
      visualWindowCandidateCount: visualWindows.length,
      windowSymbolCandidateCount: preprocessing?.geometryCandidates?.windowSymbolCandidateCount || 0,
      acceptedWindowSymbolCandidateCount: acceptedSymbolWindows.length,
      proposedWindowSymbolCandidateCount: proposedSymbolWindows.length,
      rejectedWindowSymbolCandidateCount: Math.max(0, symbolWindows.length - acceptedSymbolWindows.length - proposedSymbolWindows.length)
    }
  };
}

function preferVisualDoorCandidates(draft = {}, preprocessing = {}) {
  const visualDoors = inferDoorsFromSymbolCandidates(preprocessing);
  if (!visualDoors.length) {
    return draft;
  }

  const existingDoors = Array.isArray(draft.doors) ? draft.doors : [];
  const reliableExisting = existingDoors.filter((door) => (
    door.source
    && door.source !== 'semantic-room-opening-prior'
      && toNumber(door.confidence, 0) >= 0.6
  ));
  const semanticExisting = existingDoors.filter((door) => door.source === 'semantic-room-opening-prior');
  const merged = [...reliableExisting];

  for (const candidate of visualDoors) {
    const duplicate = merged.some((door) => (
      Math.hypot(toNumber(door.x) - toNumber(candidate.x), toNumber(door.y) - toNumber(candidate.y)) <= 36
      && (toNumber(door.width) >= toNumber(door.height)) === (toNumber(candidate.width) >= toNumber(candidate.height))
    ));
    if (!duplicate) {
      merged.push({
        ...candidate,
        sourceEvidence: {
          ...(candidate.sourceEvidence || {}),
          confirmedOpening: candidate.sourceEvidence?.confirmedOpening !== false,
          needsVisualConfirmation: undefined
        }
      });
    }
  }

  for (const candidate of semanticExisting) {
    const duplicate = merged.some((door) => (
      Math.hypot(toNumber(door.x) - toNumber(candidate.x), toNumber(door.y) - toNumber(candidate.y)) <= 42
      && (toNumber(door.width) >= toNumber(door.height)) === (toNumber(candidate.width) >= toNumber(candidate.height))
    ));
    if (!duplicate) {
      merged.push({
        ...candidate,
        sourceEvidence: {
          ...(candidate.sourceEvidence || {}),
          retainedAsSemanticDoorPrior: true,
          needsVisualConfirmation: true
        }
      });
    }
  }

  if (!merged.length) {
    return draft;
  }

  return {
    ...draft,
    doors: merged,
    quality: {
      ...(draft.quality || {}),
      visualDoorCandidateCount: visualDoors.length,
      doorSymbolCandidateCount: preprocessing?.geometryCandidates?.doorSymbolCandidateCount || 0,
      acceptedDoorSymbolCandidateCount: merged.filter((door) => door.source && door.source !== 'semantic-room-opening-prior').length
    }
  };
}

function axisDistanceBetweenOpenings(a = {}, b = {}) {
  const orientation = a.orientation || a.sourceEvidence?.wallOrientation || (toNumber(a.width) >= toNumber(a.height) ? 'horizontal' : 'vertical');
  if (orientation === 'horizontal') {
    return Math.abs(toNumber(a.x) - toNumber(b.x));
  }
  return Math.abs(toNumber(a.y) - toNumber(b.y));
}

function reviewSemanticDoorPriors(draft = {}) {
  const doors = Array.isArray(draft.doors) ? draft.doors : [];
  const windows = Array.isArray(draft.windows) ? draft.windows : [];
  const visualDoors = doors.filter((door) => door.source && door.source !== 'semantic-room-opening-prior');
  const reviewedDoors = [];
  const suppressedSemanticDoors = [];

  for (const door of doors) {
    if (door.source !== 'semantic-room-opening-prior') {
      reviewedDoors.push({
        ...door,
        sourceEvidence: {
          ...(door.sourceEvidence || {}),
          confirmedOpening: true,
          confirmationSource: door.source
        }
      });
      continue;
    }

    const sameWallVisual = visualDoors.find((visualDoor) => (
      visualDoor.attachedWallId
      && door.attachedWallId
      && visualDoor.attachedWallId === door.attachedWallId
      && axisDistanceBetweenOpenings(visualDoor, door) <= Math.max(48, Math.max(toNumber(visualDoor.width), toNumber(visualDoor.height), toNumber(door.width), toNumber(door.height)) * 1.15)
    ));
    if (sameWallVisual) {
      suppressedSemanticDoors.push({
        id: door.id,
        type: door.type,
        reason: 'duplicate-of-visual-door-on-same-wall',
        visualDoorId: sameWallVisual.id,
        attachedWallId: door.attachedWallId || ''
      });
      continue;
    }

    const invalidAttachment = door.needsWallAttachmentReview
      || toNumber(door.wallDistance, 0) > 22
      || door.sourceEvidence?.withinAttachmentSpan === false;
    const keepForEntryExteriorReview = door.sourceEvidence?.inferredFrom === 'entry-room-exterior-door-prior';
    if (invalidAttachment && !keepForEntryExteriorReview) {
      suppressedSemanticDoors.push({
        id: door.id,
        type: door.type,
        reason: 'semantic-door-prior-has-weak-wall-attachment',
        attachedWallId: door.attachedWallId || '',
        wallDistance: door.wallDistance ?? null,
        reviewReasons: door.reviewReasons || []
      });
      continue;
    }

    reviewedDoors.push({
      ...door,
      confidence: Number(Math.min(0.56, toNumber(door.confidence, 0.48)).toFixed(2)),
      sourceEvidence: {
        ...(door.sourceEvidence || {}),
        retainedAsSemanticDoorPrior: true,
        needsVisualConfirmation: true,
        semanticDoorReview: {
          status: 'proposed',
          reason: invalidAttachment ? 'entry-door-prior-needs-wall-and-arc-confirmation' : 'no-visual-door-evidence-near-this-wall-location'
        }
      },
      reviewReasons: [
        ...(door.reviewReasons || []),
        invalidAttachment ? 'weak-wall-attachment-needs-review' : 'no-visual-door-evidence'
      ]
    });
  }

  const proposedSemanticDoorPriorCount = reviewedDoors.filter((door) => door.source === 'semantic-room-opening-prior').length;
  const attachedOpeningCount = [...reviewedDoors, ...windows].filter((opening) => !opening.needsWallAttachmentReview).length;

  return {
    ...draft,
    doors: reviewedDoors,
    quality: {
      ...(draft.quality || {}),
      suppressedSemanticDoorPriorCount: suppressedSemanticDoors.length,
      proposedSemanticDoorPriorCount,
      needsReview: Boolean(draft.quality?.needsReview) || proposedSemanticDoorPriorCount > 0
    },
    topology: {
      ...(draft.topology || {}),
      openingCount: reviewedDoors.length + windows.length,
      attachedOpeningCount,
      needsReview: Boolean(draft.topology?.needsReview) || proposedSemanticDoorPriorCount > 0,
      suppressedSemanticDoors
    }
  };
}

function classifyExteriorWindowCandidate(candidate = {}, preprocessing = {}) {
  const bounds = getStructuralEnvelope(preprocessing);
  const x = toNumber(candidate.x);
  const y = toNumber(candidate.y);
  const width = toNumber(candidate.width, 8);
  const height = toNumber(candidate.height, 8);
  const centerX = x;
  const centerY = y;
  const horizontal = width >= height;
  const exteriorBandX = Math.max(92, bounds.width * 0.14);
  const exteriorBandY = Math.max(72, bounds.height * 0.14);
  const nearLeft = Math.abs(centerX - bounds.x) <= exteriorBandX;
  const nearRight = Math.abs(centerX - (bounds.x + bounds.width)) <= exteriorBandX;
  const nearTop = Math.abs(centerY - bounds.y) <= exteriorBandY;
  const nearBottom = Math.abs(centerY - (bounds.y + bounds.height)) <= exteriorBandY;
  const support = candidate.sourceEvidence?.wallSupport || {};
  const strongWallSupport = toNumber(support.score, 0) >= 1.1 && toNumber(support.overlapRatio, 0) >= 0.72;
  const nearExterior = horizontal ? (nearTop || nearBottom) : (nearLeft || nearRight);
  const assetMatched = Boolean(candidate.sourceEvidence?.assetMatch?.assetId || candidate.assetMatch?.assetId);
  const confidence = toNumber(candidate.confidence, 0);
  const span = Math.max(width, height);
  // 垂直外窗：靠外轮廓 + 足够跨度即可。
  // 水平外窗：仅靠轮廓易误检家具边，需强墙支撑或图例资产命中。
  const accepted = nearExterior && (
    (!horizontal && span >= 48 && (strongWallSupport || confidence >= 0.72 || assetMatched))
    || (horizontal && strongWallSupport && (assetMatched || confidence >= 0.76 || span >= 72))
  );

  return {
    accepted,
    nearExterior,
    exteriorSides: [
      nearLeft ? 'left' : '',
      nearRight ? 'right' : '',
      nearTop ? 'top' : '',
      nearBottom ? 'bottom' : ''
    ].filter(Boolean),
    strongWallSupport,
    structuralEnvelope: bounds,
    rejectReasons: [
      nearExterior ? '' : 'not-near-exterior-envelope',
      strongWallSupport || confidence >= 0.72 || assetMatched ? '' : 'weak-wall-support'
    ].filter(Boolean)
  };
}

function symbolNearExteriorRoomEdge(candidate = {}, rooms = [], walls = [], options = {}) {
  const horizontal = toNumber(candidate.width) >= toNumber(candidate.height);
  const cx = toNumber(candidate.x);
  const cy = toNumber(candidate.y);
  const spanStart = horizontal ? cx - toNumber(candidate.width) / 2 : cy - toNumber(candidate.height) / 2;
  const spanEnd = horizontal ? cx + toNumber(candidate.width) / 2 : cy + toNumber(candidate.height) / 2;
  const edgeTolerance = 42;
  const allowBoundaryReviewRooms = Boolean(options.allowBoundaryReviewRooms);

  let best = null;
  for (const room of rooms) {
    if (!['bedroom', 'living', 'dining', 'kitchen', 'balcony'].includes(room.type)) {
      continue;
    }
    if (!allowBoundaryReviewRooms && room.type !== 'balcony' && (
      room.boundaryNeedsReview
      || room.sourceEvidence?.boundaryNeedsReview
      || room.sourceEvidence?.semanticNeedsReview
    )) {
      continue;
    }

    const x = toNumber(room.x);
    const y = toNumber(room.y);
    const width = toNumber(room.width);
    const height = toNumber(room.height);
    const edges = horizontal
      ? [
        { side: 'top', y, x1: x, x2: x + width },
        { side: 'bottom', y: y + height, x1: x, x2: x + width }
      ]
      : [
        { side: 'left', x, y1: y, y2: y + height },
        { side: 'right', x: x + width, y1: y, y2: y + height }
      ];

    for (const edge of edges) {
      const fixedDistance = horizontal ? Math.abs(cy - edge.y) : Math.abs(cx - edge.x);
      if (fixedDistance > edgeTolerance) {
        continue;
      }
      const edgeStart = horizontal ? edge.x1 : edge.y1;
      const edgeEnd = horizontal ? edge.x2 : edge.y2;
      const overlap = Math.max(0, Math.min(spanEnd, edgeEnd) - Math.max(spanStart, edgeStart));
      const overlapRatio = overlap / Math.max(1, spanEnd - spanStart);
      if (overlapRatio < 0.55) {
        continue;
      }
      if (!roomEdgeFacesExterior(edge, rooms, room.id)) {
        continue;
      }
      const support = wallSupportsRoomEdge(walls, edge);
      if (!support || support.overlapRatio < 0.28) {
        continue;
      }
      const score = overlapRatio + Math.max(0, 1 - fixedDistance / edgeTolerance) * 0.35 + support.score * 0.25;
      if (!best || score > best.score) {
        best = {
          accepted: true,
          roomId: room.id,
          roomType: room.type,
          edge: edge.side,
          fixedDistance: Number(fixedDistance.toFixed(1)),
          overlapRatio: Number(overlapRatio.toFixed(3)),
          wallSupport: {
            wallCandidateId: support.wall.id,
            distance: Number(support.fixedDistance.toFixed(1)),
            overlapRatio: Number(support.overlapRatio.toFixed(3)),
            score: Number(support.score.toFixed(3))
          },
          score
        };
      }
    }
  }

  return best || { accepted: false };
}

function roomEdgeFacesExterior(edge = {}, rooms = [], sourceRoomId = '') {
  const horizontal = edge.side === 'top' || edge.side === 'bottom';
  const samples = [0.22, 0.5, 0.78].map((ratio) => {
    if (horizontal) {
      const x = edge.x1 + (edge.x2 - edge.x1) * ratio;
      return {
        x,
        y: edge.y + (edge.side === 'top' ? -28 : 28)
      };
    }
    const y = edge.y1 + (edge.y2 - edge.y1) * ratio;
    return {
      x: edge.x + (edge.side === 'left' ? -28 : 28),
      y
    };
  });

  const occupiedOutsideSamples = samples.filter((point) => rooms.some((room) => (
    room.id !== sourceRoomId
    && pointInsideRect(room, point, -2)
  ))).length;
  return occupiedOutsideSamples === 0;
}

function pointNearAnyRoomEdge(point = {}, rooms = [], tolerance = 24) {
  let best = null;
  for (const room of rooms) {
    if (!pointInsideRect(room, point, tolerance)) {
      continue;
    }
    const distances = [
      { edge: 'top', distance: Math.abs(toNumber(point.y) - toNumber(room.y)) },
      { edge: 'bottom', distance: Math.abs(toNumber(point.y) - (toNumber(room.y) + toNumber(room.height))) },
      { edge: 'left', distance: Math.abs(toNumber(point.x) - toNumber(room.x)) },
      { edge: 'right', distance: Math.abs(toNumber(point.x) - (toNumber(room.x) + toNumber(room.width))) }
    ].sort((a, b) => a.distance - b.distance);
    const nearest = distances[0];
    if (nearest.distance > tolerance) {
      continue;
    }
    const score = Math.max(0, 1 - nearest.distance / tolerance) + toNumber(room.confidence, 0.6) * 0.2;
    if (!best || score > best.score) {
      best = {
        accepted: true,
        roomId: room.id || '',
        roomType: room.type || '',
        edge: nearest.edge,
        distance: Number(nearest.distance.toFixed(1)),
        score: Number(score.toFixed(3))
      };
    }
  }

  return best || { accepted: false };
}

function pointInsideRawBalconyCandidate(point = {}, preprocessing = {}) {
  return (preprocessing?.geometryCandidates?.balconyCandidates || []).find((candidate) => (
    pointInsideRect(candidate, point, 18)
  )) || null;
}

function getStructuralEnvelope(preprocessing = {}) {
  const lines = (preprocessing?.geometryCandidates?.lines || [])
    .filter((line) => line.source === 'morphology-wall-band' || line.source === 'wall-grid-support-line')
    .filter((line) => ['horizontal', 'vertical'].includes(line.orientation))
    .filter((line) => toNumber(line.length, 0) >= 80)
    .filter((line) => toNumber(line.thickness, 0) >= 9 || line.source === 'morphology-wall-band');

  const horizontal = lines.filter((line) => line.orientation === 'horizontal');
  const vertical = lines.filter((line) => line.orientation === 'vertical');
  if (horizontal.length >= 2 && vertical.length >= 2) {
    const strongHorizontal = horizontal
      .filter((line) => toNumber(line.length, 0) >= 110)
      .sort((a, b) => toNumber(b.length, 0) - toNumber(a.length, 0))
      .slice(0, Math.max(4, Math.ceil(horizontal.length * 0.55)));
    const strongVertical = vertical
      .filter((line) => toNumber(line.length, 0) >= 80)
      .sort((a, b) => toNumber(b.length, 0) - toNumber(a.length, 0))
      .slice(0, Math.max(4, Math.ceil(vertical.length * 0.55)));
    const yValues = (strongHorizontal.length >= 2 ? strongHorizontal : horizontal)
      .map((line) => (toNumber(line.start?.y) + toNumber(line.end?.y)) / 2);
    const xValues = (strongVertical.length >= 2 ? strongVertical : vertical)
      .map((line) => (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const padding = Math.max(48, Math.min(toNumber(preprocessing?.image?.width, 0), toNumber(preprocessing?.image?.height, 0)) * 0.055);
    return {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.max(320, maxX - minX + padding * 2),
      height: Math.max(240, maxY - minY + padding * 2),
      source: 'strong-structural-axis-envelope'
    };
  }

  return {
    ...getGeometryBounds(preprocessing),
    source: 'geometry-bounds-fallback'
  };
}

function inferWindowsFromSymbolCandidates(preprocessing = {}, rooms = [], walls = []) {
  const candidates = preprocessing?.geometryCandidates?.windowSymbolCandidates || [];
  return candidates
    .filter((candidate) => toNumber(candidate.confidence, 0) >= 0.5)
    .map((candidate, index) => {
      const horizontal = candidate.orientation === 'horizontal';
      const center = candidate.center || {};
      const width = Math.max(horizontal ? 44 : 8, toNumber(candidate.width, horizontal ? 56 : 8));
      const height = Math.max(horizontal ? 8 : 44, toNumber(candidate.height, horizontal ? 8 : 56));
      const assetMatch = candidate.assetMatch || null;
      const assetMatched = Boolean(assetMatch?.assetId);
      const wallScore = toNumber(candidate.wallSupport?.score, 0);
      const opening = {
        id: `window-symbol-${index + 1}`,
        type: 'window',
        x: toNumber(center.x, toNumber(candidate.x) + toNumber(candidate.width) / 2),
        y: toNumber(center.y, toNumber(candidate.y) + toNumber(candidate.height) / 2),
        width: horizontal ? width : 8,
        height: horizontal ? 8 : height,
        confidence: Number(Math.min(0.9, toNumber(candidate.confidence, 0.58) + (candidate.wallSupport ? 0.04 : 0) + (assetMatched ? 0.03 : 0)).toFixed(2)),
        source: 'window-symbol-scanner',
        sourceEvidence: {
          scannerId: candidate.id,
          scannerSource: candidate.source,
          orientation: candidate.orientation,
          lineGap: candidate.lineGap,
          pairedLineOverlap: candidate.pairedLineOverlap,
          nearEnvelope: candidate.nearEnvelope,
          wallSupport: candidate.wallSupport || null,
          assetMatch,
          windowType: candidate.windowType || '',
          inferredFrom: 'parallel-thin-lines-near-wall'
        }
      };
      const exterior = classifyExteriorWindowCandidate(opening, preprocessing);
      const allowBoundaryReviewRooms = assetMatched || wallScore >= 1.15 || Boolean(candidate.nearEnvelope);
      const roomEdge = exterior.accepted
        ? { accepted: false }
        : symbolNearExteriorRoomEdge(opening, rooms, walls, { allowBoundaryReviewRooms });
      const horizontalRoomEdgeNeedsGapReview = horizontal
        && roomEdge.roomType !== 'balcony'
        && wallScore < 1.2
        && !assetMatched;
      const supportedRoom = rooms.find((room) => room.id === roomEdge.roomId);
      const supportedEdgeLength = horizontal
        ? toNumber(supportedRoom?.width)
        : toNumber(supportedRoom?.height);
      const balconySpanRatio = supportedEdgeLength > 0
        ? Math.max(width, height) / supportedEdgeLength
        : 0;
      const shortBalconyEdgeSymbol = roomEdge.roomType === 'balcony' && balconySpanRatio < 0.55;
      const weakInteriorVerticalFrame = Boolean(
        !horizontal
        && roomEdge.accepted
        && !exterior.nearExterior
        && toNumber(candidate.lineGap, 0) < 11
        && !assetMatched
      );
      let acceptedAsExteriorWindow = exterior.accepted
        || (roomEdge.accepted && !horizontalRoomEdgeNeedsGapReview && !shortBalconyEdgeSymbol && !weakInteriorVerticalFrame);
      let fallbackRoomEdge = acceptedAsExteriorWindow ? { accepted: false } : pointNearAnyRoomEdge({ x: opening.x, y: opening.y }, rooms, 32);
      const strongWallSupport = exterior.strongWallSupport || wallScore >= 1.15;
      // 图例资产命中 + 强墙支撑：即使房间边界仍需复核，也晋升为确认窗
      const assetWallAccepted = Boolean(
        !acceptedAsExteriorWindow
        && assetMatched
        && strongWallSupport
        && toNumber(candidate.confidence, 0) >= 0.6
        && (
          candidate.nearEnvelope
          || exterior.nearExterior
          || roomEdge.accepted
          || fallbackRoomEdge.accepted
          || wallScore >= 1.35
        )
      );
      if (assetWallAccepted) {
        acceptedAsExteriorWindow = true;
      }
      const proposedRecessWindowFrame = Boolean(
        !horizontal
        && !acceptedAsExteriorWindow
        && toNumber(candidate.lineGap, 0) >= 11
        && wallScore >= 1.15
        && fallbackRoomEdge.accepted
      );
      const rawBalconyCandidate = pointInsideRawBalconyCandidate({ x: opening.x, y: opening.y }, preprocessing);
      const proposedStrongWallWindowCandidate = Boolean(
        !acceptedAsExteriorWindow
        && strongWallSupport
        && fallbackRoomEdge.accepted
        && !rawBalconyCandidate
      );
      const proposedRawBalconyWindowCandidate = Boolean(
        !acceptedAsExteriorWindow
        && strongWallSupport
        && rawBalconyCandidate
      );
      return {
        ...opening,
        sourceEvidence: {
          ...opening.sourceEvidence,
          acceptedAsExteriorWindow,
          assetWallAccepted: assetWallAccepted || undefined,
          nearExteriorEnvelope: exterior.nearExterior,
          exteriorSides: exterior.exteriorSides,
          strongWallSupport,
          roomEdgeSupport: roomEdge.accepted ? roomEdge : null,
          fallbackRoomEdgeSupport: fallbackRoomEdge.accepted ? fallbackRoomEdge : null,
          rawBalconyCandidateId: rawBalconyCandidate?.id || '',
          balconySpanRatio: Number(balconySpanRatio.toFixed(3)),
          rejectedShortBalconyEdgeSymbol: shortBalconyEdgeSymbol || undefined,
          rejectedWeakInteriorVerticalFrame: weakInteriorVerticalFrame || undefined,
          proposedRecessWindowFrame: proposedRecessWindowFrame || undefined,
          proposedStrongWallWindowCandidate,
          proposedRawBalconyWindowCandidate,
          confirmedOpening: acceptedAsExteriorWindow || undefined,
          needsVisualConfirmation: acceptedAsExteriorWindow
            ? undefined
            : (proposedStrongWallWindowCandidate || proposedRawBalconyWindowCandidate || undefined),
          symbolRejectReasons: acceptedAsExteriorWindow || proposedStrongWallWindowCandidate || proposedRawBalconyWindowCandidate ? [] : exterior.rejectReasons
        }
      };
    });
}

function pointInsideRect(rect = {}, point = {}, tolerance = 0) {
  return point.x >= toNumber(rect.x) - tolerance
    && point.y >= toNumber(rect.y) - tolerance
    && point.x <= toNumber(rect.x) + toNumber(rect.width) + tolerance
    && point.y <= toNumber(rect.y) + toNumber(rect.height) + tolerance;
}

function inferSymbolSemanticType(symbol = {}) {
  const type = symbol.type || symbol.kind || '';
  if (type === 'bed') {
    return 'bedroom';
  }
  if (type === 'sofa_or_table') {
    return 'living';
  }
  if (type === 'bath_fixture_or_appliance') {
    return 'bathroom';
  }
  if (type === 'table_or_fixture') {
    return 'dining';
  }
  return '';
}

function assignEvidenceSymbols(symbols = [], rooms = []) {
  return symbols.map((symbol) => {
    const center = symbol.center || {
      x: toNumber(symbol.x) + toNumber(symbol.width) / 2,
      y: toNumber(symbol.y) + toNumber(symbol.height) / 2
    };
    const room = rooms.find((candidate) => pointInsideRect(candidate, center, 10));
    return {
      ...symbol,
      center,
      roomId: room?.id || '',
      roomName: room?.name || '',
      semanticHint: '',
      accepted: false,
      modelRole: 'evidence-only',
      rejectReasons: ['mep-or-electrical-evidence-only']
    };
  });
}

function assignSymbolsToRooms(symbols = [], rooms = []) {
  return symbols.map((symbol) => {
    const center = symbol.center || {
      x: toNumber(symbol.x) + toNumber(symbol.width) / 2,
      y: toNumber(symbol.y) + toNumber(symbol.height) / 2
    };
    const room = rooms.find((candidate) => pointInsideRect(candidate, center, 10));
    const semanticHint = inferSymbolSemanticType(symbol);
    const roomType = room?.type || '';
    const semanticConflict = Boolean(semanticHint && roomType && roomType !== 'space' && roomType !== semanticHint && !(
      semanticHint === 'living' && ['living', 'dining'].includes(roomType)
    ) && !(
      semanticHint === 'dining' && ['living', 'dining', 'kitchen'].includes(roomType)
    ));
    const outsideModeledSpace = !room;
    const accepted = !semanticConflict && !outsideModeledSpace && toNumber(symbol.confidence, 0) >= 0.54;
    return {
      ...symbol,
      center,
      roomId: room?.id || '',
      roomName: room?.name || '',
      semanticHint,
      accepted,
      modelRole: accepted ? 'accepted-symbol' : 'evidence-only',
      rejectReasons: [
        semanticConflict ? `semantic-conflict-with-${roomType}` : '',
        outsideModeledSpace ? 'outside-modeled-room' : '',
        toNumber(symbol.confidence, 0) < 0.54 ? 'low-confidence-symbol' : ''
      ].filter(Boolean)
    };
  });
}

function wallLength(wall = {}) {
  return Math.hypot(
    toNumber(wall.end?.x) - toNumber(wall.start?.x),
    toNumber(wall.end?.y) - toNumber(wall.start?.y)
  );
}

function buildWallShell3d(wall = {}, index = 0) {
  const thicknessMm = Math.max(90, Math.round(toNumber(wall.thickness, 12) * 10));
  const heightMm = wall.wallRole === 'exterior' || wall.isExterior ? 3000 : 2800;
  return {
    id: `wall-shell-${index + 1}`,
    sourceWallId: wall.id || '',
    start: wall.start || { x: 0, y: 0 },
    end: wall.end || { x: 0, y: 0 },
    lengthPx: Number(wallLength(wall).toFixed(2)),
    thicknessPx: toNumber(wall.thickness, 12),
    thicknessMm,
    heightMm,
    role: wall.wallRole || (wall.isExterior ? 'exterior' : 'interior'),
    confidence: toNumber(wall.confidence, 0.65)
  };
}

function lineAxisSignature(line = {}) {
  const orientation = line.orientation || (Math.abs(toNumber(line.end?.x) - toNumber(line.start?.x)) >= Math.abs(toNumber(line.end?.y) - toNumber(line.start?.y)) ? 'horizontal' : 'vertical');
  const fixed = orientation === 'horizontal'
    ? (toNumber(line.start?.y) + toNumber(line.end?.y)) / 2
    : (toNumber(line.start?.x) + toNumber(line.end?.x)) / 2;
  const start = orientation === 'horizontal'
    ? Math.min(toNumber(line.start?.x), toNumber(line.end?.x))
    : Math.min(toNumber(line.start?.y), toNumber(line.end?.y));
  const end = orientation === 'horizontal'
    ? Math.max(toNumber(line.start?.x), toNumber(line.end?.x))
    : Math.max(toNumber(line.start?.y), toNumber(line.end?.y));
  return { orientation, fixed, start, end };
}

function lineOverlapRatio(a = {}, b = {}, tolerance = 18) {
  const ax = lineAxisSignature(a);
  const bx = lineAxisSignature(b);
  if (ax.orientation !== bx.orientation || Math.abs(ax.fixed - bx.fixed) > tolerance) {
    return 0;
  }
  const overlap = Math.max(0, Math.min(ax.end, bx.end) - Math.max(ax.start, bx.start));
  return overlap / Math.max(1, Math.min(ax.end - ax.start, bx.end - bx.start));
}

function buildWallRecognitionStage(preprocessing = {}, walls = []) {
  const rawCandidates = (preprocessing?.geometryCandidates?.lines || [])
    .filter((line) => line.source === 'morphology-wall-band' || line.source === 'wall-grid-support-line')
    .filter((line) => ['horizontal', 'vertical'].includes(line.orientation));
  const acceptedSourceIds = new Set(walls.map((wall) => wall.sourceCandidateId).filter(Boolean));
  const accepted = walls.map((wall) => ({
    id: wall.id,
    sourceCandidateId: wall.sourceCandidateId || '',
    start: wall.start,
    end: wall.end,
    orientation: wall.orientation,
    thickness: wall.thickness,
    wallRole: wall.wallRole || '',
    confidence: wall.confidence,
    length: Number(wallLength(wall).toFixed(2))
  }));
  const rejected = rawCandidates
    .filter((candidate) => !acceptedSourceIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      start: candidate.start,
      end: candidate.end,
      orientation: candidate.orientation,
      thickness: candidate.thickness,
      confidence: candidate.confidence,
      rejectReasons: candidate.wallRejectReasons || candidate.wallEvidence?.rejectReasons || []
    }));
  const rawMatchedCount = rawCandidates.filter((candidate) => walls.some((wall) => lineOverlapRatio(candidate, wall) >= 0.62)).length;
  const acceptedMatchedCount = walls.filter((wall) => rawCandidates.some((candidate) => lineOverlapRatio(candidate, wall) >= 0.62)).length;
  const rawCoverageRatio = rawCandidates.length ? rawMatchedCount / rawCandidates.length : 0;
  const acceptedEvidenceRatio = walls.length ? acceptedMatchedCount / walls.length : 0;
  const wallShells = walls.map(buildWallShell3d);
  const review = [];
  const fixes = [];

  if (rawCoverageRatio < 0.58) {
    review.push('accepted-wall-coverage-low');
    fixes.push({ type: 'recover-wall-candidates', reason: 'raw-wall-candidates-not-covered-by-accepted-model' });
  }
  if (acceptedEvidenceRatio < 0.72) {
    review.push('accepted-walls-have-weak-raw-evidence');
    fixes.push({ type: 'prune-or-reattach-weak-walls', reason: 'accepted-walls-not-supported-by-raw-candidates' });
  }
  if (walls.length < 8) {
    review.push('wall-count-too-low-for-apartment-shell');
  }

  return {
    stage: 'walls',
    status: review.length ? 'review_required' : 'passed',
    rawCandidates,
    accepted,
    rejected,
    model3d: {
      type: 'wall-shell-prisms',
      unit: 'image-pixel-derived-mm',
      wallShells
    },
    projection2d: {
      type: 'wall-centerline-projection',
      lines: accepted
    },
    metrics: {
      rawCandidateCount: rawCandidates.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      rawCoverageRatio: Number(rawCoverageRatio.toFixed(3)),
      acceptedEvidenceRatio: Number(acceptedEvidenceRatio.toFixed(3)),
      shellCount: wallShells.length
    },
    review,
    fixes
  };
}

function buildOpening3d(opening = {}, index = 0) {
  const isWindow = opening.type === 'window';
  return {
    id: `opening-cut-${index + 1}`,
    sourceOpeningId: opening.id || '',
    type: opening.type || 'opening',
    attachedWallId: opening.attachedWallId || opening.sourceEvidence?.attachedWallId || '',
    center: {
      x: toNumber(opening.x),
      y: toNumber(opening.y)
    },
    widthPx: toNumber(opening.width, isWindow ? 56 : 28),
    heightPx: toNumber(opening.height, isWindow ? 8 : 28),
    sillHeightMm: isWindow ? 900 : 0,
    cutHeightMm: isWindow ? 1200 : 2100,
    confidence: toNumber(opening.confidence, 0.62),
    source: opening.source || ''
  };
}

function buildOpeningsRecognitionStage(preprocessing = {}, doors = [], windows = [], rooms = [], walls = []) {
  const rawWindowSymbols = inferWindowsFromSymbolCandidates(preprocessing, rooms, walls);
  const rawDoorSymbols = inferDoorsFromSymbolCandidates(preprocessing);
  const acceptedWindowIds = new Set(windows.map((window) => window.sourceEvidence?.scannerId || window.id).filter(Boolean));
  const acceptedDoorIds = new Set(doors.map((door) => door.sourceEvidence?.scannerId || door.id).filter(Boolean));
  const confirmedWindows = windows.filter((window) => !window.sourceEvidence?.needsVisualConfirmation && window.source !== 'semantic-room-opening-prior');
  const proposedWindows = windows.filter((window) => window.sourceEvidence?.needsVisualConfirmation || window.source === 'semantic-room-opening-prior');
  const confirmedDoors = doors.filter((door) => !door.sourceEvidence?.needsVisualConfirmation && door.source !== 'semantic-room-opening-prior');
  const proposedDoors = doors.filter((door) => door.sourceEvidence?.needsVisualConfirmation || door.source === 'semantic-room-opening-prior');
  const rejectedWindowSymbols = rawWindowSymbols
    .filter((candidate) => !acceptedWindowIds.has(candidate.sourceEvidence?.scannerId || candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      type: 'window',
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      confidence: candidate.confidence,
      rejectReasons: candidate.sourceEvidence?.symbolRejectReasons || []
    }));
  const rejectedDoorSymbols = rawDoorSymbols
    .filter((candidate) => !acceptedDoorIds.has(candidate.sourceEvidence?.scannerId || candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      type: 'door',
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      confidence: candidate.confidence,
      rejectReasons: []
    }));
  const accepted = {
    doors: doors.map((door) => ({
      id: door.id,
      type: 'door',
      x: door.x,
      y: door.y,
      width: door.width,
      height: door.height,
      attachedWallId: door.attachedWallId || '',
      confidence: door.confidence,
      source: door.source || '',
      sourceEvidence: door.sourceEvidence || {},
      reviewReasons: door.reviewReasons || []
    })),
    windows: windows.map((window) => ({
      id: window.id,
      type: 'window',
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
      attachedWallId: window.attachedWallId || '',
      confidence: window.confidence,
      source: window.source || '',
      scannerId: window.sourceEvidence?.scannerId || ''
    }))
  };
  const allAccepted = [...doors, ...windows];
  const confirmedOpenings = [...confirmedDoors, ...confirmedWindows];
  const proposedOpenings = [...proposedDoors, ...proposedWindows];
  const attachedCount = allAccepted.filter((opening) => opening.attachedWallId || opening.sourceEvidence?.attachedWallId).length;
  const visualDoorCount = doors.filter((door) => door.source && door.source !== 'semantic-room-opening-prior').length;
  const semanticDoorCount = doors.filter((door) => door.source === 'semantic-room-opening-prior').length;
  const visualWindowCount = confirmedWindows.length;
  const proposedWindowCount = proposedWindows.length;
  const review = [];
  const fixes = [];
  if (!visualDoorCount && doors.length) {
    review.push('visual-door-scanner-missing');
    fixes.push({ type: 'detect-door-arcs-and-leaf-lines', reason: 'doors-currently-semantic-only' });
  }
  if (semanticDoorCount) {
    review.push('semantic-door-priors-need-visual-confirmation');
    fixes.push({ type: 'confirm-or-prune-semantic-door-priors', reason: 'some-doors-are-room-priors-not-visual-detections' });
  }
  if (rawWindowSymbols.length && visualWindowCount < Math.max(1, Math.round(rawWindowSymbols.length * 0.25))) {
    review.push('low-window-symbol-acceptance');
    fixes.push({ type: 'local-exterior-wall-check', reason: 'window-symbols-rejected-by-global-envelope' });
  }
  if (allAccepted.length && attachedCount < allAccepted.length) {
    review.push('unattached-openings');
    fixes.push({ type: 'reattach-openings-to-nearest-wall', reason: 'opening-without-wall-attachment' });
  }

  return {
    stage: 'openings',
    status: review.length ? 'review_required' : (allAccepted.length ? 'passed' : 'missing'),
    rawCandidates: {
      windowSymbols: rawWindowSymbols,
      doorSymbols: rawDoorSymbols
    },
    accepted,
    rejected: {
      windowSymbols: rejectedWindowSymbols,
      doorSymbols: rejectedDoorSymbols
    },
    model3d: {
      type: 'wall-opening-cuts',
      openings: allAccepted.map(buildOpening3d),
      confirmedOpenings: confirmedOpenings.map(buildOpening3d),
      proposedOpenings: proposedOpenings.map(buildOpening3d)
    },
    projection2d: {
      type: 'opening-centerline-projection',
      doors: accepted.doors,
      windows: accepted.windows
    },
    metrics: {
      rawWindowSymbolCount: rawWindowSymbols.length,
      rawDoorSymbolCount: rawDoorSymbols.length,
      acceptedWindowCount: confirmedWindows.length,
      acceptedDoorCount: confirmedDoors.length,
      proposedWindowCount,
      proposedDoorCount: proposedDoors.length,
      rejectedWindowSymbolCount: rejectedWindowSymbols.length,
      rejectedDoorSymbolCount: rejectedDoorSymbols.length,
      visualDoorCount,
      semanticDoorCount,
      visualWindowCount,
      confirmed3dCutCount: confirmedOpenings.length,
      proposedOpeningCount: proposedOpenings.length,
      attachedOpeningRatio: allAccepted.length ? Number((attachedCount / allAccepted.length).toFixed(3)) : 0
    },
    review,
    fixes
  };
}

function buildRoomVolume3d(room = {}, index = 0) {
  const type = room.type || 'space';
  const isBalcony = type === 'balcony';
  return {
    id: `room-volume-${index + 1}`,
    sourceRoomId: room.id || '',
    type,
    name: room.name || type,
    bounds: {
      x: toNumber(room.x),
      y: toNumber(room.y),
      width: toNumber(room.width),
      height: toNumber(room.height)
    },
    floorHeightMm: 0,
    ceilingHeightMm: isBalcony ? 2800 : 3000,
    slabThicknessMm: isBalcony ? 100 : 120,
    confidence: toNumber(room.confidence, 0.62),
    source: room.source || '',
    reviewRequired: Boolean(
      room.boundaryNeedsReview
      || room.semanticNeedsReview
      || room.sourceEvidence?.boundaryNeedsReview
      || room.sourceEvidence?.semanticNeedsReview
    )
  };
}

function rectOverlapRatio(a = {}, b = {}) {
  const ax1 = toNumber(a.x);
  const ay1 = toNumber(a.y);
  const ax2 = ax1 + toNumber(a.width);
  const ay2 = ay1 + toNumber(a.height);
  const bx1 = toNumber(b.x);
  const by1 = toNumber(b.y);
  const bx2 = bx1 + toNumber(b.width);
  const by2 = by1 + toNumber(b.height);
  const overlapWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const overlapHeight = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const overlap = overlapWidth * overlapHeight;
  const smallerArea = Math.max(1, Math.min(toNumber(a.width) * toNumber(a.height), toNumber(b.width) * toNumber(b.height)));
  return overlap / smallerArea;
}

function classifyRejectedBalconyCandidate(candidate = {}, acceptedRooms = [], preprocessing = {}) {
  const overlappingRooms = acceptedRooms
    .filter((room) => room.type !== 'balcony')
    .map((room) => ({
      id: room.id,
      type: room.type,
      overlapRatio: Number(rectOverlapRatio(candidate, room).toFixed(3))
    }))
    .filter((room) => room.overlapRatio >= 0.35)
    .sort((a, b) => b.overlapRatio - a.overlapRatio);

  if (isMergedBayWindowOutlineCandidate(candidate, preprocessing)) {
    return {
      classifiedAs: 'merged-bay-window-outline-false-positive',
      rejectReasons: ['multiple-bay-window-outlines-merged-by-horizontal-line', 'not-a-balcony-room'],
      overlappingRooms
    };
  }

  if (
    toNumber(candidate.confidence, 0) >= 0.78
    && (candidate.nearStructuralWall || candidate.nearImageEdge)
    && (overlappingRooms.length >= 2 || overlappingRooms.some((room) => room.overlapRatio >= 0.42))
  ) {
    return {
      classifiedAs: 'balcony-room-boundary-conflict',
      rejectReasons: ['overlaps-accepted-room-model', 'requires-room-boundary-split-or-trim'],
      overlappingRooms
    };
  }

  if (overlappingRooms.length >= 2 || overlappingRooms.some((room) => room.overlapRatio >= 0.62)) {
    return {
      classifiedAs: 'room-outline-false-positive',
      rejectReasons: ['overlaps-accepted-room-model'],
      overlappingRooms
    };
  }

  const aspectRatio = toNumber(candidate.aspectRatio, toNumber(candidate.width) / Math.max(1, toNumber(candidate.height)));
  const area = toNumber(candidate.area, toNumber(candidate.width) * toNumber(candidate.height));
  if (aspectRatio > 2.35 && area > 52000) {
    return {
      classifiedAs: 'wide-outline-false-positive',
      rejectReasons: ['too-wide-for-single-balcony-without-room-match'],
      overlappingRooms
    };
  }

  return {
    classifiedAs: 'unresolved-balcony-candidate',
    rejectReasons: ['not-selected-as-balcony-room'],
    overlappingRooms
  };
}

function buildRoomRecognitionStage(preprocessing = {}, rooms = []) {
  const rawRoomInteriors = preprocessing?.geometryCandidates?.roomInteriorCandidates || [];
  const rawBalconyCandidates = preprocessing?.geometryCandidates?.balconyCandidates || [];
  const accepted = rooms.map((room) => ({
    id: room.id,
    name: room.name,
    type: room.type,
    x: room.x,
    y: room.y,
    width: room.width,
    height: room.height,
    area: room.area,
    confidence: room.confidence,
    source: room.source || '',
    sourceEvidence: room.sourceEvidence || {},
    boundaryNeedsReview: Boolean(room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview),
    semanticNeedsReview: Boolean(room.semanticNeedsReview || room.sourceEvidence?.semanticNeedsReview)
  }));
  const acceptedInteriorIds = new Set(accepted.map((room) => room.sourceEvidence?.roomInteriorCandidateId).filter(Boolean));
  const acceptedBalconyIds = new Set(accepted.map((room) => room.sourceEvidence?.balconyCandidateId).filter(Boolean));
  const rejectedRoomInteriors = rawRoomInteriors
    .filter((candidate) => !acceptedInteriorIds.has(candidate.id) && !rooms.some((room) => rectOverlapRatio(candidate, room) >= 0.72))
    .map((candidate) => ({
      id: candidate.id,
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      confidence: candidate.confidence,
      source: candidate.source || '',
      rejectReasons: ['not-selected-by-room-grid-or-overlap']
    }));
  const rejectedBalconyCandidates = rawBalconyCandidates
    .filter((candidate) => !acceptedBalconyIds.has(candidate.id) && !rooms.some((room) => room.type === 'balcony' && rectOverlapRatio(candidate, room) >= 0.55))
    .map((candidate) => {
      const classification = classifyRejectedBalconyCandidate(candidate, accepted, preprocessing);
      return {
        id: candidate.id,
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
        confidence: candidate.confidence,
        source: candidate.source || '',
        classifiedAs: classification.classifiedAs,
        rejectReasons: classification.rejectReasons,
        overlappingRooms: classification.overlappingRooms
      };
    });
  const rawInteriorMatchedCount = rawRoomInteriors.filter((candidate) => rooms.some((room) => rectOverlapRatio(candidate, room) >= 0.55)).length;
  const acceptedGeometrySupportedCount = accepted.filter((room) => rawRoomInteriors.some((candidate) => rectOverlapRatio(candidate, room) >= 0.5)).length;
  const acceptedBalconyRooms = accepted.filter((room) => room.type === 'balcony');
  const balconyCandidateMatchedCount = rawBalconyCandidates.filter((candidate) => acceptedBalconyRooms.some((room) => rectOverlapRatio(candidate, room) >= 0.55)).length;
  const acceptedBalconyWithCandidateEvidenceCount = acceptedBalconyRooms.filter((room) => rawBalconyCandidates.some((candidate) => rectOverlapRatio(candidate, room) >= 0.55)).length;
  const unresolvedRejectedBalconyCount = rejectedBalconyCandidates.filter((candidate) => candidate.classifiedAs === 'unresolved-balcony-candidate').length;
  const balconyRoomBoundaryConflictCount = rejectedBalconyCandidates.filter((candidate) => candidate.classifiedAs === 'balcony-room-boundary-conflict').length;
  const falsePositiveBalconyCount = rejectedBalconyCandidates.length - unresolvedRejectedBalconyCount - balconyRoomBoundaryConflictCount;
  const boundaryReviewCount = accepted.filter((room) => room.boundaryNeedsReview).length;
  const semanticReviewCount = accepted.filter((room) => room.semanticNeedsReview).length;
  const acceptedBalconyCount = acceptedBalconyRooms.length;
  const review = [];
  const fixes = [];
  if (rooms.length < 2) {
    review.push('room-count-too-low');
    fixes.push({ type: 'recover-room-voids-from-wall-grid', reason: 'accepted-room-count-too-low' });
  }
  if (rawBalconyCandidates.length && !acceptedBalconyCount) {
    review.push('balcony-candidates-not-accepted');
    fixes.push({ type: 'promote-or-reject-balcony-candidates', reason: 'raw-balcony-candidate-without-accepted-balcony-room' });
  }
  if (acceptedBalconyCount && acceptedBalconyWithCandidateEvidenceCount < acceptedBalconyCount) {
    review.push('accepted-balcony-without-visual-balcony-candidate');
    fixes.push({ type: 'reattach-balcony-room-to-visual-candidate', reason: 'accepted-balcony-room-does-not-overlap-raw-balcony-candidate' });
  }
  if (unresolvedRejectedBalconyCount) {
    review.push('unresolved-raw-balcony-candidates');
    fixes.push({ type: 'classify-raw-balcony-candidates-as-balcony-or-annotation', reason: 'some-raw-balcony-candidates-were-not-classified' });
  }
  if (balconyRoomBoundaryConflictCount) {
    review.push('balcony-room-boundary-conflict');
    fixes.push({ type: 'split-or-trim-rooms-overlapping-balcony-candidates', reason: 'high-confidence-balcony-candidate-covered-by-accepted-room-model' });
  }
  if (boundaryReviewCount) {
    review.push('room-boundary-review-required');
    fixes.push({ type: 'close-room-boundaries-against-wall-model', reason: 'accepted-rooms-have-weak-boundary-evidence' });
  }
  if (semanticReviewCount) {
    review.push('room-semantic-review-required');
    fixes.push({ type: 'confirm-room-labels-with-ocr-and-layout', reason: 'room-type-derived-from-weak-semantic-prior' });
  }

  const roomVolumes = accepted.map(buildRoomVolume3d);
  const rawCoverageRatio = rawRoomInteriors.length ? rawInteriorMatchedCount / rawRoomInteriors.length : 0;
  const acceptedEvidenceRatio = accepted.length ? acceptedGeometrySupportedCount / accepted.length : 0;

  return {
    stage: 'rooms',
    status: review.length ? 'review_required' : (accepted.length ? 'passed' : 'missing'),
    rawCandidates: {
      roomInteriors: rawRoomInteriors,
      balconyCandidates: rawBalconyCandidates
    },
    accepted,
    rejected: {
      roomInteriors: rejectedRoomInteriors,
      balconyCandidates: rejectedBalconyCandidates
    },
    model3d: {
      type: 'room-floor-and-volume-prisms',
      roomVolumes
    },
    projection2d: {
      type: 'room-volume-footprint-projection',
      rooms: accepted
    },
    metrics: {
      rawRoomInteriorCandidateCount: rawRoomInteriors.length,
      rawBalconyCandidateCount: rawBalconyCandidates.length,
      acceptedCount: accepted.length,
      acceptedBalconyCount,
      balconyCandidateMatchedCount,
      acceptedBalconyWithCandidateEvidenceCount,
      falsePositiveBalconyCount,
      unresolvedRejectedBalconyCount,
      balconyRoomBoundaryConflictCount,
      rejectedRoomInteriorCount: rejectedRoomInteriors.length,
      rejectedBalconyCandidateCount: rejectedBalconyCandidates.length,
      boundaryReviewCount,
      semanticReviewCount,
      rawCoverageRatio: Number(rawCoverageRatio.toFixed(3)),
      acceptedEvidenceRatio: Number(acceptedEvidenceRatio.toFixed(3)),
      volumeCount: roomVolumes.length
    },
    review,
    fixes
  };
}

function buildRecognitionStages({ preprocessing = {}, rooms = [], walls = [], doors = [], windows = [] }) {
  return [
    {
      stage: 'annotation',
      status: preprocessing?.geometryCandidates?.annotationSymbolCandidateCount ? 'passed' : 'empty',
      rawCandidates: preprocessing?.geometryCandidates?.annotationSymbolCandidates || [],
      metrics: {
        rawCandidateCount: preprocessing?.geometryCandidates?.annotationSymbolCandidateCount || 0
      }
    },
    buildWallRecognitionStage(preprocessing, walls),
    buildRoomRecognitionStage(preprocessing, rooms),
    buildOpeningsRecognitionStage(preprocessing, doors, windows, rooms, walls)
  ];
}

function buildScannerCatalog() {
  const recognitionAssets = summarizeRecognitionAssetsForDraft();
  const bindings = recognitionAssets.scannerBindings || {};

  return [
    {
      id: 'structural-wall-scanner',
      group: 'structural',
      targets: ['exterior_wall', 'interior_wall', 'wall_band', 'load_bearing_wall', 'shear_wall', 'curtain_wall', 'glass_partition', 'demolished_wall'],
      assetIds: (bindings['structural-wall-scanner'] || []).map((item) => item.id),
      output: 'walls'
    },
    {
      id: 'room-void-scanner',
      group: 'spaces',
      targets: ['room_boundary', 'room_cell', 'balcony_candidate', 'terrace_candidate', 'courtyard_candidate'],
      assetIds: (bindings['room-void-scanner'] || []).map((item) => item.id),
      output: 'rooms'
    },
    {
      id: 'door-opening-scanner',
      group: 'openings',
      targets: ['door_leaf', 'swing_arc', 'gap_on_wall', 'sliding_door', 'folding_door', 'pocket_door', 'arch_door', 'entrance_door', 'security_door', 'pass_through'],
      assetIds: (bindings['door-opening-scanner'] || []).map((item) => item.id),
      output: 'doors'
    },
    {
      id: 'window-symbol-scanner',
      group: 'openings',
      targets: ['parallel_thin_lines', 'bay_window_box', 'bay_window_platform', 'window_on_outer_wall', 'sliding_window', 'casement_window', 'high_window', 'french_window', 'louver_window', 'skylight'],
      assetIds: (bindings['window-symbol-scanner'] || []).map((item) => item.id),
      output: 'windows'
    },
    {
      id: 'furniture-fixture-scanner',
      group: 'symbols',
      targets: ['bed', 'sofa', 'table', 'toilet', 'sink', 'bathtub', 'stove', 'washer', 'shower', 'fridge', 'wardrobe', 'cabinet', 'nightstand', 'chair', 'dining_set', 'desk', 'tv_cabinet', 'stairs', 'railing', 'power_outlet', 'low_voltage_outlet', 'switch', 'ceiling_light', 'light_strip', 'niche', 'threshold_stone'],
      assetIds: (bindings['furniture-fixture-scanner'] || []).map((item) => item.id),
      output: 'symbols'
    },
    {
      id: 'mep-symbol-scanner',
      group: 'symbols',
      targets: ['floor_heating', 'radiator', 'hvac_indoor', 'fresh_air_vent'],
      assetIds: (bindings['mep-symbol-scanner'] || []).map((item) => item.id),
      output: 'mepSymbols'
    },
    {
      id: 'electrical-symbol-scanner',
      group: 'symbols',
      targets: ['power_outlet', 'low_voltage_outlet', 'switch_single', 'ceiling_light', 'light_strip'],
      assetIds: (bindings['electrical-symbol-scanner'] || []).map((item) => item.id),
      output: 'electricalSymbols'
    },
    {
      id: 'annotation-dimension-scanner',
      group: 'evidence',
      targets: ['dimension_text', 'auxiliary_line', 'tick_mark', 'drawing_margin_label', 'axis_bubble', 'elevation_mark', 'section_cut', 'scale_bar', 'title_block'],
      assetIds: (bindings['annotation-dimension-scanner'] || []).map((item) => item.id),
      output: 'annotationSymbols'
    },
    {
      id: 'ocr-label-scanner',
      group: 'evidence',
      targets: ['room_label', 'balcony_label', 'dimension_text'],
      assetIds: (bindings['ocr-label-scanner'] || []).map((item) => item.id),
      output: 'textLabels'
    }
  ];
}

function buildFloorplanModel({ preprocessing = {}, rooms = [], walls = [], doors = [], windows = [], ocrCandidates = [] }) {
  const geometry = preprocessing?.geometryCandidates || {};
  const furnitureSymbols = assignSymbolsToRooms(geometry.furnitureSymbolCandidates || [], rooms);
  const mepSymbols = assignEvidenceSymbols(geometry.mepSymbolCandidates || [], rooms);
  const electricalSymbols = assignEvidenceSymbols(geometry.electricalSymbolCandidates || [], rooms);
  const acceptedSymbols = furnitureSymbols.filter((symbol) => symbol.accepted);
  const textLabels = ocrCandidates.map(normalizeOcrCandidate).filter(Boolean);
  const windowSymbols = inferWindowsFromSymbolCandidates(preprocessing, rooms, walls);
  const stages = buildRecognitionStages({ preprocessing, rooms, walls, doors, windows });
  const roomSymbolEvidence = rooms.map((room) => {
    const symbols = acceptedSymbols.filter((symbol) => symbol.roomId === room.id);
    const semanticHints = [...new Set(symbols.map((symbol) => symbol.semanticHint).filter(Boolean))];
    return {
      roomId: room.id,
      roomName: room.name,
      roomType: room.type,
      symbolCount: symbols.length,
      semanticHints,
      symbols: symbols.map((symbol) => ({
        id: symbol.id,
        type: symbol.type,
        confidence: symbol.confidence,
        semanticHint: symbol.semanticHint
      }))
    };
  });

  return {
    version: '0.1.0',
    coordinateSystem: {
      unit: 'image-pixel',
      origin: 'top-left',
      image: preprocessing?.image || {}
    },
    recognitionAssets: summarizeRecognitionAssetsForDraft(),
    scannerCatalog: buildScannerCatalog(),
    stages,
    structural: {
      walls,
      exteriorEnvelope: getGeometryBounds(preprocessing),
      wallPolygons: geometry.structuralWallVectors || [],
      wallGrid: {
        lineCount: geometry.lines?.length || 0,
        wallBandCount: geometry.wallBandCount || 0,
        rejectedWallBandCount: geometry.rejectedWallBandCount || 0
      }
    },
    spaces: {
      rooms,
      roomCells: geometry.roomInteriorCandidates || [],
      balconyCandidates: geometry.balconyCandidates || [],
      roomSymbolEvidence
    },
    openings: {
      doors,
      windows,
      windowSymbols,
      windowSymbolCount: windowSymbols.length
    },
    symbols: {
      furniture: acceptedSymbols.filter((symbol) => ['bed', 'sofa_or_table', 'table_or_fixture'].includes(symbol.type)),
      fixtures: acceptedSymbols.filter((symbol) => symbol.type === 'bath_fixture_or_appliance'),
      appliances: acceptedSymbols.filter((symbol) => symbol.type === 'kitchen_appliance'),
      mep: mepSymbols,
      electrical: electricalSymbols,
      rejected: furnitureSymbols.filter((symbol) => !symbol.accepted),
      all: [...acceptedSymbols, ...mepSymbols, ...electricalSymbols]
    },
    evidence: {
      textLabels,
      ocrCandidates,
      windowSymbolCandidates: windowSymbols,
      furnitureSymbolCandidates: furnitureSymbols,
      mepSymbolCandidates: mepSymbols,
      electricalSymbolCandidates: electricalSymbols,
      annotationSymbolCandidates: geometry.annotationSymbolCandidates || []
    }
  };
}

function attachFloorplanModel(draft = {}, preprocessing = {}, job = {}) {
  const ocrCandidates = collectOcrCandidates(job, preprocessing);
  return {
    ...draft,
    floorplanModel: buildFloorplanModel({
      preprocessing,
      rooms: draft.rooms || [],
      walls: draft.walls || [],
      doors: draft.doors || [],
      windows: draft.windows || [],
      ocrCandidates
    })
  };
}

function collectIssues({ sourceType, rooms, hasParseResult, preprocessing }) {
  const issues = [];

  if (!hasParseResult) {
    issues.push('当前还没有稳定的结构化解析结果，本次先用本地规则生成草稿。');
  }

  if (sourceType === 'hand_drawn') {
    issues.push('手绘稿建议人工复核承重墙、门洞方向和尺寸线。');
  }

  if (rooms.some((room) => room.confidence < 0.7)) {
    issues.push('部分房间置信度偏低，建议在出 CAD 前确认房间名称和边界。');
  }

  if (rooms.length <= 1) {
    issues.push('识别到的空间过少，可能存在轮廓提取失败或图纸裁切问题。');
  }

  if (preprocessing?.quality?.issues?.length) {
    issues.push(...preprocessing.quality.issues.map((issue) => `预处理提示：${issue}`));
  }

  return issues;
}

function summarizeSourceAsset(localSourceFile) {
  if (!localSourceFile || !fs.existsSync(localSourceFile)) {
    return {
      exists: false,
      path: localSourceFile || '',
      ext: '',
      sizeBytes: 0
    };
  }

  const stat = fs.statSync(localSourceFile);
  return {
    exists: true,
    path: localSourceFile,
    ext: path.extname(localSourceFile).toLowerCase(),
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString()
  };
}

function buildRecognitionDraft(job, preprocessing = null) {
  const parseResult = job?.floor_plan?.parse_result || {};
  const hasParseResult = hasUsableParseRooms(parseResult);
  const hasParseWalls = hasUsableParseWalls(parseResult);
  const sourceType = job?.job?.source_type || job?.floor_plan?.source_type || 'digital';
  const templateRooms = isMlGridActive(preprocessing)
    ? []
    : buildChineseApartmentRooms(job, preprocessing);
  const wallGridRooms = buildRoomsFromWallGrid(preprocessing);
  const geometryRooms = assignSemanticsByLayoutCounts(
    pruneGeometryRoomsByLayout(wallGridRooms, job),
    job,
    preprocessing
  );
  const allGridCandidates = wallGridRooms.allGridCandidates || [];
  const ocrCandidates = collectOcrCandidates(job, preprocessing);
  const ocrGeometryRooms = assignOcrSemantics(geometryRooms, ocrCandidates);
  const semanticGeometryRooms = assignReviewSemantics(assignTemplateSemantics(ocrGeometryRooms, templateRooms), templateRooms);
  const geometryWithRecoveredRooms = recoverCriticalTemplateRoomsFromGrid(semanticGeometryRooms, templateRooms, allGridCandidates, job);
  const geometryWithOcrRecoveredRooms = recoverOcrLabeledRoomsFromGrid(geometryWithRecoveredRooms, ocrCandidates, allGridCandidates);
  const geometryWithOcrSupplements = supplementRoomsWithOcrLabels(geometryWithOcrRecoveredRooms, templateRooms, ocrCandidates, job);
  const geometryWithSupplements = classifyResidualCandidateSpaces(
    repairApartmentRoomPartition(
      stabilizePublicRoomSemantics(
        markRoomsWithBalconyBoundaryConflicts(
          supplementBalconyCandidates(
            confirmSemanticsWithLayoutEvidence(supplementRoomsWithTemplate(geometryWithOcrSupplements, templateRooms, job)),
            preprocessing
          ),
          preprocessing
        ),
        job
      ),
      preprocessing
    )
  );
  const candidateRooms = buildRoomsFromContours(preprocessing, sourceType);
  const rooms = hasParseResult
    ? normalizeRooms(parseResult)
    : (geometryWithSupplements.length >= 2
      ? geometryWithSupplements
      : (candidateRooms.length >= 2 ? candidateRooms : (templateRooms.length >= 6 ? templateRooms : synthesizeRooms(job))));
  const candidateWalls = buildWallsFromGeometryCandidates(preprocessing);
  const rawWalls = hasParseWalls
    ? parseResult.walls.map((wall, index) => ({
      id: wall.id || `wall-${index + 1}`,
      start: wall.start || { x: 0, y: 0 },
      end: wall.end || { x: 100, y: 0 },
      thickness: toNumber(wall.thickness, 12),
      confidence: wall.confidence || 0.84,
      orientation: toNumber(wall.start?.y) === toNumber(wall.end?.y) ? 'horizontal' : 'vertical'
    }))
    : (candidateWalls.length >= 4 ? candidateWalls : buildWallsFromRooms(rooms));
  const walls = applyAssetWallRoles(rawWalls, preprocessing);
  const doors = normalizeSegments(hasParseWalls && Array.isArray(parseResult.doors) ? parseResult.doors : [], 'door');
  const windows = normalizeSegments(hasParseWalls && Array.isArray(parseResult.windows) ? parseResult.windows : [], 'window');
  const semanticOpenings = inferTemplateOpeningsFromRooms(rooms);
  const wallLineWindows = !windows.length
    ? inferWallLineWindowsFromRooms(rooms, walls, preprocessing)
    : [];
  const inferredOpenings = !doors.length && rooms.some((room) => room.type !== 'space')
    ? semanticOpenings.doors
    : doors;
  const inferredWindows = !windows.length && rooms.some((room) => room.type !== 'space')
    ? (wallLineWindows.length ? wallLineWindows : semanticOpenings.windows)
    : windows;
  const sourceAsset = summarizeSourceAsset(job?.assets?.local_source_file);
  const preprocessScore = Number(preprocessing?.quality?.score || 0);
  const geometryConfidence = hasParseResult
    ? 0.88
    : geometryRooms.length >= 2
      ? Math.max(0.66, Math.min(0.84, preprocessScore || 0.72))
      : candidateWalls.length >= 4
      ? Math.max(0.62, Math.min(0.82, preprocessScore || 0.68))
      : sourceType === 'hand_drawn' ? 0.61 : 0.73;
  const semanticsConfidence = hasParseResult
    ? 0.84
    : rooms.some((room) => (room.source || '').includes('layout-count-semantics')) ? 0.8
      : rooms.some((room) => room.source === 'opencv-wall-grid-with-template-semantics') ? 0.72
      : rooms.some((room) => room.source === 'opencv-wall-grid-with-ocr-semantics') ? 0.78
      : rooms.some((room) => room.source === 'ocr-label-supplemental') ? 0.74
      : rooms.some((room) => room.source === 'layout-template-supplemental' || room.source === 'opencv-wall-grid-with-review-semantics') ? 0.68
      : sourceType === 'hand_drawn' ? 0.58 : 0.7;
  const issues = collectIssues({ sourceType, rooms, hasParseResult, preprocessing });
  const floorplanModel = buildFloorplanModel({
    preprocessing,
    rooms,
    walls,
    doors: inferredOpenings,
    windows: inferredWindows,
    ocrCandidates
  });
  const expectedText = [
    job?.house?.description,
    job?.house?.layout,
    job?.floor_plan?.name,
    job?.job?.input_payload?.processNotes
  ].filter(Boolean).join(' ');
  const expectedSpaceRules = [
    { name: '主卧', type: 'bedroom', pattern: /主卧/ },
    { name: '次卧/儿童房', type: 'bedroom', pattern: /男孩卧|次卧|儿童房/ },
    { name: '卫生间', type: 'bathroom', pattern: /主卫|卫生间|洗手间/ },
    { name: '楼梯过道', type: 'circulation', pattern: /楼梯过道|楼梯|过道/ },
    { name: '客厅', type: 'living', pattern: /客厅|客餐厅/ },
    { name: '餐厅', type: 'dining', pattern: /餐厅|客餐厅/ },
    { name: '门厅', type: 'entry', pattern: /门厅|玄关/ },
    { name: '厨房', type: 'kitchen', pattern: /厨房/ },
    { name: '阳台', type: 'balcony', pattern: /阳台/ }
  ];
  const layoutExpectedSpaces = buildExpectedSpacesFromLayout(job);
  const expectedSpaces = layoutExpectedSpaces.length
    ? layoutExpectedSpaces
    : expectedSpaceRules
      .filter((rule) => rule.pattern.test(expectedText))
      .map(({ name, type }) => ({ name, type, source: 'job-description' }));

  const draft = {
    version: '0.1.0',
    sourceType,
    generatedAt: new Date().toISOString(),
    sourceAsset,
    expectedSpaces,
    strategy: {
      localGeometry: hasParseResult && hasParseWalls
        ? 'reuse_existing_parse_result'
        : isMlGridActive(preprocessing) && geometryRooms.length >= 2
          ? 'ml_wall_grid_rooms'
          : geometryRooms.length >= 2
            ? 'opencv_wall_grid_rooms'
            : candidateWalls.length >= 4
              ? 'opencv_line_and_contour_candidates'
              : 'rule_based_room_synthesis',
      semanticReview: 'vision_llm_semantic_correction',
      targetOutput: 'cad_ready_floor_plan'
    },
    confidence: {
      geometry: geometryConfidence,
      semantics: semanticsConfidence
    },
    rooms,
    walls,
    doors: inferredOpenings,
    windows: inferredWindows,
    floorplanModel,
    quality: {
      score: Number(((geometryConfidence + semanticsConfidence) / 2).toFixed(2)),
      preprocessScore,
      candidateLineCount: preprocessing?.geometryCandidates?.lines?.length || 0,
      wallBandCount: preprocessing?.geometryCandidates?.wallBandCount || 0,
      recognitionAssetVersion: preprocessing?.recognitionAssets?.version || '',
      recognitionAssetMatchCount: preprocessing?.recognitionAssets?.matchedCandidateCount || 0,
      excludedAnnotationLineCount: preprocessing?.recognitionAssets?.excludedAnnotationLineCount || 0,
      geometryRoomCandidateCount: geometryRooms.length,
      candidateContourCount: preprocessing?.geometryCandidates?.contours?.length || 0,
      needsReview: !(hasParseResult && hasParseWalls) || geometryConfidence < 0.75 || rooms.length <= 1,
      semanticFallback: rooms.some((room) => room.source === 'layout-template-from-plan-labels')
        ? 'chinese_apartment_layout_template'
        : rooms.some((room) => room.source === 'layout-template-supplemental')
          ? 'template_supplement_on_partial_wall_grid'
        : rooms.some((room) => room.source === 'opencv-wall-grid-with-ocr-semantics')
          ? 'ocr_semantics_on_opencv_wall_grid'
        : rooms.some((room) => room.source === 'ocr-label-supplemental')
          ? 'ocr_label_supplement_on_opencv_wall_grid'
        : rooms.some((room) => room.source === 'opencv-wall-grid-with-review-semantics')
          ? 'review_template_semantics_on_opencv_wall_grid'
        : rooms.some((room) => room.source === 'opencv-wall-grid-with-template-semantics')
          ? 'template_semantics_on_opencv_wall_grid'
          : null
    },
    issues,
    nextActions: [
      '优先根据墙体与房间闭合关系生成正式图 JSON',
      '再由 GPT 校对房间名称、用途和异常项',
      '确认无误后输出 SVG / DXF，并继续全屋 3D 与全景流程'
    ],
    geometryRooms
  };

  return finalizeRecognitionDraft(draft, preprocessing);
}

function finalizeRecognitionDraft(draft = {}, preprocessing = {}) {
  const merged = mergePreprocessing(draft, preprocessing);
  const repaired = reviewSemanticDoorPriors(
    repairRecognitionTopology(
      preferVisualDoorCandidates(
        preferVisualWindowCandidates(merged, preprocessing),
        preprocessing
      )
    )
  );
  const spatialValidation = validateFloorplanDraft(repaired);
  const previousQuality = repaired.quality || {};
  const issues = (repaired.issues || []).filter(issue => typeof issue === 'string');
  for (const issue of spatialValidation.issues) {
    issues.push(`空间校验[${issue.severity}]: ${issue.code} (${issue.entityId || 'unknown'})`);
  }
  return {
    ...repaired,
    issues,
    spatialGraph: spatialValidation.graph,
    quality: {
      ...previousQuality,
      spatialValidation: {
        valid: spatialValidation.valid,
        reviewRequired: spatialValidation.reviewRequired,
        issueCount: spatialValidation.issues.length,
        errorCount: spatialValidation.issues.filter(issue => issue.severity === 'error').length,
        reviewCount: spatialValidation.issues.filter(issue => issue.severity === 'review').length,
        issues: spatialValidation.issues
      }
    }
  };
}

function mergePreprocessing(draft, preprocessing) {
  if (!preprocessing) {
    return draft;
  }

  return {
    ...draft,
    preprocessing,
    sourceAsset: {
      ...(draft.sourceAsset || {}),
      preprocessedImagePath: preprocessing.preprocessedImagePath || ''
    }
  };
}

function withIssuePrefix(draft, prefix, issue) {
  return {
    ...draft,
    issues: [`${prefix}${issue}`, ...(draft.issues || [])]
  };
}

function hasStrongLocalGeometry(draft = {}) {
  return draft.strategy?.localGeometry === 'opencv_wall_grid_rooms'
    && (draft.quality?.geometryRoomCandidateCount || 0) >= 2
    && Array.isArray(draft.rooms)
    && draft.rooms.length >= 2;
}

async function prepareRecognitionDraft(job, outputDir, options = {}) {
  let preprocessing = null;
  const fallbackIssues = [];

  try {
    preprocessing = await runRecognitionPreprocess(options.jobFile || '', outputDir);
    preprocessing = annotatePreprocessingWithAssets(preprocessing);
  } catch (error) {
    preprocessing = {
      status: 'failed',
      message: error.message,
      quality: {
        score: 0,
        issues: ['预处理执行失败']
      }
    };
  }

  // ML 墙分割：有 checkpoint 时优先注入墙段，供 draft.walls / 3D 挤出使用
  if (isMlWallEnabled()) {
    try {
      const imagePath = resolveSourceImage(job, preprocessing);
      if (imagePath) {
        const mlWall = runMlWallInference({ imagePath, outputDir });
        if (mlWall?.ok) {
          preprocessing = attachMlWallsToPreprocessing(preprocessing, mlWall);
        } else if (mlWall?.error) {
          fallbackIssues.push(`ML 墙分割失败，已回退 OpenCV 墙线：${mlWall.error}`);
        }
      }
    } catch (error) {
      fallbackIssues.push(`ML 墙分割异常，已回退 OpenCV 墙线：${error.message}`);
    }
  }

  const fallbackDraft = buildRecognitionDraft(job, preprocessing);
  let draft = null;

  try {
    if (recognitionMode === 'ai_first' || recognitionMode === 'ai_only') {
      draft = await runAiRecognition(job, outputDir, {
        sourceAsset: fallbackDraft.sourceAsset,
        preprocessing,
        fallbackDraft
      });
    }
  } catch (error) {
    fallbackIssues.push(`AI 识别失败，已回退：${error.message}`);
    if (recognitionMode === 'ai_only') {
      draft = withIssuePrefix(mergePreprocessing(fallbackDraft, preprocessing), 'AI 识别失败，已回退到规则草稿：', error.message);
    }
  }

  if (!draft && !['ai_only', 'local_only'].includes(recognitionMode) && !hasStrongLocalGeometry(fallbackDraft)) {
    try {
      draft = await runExternalRecognition(options.jobFile || '', outputDir);
    } catch (error) {
      draft = withIssuePrefix(mergePreprocessing(fallbackDraft, preprocessing), '本地识别器执行失败，已回退到规则草稿：', error.message);
    }
  }

  if (!draft) {
    draft = mergePreprocessing(fallbackDraft, preprocessing);
  }

  // buildRecognitionDraft 已 finalize；AI/外部草稿仍需补跑视觉洞口晋升
  if (!draft.quality?.commercialReadiness) {
    draft = finalizeRecognitionDraft(draft, preprocessing);
  } else {
    draft = mergePreprocessing(draft, preprocessing);
  }
  draft = attachFloorplanModel(draft, preprocessing, job);
  if (fallbackIssues.length) {
    draft.issues = [...fallbackIssues, ...(draft.issues || [])];
  }

  const draftFile = getRecognitionDraftFile(outputDir);
  fs.writeFileSync(draftFile, JSON.stringify(draft, null, 2), 'utf8');

  return {
    ...job,
    runtimeHints: {
      ...(job.runtimeHints || {}),
      recognitionDraft: draft,
      recognitionDraftFile: draftFile
    }
  };
}

module.exports = {
  prepareRecognitionDraft,
  buildRecognitionDraft,
  finalizeRecognitionDraft,
  assignOcrSemantics
};
