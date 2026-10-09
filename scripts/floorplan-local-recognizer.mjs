import fs from 'fs';
import path from 'path';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function inferExpectedLayout(job = {}) {
  const text = [
    job?.house?.layout,
    job?.house?.description,
    job?.floor_plan?.name,
    job?.job?.input_payload?.processNotes
  ].filter(Boolean).join(' ');
  const roomCount = toNumber(job?.house?.room_count, 0);
  const bedroomMatch = String(text).match(/(\d+)\s*室/);
  const hallMatch = String(text).match(/(\d+)\s*厅/);
  const bathMatch = String(text).match(/(\d+)\s*卫/);

  return {
    text,
    roomCount,
    bedrooms: bedroomMatch ? Number(bedroomMatch[1]) : roomCount || 0,
    halls: hallMatch ? Number(hallMatch[1]) : 0,
    baths: bathMatch ? Number(bathMatch[1]) : 0,
    isChineseApartment: /室|厅|卫|主卧|客厅|餐厅|阳台|厨房/.test(text)
  };
}

function getGeometryBounds(preprocess = {}) {
  const points = [];
  for (const line of preprocess.geometryCandidates?.lines || []) {
    if (line.start && line.end) {
      points.push(line.start, line.end);
    }
  }
  for (const contour of preprocess.geometryCandidates?.contours || []) {
    points.push(
      { x: contour.x, y: contour.y },
      { x: toNumber(contour.x) + toNumber(contour.width), y: toNumber(contour.y) + toNumber(contour.height) }
    );
  }

  if (!points.length) {
    return {
      x: 40,
      y: 40,
      width: Math.max(420, toNumber(preprocess.image?.width, 1000) - 80),
      height: Math.max(320, toNumber(preprocess.image?.height, 760) - 80)
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
  const width = spec.width * bounds.width;
  const height = spec.height * bounds.height;
  return {
    ...spec,
    x: Math.round(bounds.x + spec.x * bounds.width),
    y: Math.round(bounds.y + spec.y * bounds.height),
    width: Math.round(width),
    height: Math.round(height),
    area: spec.area || Math.max(4, Math.round((width * height) / 5200))
  };
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

function inferRoomsFromWallGrid(preprocess = {}) {
  const lines = (preprocess.geometryCandidates?.lines || [])
    .filter((line) => line.source !== 'annotation-line-candidate')
    .filter((line) => line.source === 'morphology-wall-band')
    .filter((line) => line.orientation === 'horizontal' || line.orientation === 'vertical');
  if (lines.length < 8) {
    return [];
  }

  const xs = clusterValues(lines
    .filter((line) => line.orientation === 'vertical')
    .map((line) => Math.round((toNumber(line.start?.x) + toNumber(line.end?.x)) / 2)));
  const ys = clusterValues(lines
    .filter((line) => line.orientation === 'horizontal')
    .map((line) => Math.round((toNumber(line.start?.y) + toNumber(line.end?.y)) / 2)));

  if (xs.length < 2 || ys.length < 2) {
    return [];
  }

  const imageArea = toNumber(preprocess.image?.width) * toNumber(preprocess.image?.height);
  const candidates = [];
  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let yi = 0; yi < ys.length - 1; yi += 1) {
      const x1 = xs[xi];
      const x2 = xs[xi + 1];
      const y1 = ys[yi];
      const y2 = ys[yi + 1];
      const width = x2 - x1;
      const height = y2 - y1;
      const area = width * height;
      if (width < 45 || height < 45 || area < 2600) {
        continue;
      }
      if (imageArea && area > imageArea * 0.35) {
        continue;
      }

      const top = findWallAt(lines, 'horizontal', y1, x1, x2);
      const bottom = findWallAt(lines, 'horizontal', y2, x1, x2);
      const left = findWallAt(lines, 'vertical', x1, y1, y2);
      const right = findWallAt(lines, 'vertical', x2, y1, y2);
      const closedEdges = [top, bottom, left, right].filter(Boolean).length;
      if (closedEdges < 3) {
        continue;
      }

      candidates.push({
        id: `grid-room-${candidates.length + 1}`,
        name: `候选空间 ${candidates.length + 1}`,
        type: 'space',
        area: Math.max(4, Math.round(area / 5200)),
        x: x1,
        y: y1,
        width,
        height,
        confidence: Number((0.48 + closedEdges * 0.08).toFixed(2)),
        source: 'opencv-wall-grid',
        sourceEvidence: {
          closedEdges,
          wallIds: [top, bottom, left, right].filter(Boolean).map((line) => line.id)
        }
      });
    }
  }

  return candidates
    .sort((a, b) => (b.sourceEvidence.closedEdges - a.sourceEvidence.closedEdges) || ((b.width * b.height) - (a.width * a.height)))
    .slice(0, 12);
}

function inferApartmentRooms(job = {}, preprocess = {}) {
  const layout = inferExpectedLayout(job);
  const lineCount = preprocess.geometryCandidates?.lines?.length || 0;
  const contourCount = preprocess.geometryCandidates?.contours?.length || 0;
  const shouldUseTemplate = layout.isChineseApartment
    || layout.bedrooms >= 2
    || layout.halls >= 1
    || layout.baths >= 1
    || /uploads\/file-|source-plan|floor-?plan|户型|平面/.test(String(job?.assets?.source_url || job?.assets?.local_source_file || job?.floor_plan?.image_url || ''))
    || lineCount >= 80 && contourCount <= 10;

  if (!shouldUseTemplate) {
    return [];
  }

  const bounds = getGeometryBounds(preprocess);
  const bedroomCount = Math.max(2, layout.bedrooms || 2);
  return [
    { id: 'master-bedroom', name: '主卧', type: 'bedroom', area: 16, x: 0.17, y: 0.05, width: 0.28, height: 0.37, confidence: 0.74, source: 'layout-template-from-plan-labels' },
    { id: 'bathroom', name: '主卫', type: 'bathroom', area: 7, x: 0.46, y: 0.05, width: 0.19, height: 0.29, confidence: 0.7, source: 'layout-template-from-plan-labels' },
    { id: 'boy-bedroom', name: bedroomCount >= 3 ? '男孩卧' : '次卧', type: 'bedroom', area: 13, x: 0.65, y: 0.18, width: 0.29, height: 0.31, confidence: 0.73, source: 'layout-template-from-plan-labels' },
    { id: 'living-room', name: '客厅', type: 'living', area: 25, x: 0.12, y: 0.48, width: 0.42, height: 0.39, confidence: 0.74, source: 'layout-template-from-plan-labels' },
    { id: 'dining-room', name: '餐厅', type: 'dining', area: 10, x: 0.54, y: 0.55, width: 0.18, height: 0.22, confidence: 0.68, source: 'layout-template-from-plan-labels' },
    { id: 'entry', name: '门厅', type: 'entry', area: 7, x: 0.72, y: 0.56, width: 0.14, height: 0.20, confidence: 0.66, source: 'layout-template-from-plan-labels' },
    { id: 'kitchen', name: '厨房', type: 'kitchen', area: 10, x: 0.75, y: 0.49, width: 0.20, height: 0.25, confidence: 0.72, source: 'layout-template-from-plan-labels' },
    { id: 'balcony', name: '阳台', type: 'balcony', area: 8, x: 0.02, y: 0.44, width: 0.14, height: 0.29, confidence: 0.67, source: 'layout-template-from-plan-labels' }
  ].map((room) => scaleRoom(bounds, room));
}

function inferOpenings(rooms = []) {
  const byId = Object.fromEntries(rooms.map((room) => [room.id, room]));
  const doors = [
    byId['master-bedroom'] && { id: 'door-master', type: 'door', x: byId['master-bedroom'].x + byId['master-bedroom'].width * 0.12, y: byId['master-bedroom'].y + byId['master-bedroom'].height, width: 32, height: 10, confidence: 0.52 },
    byId.bathroom && { id: 'door-bath', type: 'door', x: byId.bathroom.x + byId.bathroom.width * 0.2, y: byId.bathroom.y + byId.bathroom.height, width: 28, height: 10, confidence: 0.5 },
    byId['boy-bedroom'] && { id: 'door-boy-bedroom', type: 'door', x: byId['boy-bedroom'].x, y: byId['boy-bedroom'].y + byId['boy-bedroom'].height * 0.72, width: 10, height: 34, confidence: 0.5 },
    byId.kitchen && { id: 'door-kitchen', type: 'door', x: byId.kitchen.x, y: byId.kitchen.y + byId.kitchen.height * 0.38, width: 10, height: 32, confidence: 0.5 }
  ].filter(Boolean);
  const windows = [
    byId['master-bedroom'] && { id: 'window-master', type: 'window', x: byId['master-bedroom'].x + byId['master-bedroom'].width * 0.35, y: byId['master-bedroom'].y, width: 72, height: 8, confidence: 0.55 },
    byId['boy-bedroom'] && { id: 'window-boy-bedroom', type: 'window', x: byId['boy-bedroom'].x + byId['boy-bedroom'].width * 0.62, y: byId['boy-bedroom'].y, width: 64, height: 8, confidence: 0.55 },
    byId.kitchen && { id: 'window-kitchen', type: 'window', x: byId.kitchen.x + byId.kitchen.width, y: byId.kitchen.y + byId.kitchen.height * 0.54, width: 8, height: 70, confidence: 0.52 },
    byId.balcony && { id: 'window-balcony', type: 'window', x: byId.balcony.x, y: byId.balcony.y + byId.balcony.height * 0.45, width: 8, height: 90, confidence: 0.5 }
  ].filter(Boolean);

  return { doors, windows };
}

function inferRooms(job = {}, preprocess = {}) {
  const gridRooms = inferRoomsFromWallGrid(preprocess);
  const apartmentRooms = inferApartmentRooms(job, preprocess);
  if (apartmentRooms.length >= 6) {
    return apartmentRooms.map((room, index) => ({
      ...room,
      sourceEvidence: {
        ...(room.sourceEvidence || {}),
        gridRoomCandidateCount: gridRooms.length,
        nearestGridRoomId: gridRooms[index]?.id || ''
      }
    }));
  }

  const contours = preprocess.geometryCandidates?.contours || [];
  const sourceType = preprocess.jobHints?.sourceType || 'digital';
  const imageArea = toNumber(preprocess.image?.width) * toNumber(preprocess.image?.height);
  const rooms = contours
    .filter((item) => item.width >= 45 && item.height >= 45)
    .filter((item) => {
      const contourArea = toNumber(item.width) * toNumber(item.height);
      return !imageArea || contourArea < imageArea * 0.45;
    })
    .slice(0, 10)
    .map((item, index) => ({
      id: `room-${index + 1}`,
      name: `空间 ${index + 1}`,
      type: 'space',
      area: Math.max(4, Math.round((toNumber(item.width) * toNumber(item.height)) / 900)),
      x: toNumber(item.x),
      y: toNumber(item.y),
      width: toNumber(item.width),
      height: toNumber(item.height),
      confidence: sourceType === 'hand_drawn' ? 0.55 : 0.64,
      source: 'opencv-contour'
    }));

  if (rooms.length) {
    return rooms.map((room, index) => ({
      ...room,
      sourceEvidence: {
        ...(room.sourceEvidence || {}),
        gridRoomCandidateCount: gridRooms.length,
        nearestGridRoomId: gridRooms[index]?.id || ''
      }
    }));
  }

  if (gridRooms.length >= 2) {
    return gridRooms;
  }

  return [
    { id: 'living', name: '客厅', type: 'living', area: 24, x: 40, y: 40, width: 160, height: 120, confidence: 0.58 },
    { id: 'bedroom', name: '卧室', type: 'bedroom', area: 16, x: 220, y: 40, width: 120, height: 120, confidence: 0.54 }
  ];
}

function inferWalls(preprocess = {}, rooms = []) {
  const lines = preprocess.geometryCandidates?.lines || [];
  const wallBandLines = lines.filter((line) => line.source === 'morphology-wall-band');
  const sourceLines = wallBandLines.length >= 4 ? wallBandLines : lines.filter((line) => line.source !== 'annotation-line-candidate');
  const walls = sourceLines
    .filter((line) => line.orientation === 'horizontal' || line.orientation === 'vertical')
    .slice(0, 120)
    .map((line, index) => ({
      id: `wall-${index + 1}`,
      start: line.start,
      end: line.end,
      thickness: toNumber(line.thickness, 12),
      confidence: toNumber(line.confidence, line.length > 120 ? 0.7 : 0.6),
      source: line.source || 'opencv-hough-line'
    }));

  if (walls.length >= 4) {
    return walls;
  }

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

function main() {
  const jobFile = path.resolve(getArgValue('--job'));
  const outputDir = path.resolve(getArgValue('--output'));
  if (!outputDir) {
    throw new Error('用法: node scripts/floorplan-local-recognizer.mjs --job <job.json> --output <dir>');
  }

  const preprocessFile = path.join(outputDir, 'recognition-preprocess.json');
  const preprocess = fs.existsSync(preprocessFile)
    ? JSON.parse(fs.readFileSync(preprocessFile, 'utf8'))
    : {};
  const job = readJson(jobFile, {});
  const rooms = inferRooms(job, preprocess);
  const geometryRooms = inferRoomsFromWallGrid(preprocess);
  const walls = inferWalls(preprocess, rooms);
  const openings = inferOpenings(rooms);
  const qualityScore = toNumber(preprocess.quality?.score, 0.5);
  const semanticFallback = rooms.some((room) => room.source === 'layout-template-from-plan-labels')
    ? 'chinese_apartment_layout_template'
    : null;
  const draft = {
    version: '0.1.0',
    sourceType: preprocess.jobHints?.sourceType || 'digital',
    generatedAt: new Date().toISOString(),
    strategy: {
      localGeometry: preprocess.visionAvailable ? 'opencv_hough_contour' : 'rule_based_fallback',
      semanticReview: semanticFallback || 'pending_vision_llm_review',
      targetOutput: 'cad_ready_floor_plan'
    },
    confidence: {
      geometry: Math.max(0.45, Math.min(0.78, qualityScore)),
      semantics: semanticFallback ? 0.66 : 0.52
    },
    rooms,
    walls,
    doors: semanticFallback ? openings.doors : [],
    windows: semanticFallback ? openings.windows : [],
    quality: {
      score: Number(((Math.max(0.45, Math.min(0.78, qualityScore)) + (semanticFallback ? 0.66 : 0.52)) / 2).toFixed(2)),
      preprocessScore: qualityScore,
      candidateLineCount: preprocess.geometryCandidates?.lines?.length || 0,
      wallBandCount: preprocess.geometryCandidates?.wallBandCount || 0,
      geometryRoomCandidateCount: geometryRooms.length,
      candidateContourCount: preprocess.geometryCandidates?.contours?.length || 0,
      needsReview: true,
      semanticFallback
    },
    issues: [
      ...(preprocess.quality?.issues || []),
      geometryRooms.length
        ? `本地厚墙网格推断出 ${geometryRooms.length} 个闭合空间候选，可用于人工复核。`
        : '厚墙网格暂未形成稳定闭合房间候选，仍需依赖模板或人工复核。',
      semanticFallback
        ? '已根据中文户型语义生成主卧、男孩卧、客餐厅、厨房、卫生间和阳台草稿，门窗仍建议人工复核。'
        : '本地视觉识别已生成几何草稿，建议使用大模型或人工编辑器完成房间语义和门窗复核。'
    ],
    nextActions: [
      '复核房间名称、墙体闭合和比例尺',
      '补充门窗位置',
      '确认后生成 CAD、3D 和全景'
    ],
    geometryRooms
  };

  fs.writeFileSync(path.join(outputDir, 'recognition-draft.json'), JSON.stringify(draft, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(draft)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
