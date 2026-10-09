const fs = require('fs');
const path = require('path');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeWall(wall = {}) {
  const start = wall.start || (Array.isArray(wall.from) ? { x: wall.from[0], y: wall.from[1] } : null);
  const end = wall.end || (Array.isArray(wall.to) ? { x: wall.to[0], y: wall.to[1] } : null);
  if (!start || !end) {
    return null;
  }

  return {
    ...wall,
    start: { x: toNumber(start.x), y: toNumber(start.y) },
    end: { x: toNumber(end.x), y: toNumber(end.y) },
    thickness: toNumber(wall.thickness, 12)
  };
}

function getBounds(rooms = [], walls = [], openings = []) {
  const points = [];

  for (const room of rooms) {
    const x = toNumber(room.x);
    const y = toNumber(room.y);
    const width = toNumber(room.width);
    const height = toNumber(room.height);
    points.push({ x, y }, { x: x + width, y: y + height });
  }

  for (const wall of walls) {
    points.push(wall.start, wall.end);
  }

  for (const opening of openings) {
    const x = toNumber(opening.x);
    const y = toNumber(opening.y);
    const width = toNumber(opening.width, 20);
    const height = toNumber(opening.height, 8);
    points.push({ x: x - width / 2, y: y - height / 2 }, { x: x + width / 2, y: y + height / 2 });
  }

  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 420, maxY: 320, width: 420, height: 320 };
  }

  const xs = points.map((point) => toNumber(point.x));
  const ys = points.map((point) => toNumber(point.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function makeProjector(bounds, width, height, padding = 42) {
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  const scaledWidth = bounds.width * scale;
  const scaledHeight = bounds.height * scale;
  const offsetX = (width - scaledWidth) / 2;
  const offsetY = (height - scaledHeight) / 2;

  return (point) => ({
    x: offsetX + (toNumber(point.x) - bounds.minX) * scale,
    y: offsetY + (toNumber(point.y) - bounds.minY) * scale,
    scale
  });
}

function roomColor(type = '') {
  const colors = {
    living: '#164e63',
    bedroom: '#3b1f63',
    kitchen: '#064e3b',
    bathroom: '#5b2b1b',
    dining: '#713f12',
    balcony: '#0e7490',
    entry: '#334155',
    space: '#1f2937'
  };
  return colors[type] || colors.space;
}

function buildRooms(job) {
  const recognitionRooms = job?.runtimeHints?.recognitionDraft?.rooms;
  if (Array.isArray(recognitionRooms) && recognitionRooms.length) {
    return recognitionRooms.map((room, index) => ({
      id: room.id || `room-${index + 1}`,
      name: room.name || `房间 ${index + 1}`,
      type: room.type || 'space',
      area: Number(room.area || 12 + index * 3),
      x: room.x ?? 40 + index * 120,
      y: room.y ?? 40 + (index % 2) * 120,
      width: room.width ?? 100,
      height: room.height ?? 80,
      confidence: room.confidence || 0.8
    }));
  }

  const parseRooms = job?.floor_plan?.parse_result?.rooms;
  if (Array.isArray(parseRooms) && parseRooms.length) {
    return parseRooms.map((room, index) => ({
      id: room.id || `room-${index + 1}`,
      name: room.name || `房间 ${index + 1}`,
      type: room.type || 'space',
      area: Number(room.area || 12 + index * 3),
      x: room.x ?? 40 + index * 120,
      y: room.y ?? 40 + (index % 2) * 120,
      width: room.width ?? 100,
      height: room.height ?? 80
    }));
  }

  return [
    { id: 'living', name: '客厅', type: 'living', area: 24, x: 40, y: 40, width: 160, height: 120 },
    { id: 'master', name: '主卧', type: 'bedroom', area: 18, x: 220, y: 40, width: 130, height: 120 },
    { id: 'kitchen', name: '厨房', type: 'kitchen', area: 10, x: 40, y: 180, width: 120, height: 90 },
    { id: 'bath', name: '卫生间', type: 'bathroom', area: 6, x: 180, y: 180, width: 80, height: 90 }
  ];
}

function buildFallbackWallsFromRooms(rooms = []) {
  return rooms.flatMap((room, index) => {
    const x1 = toNumber(room.x);
    const y1 = toNumber(room.y);
    const x2 = x1 + toNumber(room.width);
    const y2 = y1 + toNumber(room.height);
    return [
      { id: `${room.id || index}-top`, start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, thickness: 10, confidence: 0.55 },
      { id: `${room.id || index}-right`, start: { x: x2, y: y1 }, end: { x: x2, y: y2 }, thickness: 10, confidence: 0.55 },
      { id: `${room.id || index}-bottom`, start: { x: x2, y: y2 }, end: { x: x1, y: y2 }, thickness: 10, confidence: 0.55 },
      { id: `${room.id || index}-left`, start: { x: x1, y: y2 }, end: { x: x1, y: y1 }, thickness: 10, confidence: 0.55 }
    ];
  });
}

function buildProposedRooms(recognitionDraft = {}) {
  const roomStage = (recognitionDraft.floorplanModel?.stages || []).find((stage) => stage.stage === 'rooms') || {};
  const rejectedBalconies = roomStage.rejected?.balconyCandidates || [];
  return rejectedBalconies
    .filter((candidate) => candidate.source === 'thin-outline-balcony-candidate')
    .filter((candidate) => toNumber(candidate.confidence, 0) >= 0.78)
    .filter((candidate) => !String(candidate.classifiedAs || '').endsWith('false-positive'))
    .map((candidate) => ({
      id: `proposed-${candidate.id}`,
      sourceCandidateId: candidate.id,
      name: '阳台候选',
      type: 'balcony',
      x: toNumber(candidate.x),
      y: toNumber(candidate.y),
      width: toNumber(candidate.width),
      height: toNumber(candidate.height),
      area: Math.max(4, Math.round((toNumber(candidate.width) * toNumber(candidate.height)) / 5200)),
      confidence: toNumber(candidate.confidence, 0.78),
      source: candidate.source,
      needsVisualConfirmation: true,
      reviewReasons: [
        'raw-balcony-candidate-overlaps-accepted-room-model',
        ...(candidate.rejectReasons || [])
      ],
      overlappingRooms: candidate.overlappingRooms || []
    }));
}

function buildDxf(rooms = []) {
  const header = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES'
  ];

  const entities = rooms.flatMap((room) => {
    const x1 = Number(room.x || 0);
    const y1 = Number(room.y || 0);
    const x2 = x1 + Number(room.width || 0);
    const y2 = y1 + Number(room.height || 0);
    const centerX = x1 + Number(room.width || 0) / 2;
    const centerY = y1 + Number(room.height || 0) / 2;

    return [
      '0', 'LWPOLYLINE', '8', 'ROOMS', '90', '4', '70', '1',
      '10', String(x1), '20', String(y1),
      '10', String(x2), '20', String(y1),
      '10', String(x2), '20', String(y2),
      '10', String(x1), '20', String(y2),
      '0', 'TEXT', '8', 'LABELS', '10', String(centerX), '20', String(centerY), '40', '12', '1', room.name || '房间'
    ];
  });

  const footer = ['0', 'ENDSEC', '0', 'EOF'];
  return [...header, ...entities, ...footer].join('\n');
}

function generateFormalPlan(job, outputDir) {
  const rooms = buildRooms(job);
  const recognitionDraft = job?.runtimeHints?.recognitionDraft || {};
  const walls = (recognitionDraft.walls || []).map(normalizeWall).filter(Boolean);
  const planWalls = walls.length ? walls : buildFallbackWallsFromRooms(rooms);
  const proposedRooms = buildProposedRooms(recognitionDraft);
  const recognizedOpenings = [
    ...(recognitionDraft.doors || []).map((opening) => ({ ...opening, kind: 'door' })),
    ...(recognitionDraft.windows || []).map((opening) => ({ ...opening, kind: 'window' }))
  ];
  const openings = recognizedOpenings.filter((opening) => !opening.sourceEvidence?.needsVisualConfirmation && opening.source !== 'semantic-room-opening-prior');
  const proposedOpenings = recognizedOpenings.filter((opening) => opening.sourceEvidence?.needsVisualConfirmation || opening.source === 'semantic-room-opening-prior');
  const bounds = getBounds(rooms, planWalls, recognizedOpenings);
  const width = 1200;
  const height = 820;
  const project = makeProjector(bounds, width, height);

  const wallSvg = planWalls.map((wall) => {
    const start = project(wall.start);
    const end = project(wall.end);
    const strokeWidth = Math.max(4, Math.min(18, toNumber(wall.thickness, 12) * start.scale));
    return `<line x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="${wall.isExterior || wall.wallRole === 'exterior' ? '#0f172a' : '#f8fafc'}" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="square"/>`;
  }).join('\n');

  const roomSvg = rooms.map((room) => {
    const topLeft = project({ x: room.x, y: room.y });
    const bottomRight = project({ x: toNumber(room.x) + toNumber(room.width), y: toNumber(room.y) + toNumber(room.height) });
    const roomWidth = Math.max(4, bottomRight.x - topLeft.x);
    const roomHeight = Math.max(4, bottomRight.y - topLeft.y);
    const labelX = topLeft.x + roomWidth / 2;
    const labelY = topLeft.y + roomHeight / 2;
    const fontSize = Math.max(13, Math.min(22, Math.min(roomWidth, roomHeight) / 6));
    return `
  <g>
    <rect x="${topLeft.x.toFixed(1)}" y="${topLeft.y.toFixed(1)}" width="${roomWidth.toFixed(1)}" height="${roomHeight.toFixed(1)}" fill="${roomColor(room.type)}" opacity="0.76" stroke="rgba(255,255,255,0.32)" stroke-width="1.5"/>
    <text x="${labelX.toFixed(1)}" y="${(labelY - 3).toFixed(1)}" text-anchor="middle" font-size="${fontSize.toFixed(1)}" font-weight="800" fill="#ffffff">${escapeXml(room.name)}</text>
    <text x="${labelX.toFixed(1)}" y="${(labelY + fontSize + 5).toFixed(1)}" text-anchor="middle" font-size="${Math.max(10, fontSize * 0.58).toFixed(1)}" fill="#e0f2fe">${escapeXml(room.area)} m²</text>
  </g>`;
  }).join('\n');

  const openingSvg = openings.map((opening) => {
    const center = project({ x: opening.x, y: opening.y });
    const isDoor = opening.kind === 'door';
    const w = Math.max(18, toNumber(opening.width, isDoor ? 36 : 52) * center.scale);
    const h = Math.max(5, toNumber(opening.height, 8) * center.scale);
    const color = isDoor ? '#f59e0b' : '#67e8f9';
    return `<rect x="${(center.x - w / 2).toFixed(1)}" y="${(center.y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(6, h / 2).toFixed(1)}" fill="${color}" opacity="0.95"/>`;
  }).join('\n');
  const proposedRoomSvg = proposedRooms.map((room) => {
    const topLeft = project({ x: room.x, y: room.y });
    const bottomRight = project({ x: toNumber(room.x) + toNumber(room.width), y: toNumber(room.y) + toNumber(room.height) });
    const roomWidth = Math.max(4, bottomRight.x - topLeft.x);
    const roomHeight = Math.max(4, bottomRight.y - topLeft.y);
    return `
  <g>
    <rect x="${topLeft.x.toFixed(1)}" y="${topLeft.y.toFixed(1)}" width="${roomWidth.toFixed(1)}" height="${roomHeight.toFixed(1)}" fill="#0891b2" opacity="0.12" stroke="#22d3ee" stroke-width="3" stroke-dasharray="10 7"/>
    <text x="${(topLeft.x + roomWidth / 2).toFixed(1)}" y="${(topLeft.y + 22).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="800" fill="#a5f3fc">${escapeXml(room.name)}</text>
  </g>`;
  }).join('\n');
  const proposedOpeningSvg = proposedOpenings.map((opening) => {
    const center = project({ x: opening.x, y: opening.y });
    const isDoor = opening.kind === 'door';
    const w = Math.max(18, toNumber(opening.width, isDoor ? 36 : 52) * center.scale);
    const h = Math.max(5, toNumber(opening.height, 8) * center.scale);
    const color = isDoor ? '#b45309' : '#0891b2';
    return `<rect x="${(center.x - w / 2).toFixed(1)}" y="${(center.y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(6, h / 2).toFixed(1)}" fill="${color}" opacity="0.22" stroke="${color}" stroke-width="2" stroke-dasharray="8 6"/>`;
  }).join('\n');

  const issues = recognitionDraft.issues || [];
  const issueSvg = issues.slice(0, 2).map((issue, index) => (
    `<text x="48" y="${height - 54 + index * 20}" font-size="14" fill="#94a3b8">${escapeXml(issue)}</text>`
  )).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 H 0 V 24" fill="none" stroke="#1e293b" stroke-width="0.7" opacity="0.35"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="#020617"/>
  <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="20" fill="#07111f" stroke="#233044" stroke-width="2"/>
  <rect x="48" y="72" width="${width - 96}" height="${height - 156}" fill="url(#grid)" stroke="#1e3a5f" stroke-width="1"/>
  <text x="48" y="50" font-size="18" font-weight="800" fill="#e2e8f0">Formal Plan</text>
  <text x="${width - 48}" y="50" text-anchor="end" font-size="13" fill="#94a3b8">${escapeXml(job.job.job_no)}</text>
  ${roomSvg}
  <g>${proposedRoomSvg}</g>
  <g>${wallSvg}</g>
  <g>${openingSvg}</g>
  <g>${proposedOpeningSvg}</g>
  <g>
    <rect x="48" y="${height - 88}" width="18" height="8" rx="4" fill="#f59e0b"/>
    <text x="74" y="${height - 80}" font-size="13" fill="#cbd5e1">门</text>
    <rect x="112" y="${height - 88}" width="24" height="8" rx="4" fill="#67e8f9"/>
    <text x="144" y="${height - 80}" font-size="13" fill="#cbd5e1">窗</text>
  </g>
  ${issueSvg}
</svg>`;

  const formalJson = {
    version: '0.1.0',
    floorPlanId: job.floor_plan?.id || null,
    jobNo: job.job.job_no,
    sourceType: job.job.source_type || 'digital',
    generatedAt: new Date().toISOString(),
    rooms,
    proposedRooms,
    walls: planWalls.length ? planWalls : [
      { id: 'w1', from: [40, 40], to: [360, 40] },
      { id: 'w2', from: [40, 40], to: [40, 270] }
    ],
    openings,
    proposedOpenings,
    meta: {
      convertedToFormal: job.job.source_type === 'hand_drawn',
      processNotes: job.job.source_type === 'hand_drawn' ? '已根据手绘稿自动规整墙线与房间标签。' : '电子图纸已标准化整理。',
      recognitionConfidence: job?.runtimeHints?.recognitionDraft?.confidence || null,
      commercialReadiness: job?.runtimeHints?.recognitionDraft?.quality?.commercialReadiness || null,
      recognitionIssues: job?.runtimeHints?.recognitionDraft?.issues || [],
      recognitionAssetVersion: job?.runtimeHints?.recognitionDraft?.quality?.recognitionAssetVersion || job?.runtimeHints?.recognitionDraft?.preprocessing?.recognitionAssets?.version || '',
      recognitionAssetMatchCount: job?.runtimeHints?.recognitionDraft?.quality?.recognitionAssetMatchCount || job?.runtimeHints?.recognitionDraft?.preprocessing?.recognitionAssets?.matchedCandidateCount || 0
    }
  };

  const svgPath = path.join(outputDir, 'formal-plan.svg');
  const dxfPath = path.join(outputDir, 'formal-plan.dxf');
  const jsonPath = path.join(outputDir, 'formal-plan.json');
  fs.writeFileSync(svgPath, svg, 'utf8');
  fs.writeFileSync(dxfPath, buildDxf(rooms), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(formalJson, null, 2), 'utf8');

  return {
    svgPath,
    dxfPath,
    jsonPath,
    rooms
  };
}

module.exports = {
  generateFormalPlan
};
