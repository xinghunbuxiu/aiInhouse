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

function getBounds(rooms = [], walls = []) {
  const points = [];

  for (const room of rooms) {
    const x = Number(room.x || 0);
    const y = Number(room.y || 0);
    const width = Number(room.width || 0);
    const height = Number(room.height || 0);
    points.push([x, y], [x + width, y + height]);
  }

  for (const wall of walls) {
    const start = wall.start || (Array.isArray(wall.from) ? { x: wall.from[0], y: wall.from[1] } : null);
    const end = wall.end || (Array.isArray(wall.to) ? { x: wall.to[0], y: wall.to[1] } : null);
    if (start && end) {
      points.push([Number(start.x || 0), Number(start.y || 0)], [Number(end.x || 0), Number(end.y || 0)]);
    }
  }

  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 420, maxY: 320, width: 420, height: 320 };
  }

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
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

function makeProjector(bounds, width, height, padding = 72) {
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  const offsetX = (width - bounds.width * scale) / 2;
  const offsetY = (height - bounds.height * scale) / 2;

  return (point) => ({
    x: offsetX + (Number(point.x || 0) - bounds.minX) * scale,
    y: offsetY + (Number(point.y || 0) - bounds.minY) * scale,
    scale
  });
}

function normalizeWall(wall) {
  const start = wall.start || (Array.isArray(wall.from) ? { x: wall.from[0], y: wall.from[1] } : null);
  const end = wall.end || (Array.isArray(wall.to) ? { x: wall.to[0], y: wall.to[1] } : null);
  if (!start || !end) {
    return null;
  }

  return {
    ...wall,
    start,
    end,
    role: wall.role || wall.wallType || 'interior'
  };
}

function roomColor(type = '') {
  const colors = {
    living: '#e8f1ff',
    bedroom: '#f0ebff',
    kitchen: '#e4f8ea',
    bathroom: '#dff7fb',
    dining: '#fff0c9',
    balcony: '#e3f5ff',
    entry: '#f3f4f6',
    space: '#f8fafc'
  };
  return colors[type] || colors.space;
}

function roomMaterial(type = '') {
  if (type === 'kitchen' || type === 'bathroom' || type === 'balcony') {
    return 'tile';
  }
  if (type === 'entry') {
    return 'stone';
  }
  return 'wood';
}

function projectedRect(room, project) {
  const topLeft = project({ x: room.x || 0, y: room.y || 0 });
  const bottomRight = project({
    x: Number(room.x || 0) + Number(room.width || 0),
    y: Number(room.y || 0) + Number(room.height || 0)
  });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(8, bottomRight.x - topLeft.x),
    height: Math.max(8, bottomRight.y - topLeft.y),
    scale: topLeft.scale
  };
}

function pointSideInRoom(point, room) {
  const left = Math.abs(Number(point.x || 0) - Number(room.x || 0));
  const right = Math.abs(Number(point.x || 0) - (Number(room.x || 0) + Number(room.width || 0)));
  const top = Math.abs(Number(point.y || 0) - Number(room.y || 0));
  const bottom = Math.abs(Number(point.y || 0) - (Number(room.y || 0) + Number(room.height || 0)));
  const best = [
    ['left', left],
    ['right', right],
    ['top', top],
    ['bottom', bottom]
  ].sort((a, b) => a[1] - b[1])[0];
  return best?.[0] || 'top';
}

function openingSideForRoom(opening, room) {
  return pointSideInRoom(openingCenter(opening), room);
}

function oppositeSide(side) {
  return {
    left: 'right',
    right: 'left',
    top: 'bottom',
    bottom: 'top'
  }[side] || 'bottom';
}

function preferredFurnitureSide(room, openings = []) {
  const door = openings.find((opening) => opening.kind === 'door' || opening.type === 'door');
  if (door) {
    return oppositeSide(openingSideForRoom(door, room));
  }
  const window = openings.find((opening) => opening.kind === 'window' || opening.type === 'window');
  if (window) {
    return oppositeSide(openingSideForRoom(window, room));
  }
  return 'top';
}

function anchorRect(rect, width, height, side, pad) {
  const x = side === 'right'
    ? rect.x + rect.width - pad - width
    : side === 'left'
      ? rect.x + pad
      : rect.x + (rect.width - width) / 2;
  const y = side === 'bottom'
    ? rect.y + rect.height - pad - height
    : side === 'top'
      ? rect.y + pad
      : rect.y + (rect.height - height) / 2;
  return { x, y, width, height };
}

function furnitureForRoom(room, rect, index, openings = []) {
  const type = room.type || 'space';
  const pad = Math.max(6, Math.min(rect.width, rect.height) * 0.12);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const preferredSide = preferredFurnitureSide(room, openings);
  const parts = [];

  if (type === 'living') {
    const sofa = anchorRect(rect, Math.max(28, rect.width * 0.42), Math.max(16, rect.height * 0.28), preferredSide, pad);
    parts.push(`<rect x="${sofa.x}" y="${sofa.y}" width="${sofa.width}" height="${sofa.height}" rx="8" fill="#2f5d50" opacity="0.9"/>`);
    parts.push(`<rect x="${cx - rect.width * 0.14}" y="${cy - rect.height * 0.09}" width="${Math.max(24, rect.width * 0.28)}" height="${Math.max(12, rect.height * 0.18)}" rx="7" fill="#f8fafc" stroke="#94a3b8"/>`);
    const tvSide = oppositeSide(preferredSide);
    const tv = anchorRect(rect, tvSide === 'left' || tvSide === 'right' ? 10 : Math.max(28, rect.width * 0.32), tvSide === 'left' || tvSide === 'right' ? Math.max(24, rect.height * 0.52) : 10, tvSide, pad);
    parts.push(`<rect x="${tv.x}" y="${tv.y}" width="${tv.width}" height="${tv.height}" rx="4" fill="#111827" opacity="0.75"/>`);
  } else if (type === 'bedroom') {
    const bedW = Math.max(30, rect.width * 0.48);
    const bedH = Math.max(24, rect.height * 0.46);
    const bed = anchorRect(rect, bedW, bedH, preferredSide, pad);
    parts.push(`<rect x="${bed.x}" y="${bed.y}" width="${bed.width}" height="${bed.height}" rx="8" fill="#ffffff" stroke="#a78bfa" stroke-width="2"/>`);
    parts.push(`<rect x="${bed.x + 5}" y="${bed.y + 5}" width="${Math.max(14, bedW * 0.32)}" height="${Math.max(10, bedH * 0.26)}" rx="4" fill="#ddd6fe"/>`);
    const wardrobeSide = oppositeSide(preferredSide);
    const wardrobe = anchorRect(rect, Math.max(18, rect.width * 0.16), Math.max(28, rect.height * 0.58), wardrobeSide, pad);
    parts.push(`<rect x="${wardrobe.x}" y="${wardrobe.y}" width="${wardrobe.width}" height="${wardrobe.height}" rx="5" fill="#8b5cf6" opacity="0.42"/>`);
  } else if (type === 'kitchen') {
    const cabinet = anchorRect(rect, Math.max(18, preferredSide === 'left' || preferredSide === 'right' ? rect.width * 0.22 : rect.width - pad * 2), Math.max(16, preferredSide === 'left' || preferredSide === 'right' ? rect.height - pad * 2 : rect.height * 0.23), preferredSide, pad);
    parts.push(`<rect x="${cabinet.x}" y="${cabinet.y}" width="${cabinet.width}" height="${cabinet.height}" rx="5" fill="#94a3b8"/>`);
    parts.push(`<circle cx="${cabinet.x + Math.max(12, cabinet.width * 0.22)}" cy="${cabinet.y + Math.max(10, cabinet.height * 0.28)}" r="${Math.max(5, Math.min(rect.width, rect.height) * 0.055)}" fill="#e2e8f0"/>`);
    parts.push(`<rect x="${cabinet.x + cabinet.width - 18}" y="${cabinet.y + 4}" width="14" height="${Math.max(18, Math.min(cabinet.height - 8, rect.height * 0.22))}" rx="3" fill="#0f172a" opacity="0.72"/>`);
  } else if (type === 'bathroom') {
    parts.push(`<circle cx="${rect.x + pad + Math.max(12, rect.width * 0.2)}" cy="${rect.y + pad + Math.max(12, rect.height * 0.24)}" r="${Math.max(8, Math.min(rect.width, rect.height) * 0.1)}" fill="#ffffff" stroke="#06b6d4" stroke-width="2"/>`);
    parts.push(`<rect x="${rect.x + rect.width - pad - Math.max(20, rect.width * 0.28)}" y="${rect.y + pad}" width="${Math.max(20, rect.width * 0.28)}" height="${Math.max(18, rect.height * 0.28)}" rx="5" fill="#e0f2fe" stroke="#0891b2"/>`);
  } else if (type === 'dining') {
    parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(16, rect.width * 0.26)}" ry="${Math.max(10, rect.height * 0.22)}" fill="#a16207" opacity="0.82"/>`);
    for (let i = 0; i < 4; i += 1) {
      const dx = (i % 2 ? 1 : -1) * Math.max(14, rect.width * 0.22);
      const dy = (i > 1 ? 1 : -1) * Math.max(10, rect.height * 0.22);
      parts.push(`<circle cx="${cx + dx}" cy="${cy + dy}" r="${Math.max(4, Math.min(rect.width, rect.height) * 0.055)}" fill="#fbbf24"/>`);
    }
  } else if (type === 'balcony') {
    parts.push(`<rect x="${rect.x + pad}" y="${cy - 3}" width="${Math.max(24, rect.width - pad * 2)}" height="6" rx="3" fill="#38bdf8" opacity="0.8"/>`);
    parts.push(`<circle cx="${rect.x + rect.width - pad - 10}" cy="${rect.y + pad + 10}" r="8" fill="#22c55e" opacity="0.78"/>`);
  } else {
    parts.push(`<path d="M ${cx - 14} ${cy} H ${cx + 14} M ${cx} ${cy - 14} V ${cy + 14}" stroke="#64748b" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`);
  }

  return `<g data-room-furniture="${escapeXml(room.id || `room-${index + 1}`)}">${parts.join('\n')}</g>`;
}

function floorPatternForRoom(room, rect, index) {
  const material = roomMaterial(room.type);
  if (material === 'wood') {
    const lines = [];
    const step = Math.max(12, Math.min(26, rect.width / 6));
    for (let x = rect.x - rect.height; x < rect.x + rect.width + rect.height; x += step) {
      lines.push(`<path d="M ${x} ${rect.y + rect.height} L ${x + rect.height} ${rect.y}" stroke="#a16207" stroke-width="1.2" opacity="0.16"/>`);
    }
    return lines.join('\n');
  }
  if (material === 'tile' || material === 'stone') {
    const lines = [];
    const step = material === 'tile' ? 24 : 32;
    for (let x = rect.x + step; x < rect.x + rect.width; x += step) {
      lines.push(`<line x1="${x}" y1="${rect.y}" x2="${x}" y2="${rect.y + rect.height}" stroke="#64748b" stroke-width="1" opacity="0.18"/>`);
    }
    for (let y = rect.y + step; y < rect.y + rect.height; y += step) {
      lines.push(`<line x1="${rect.x}" y1="${y}" x2="${rect.x + rect.width}" y2="${y}" stroke="#64748b" stroke-width="1" opacity="0.18"/>`);
    }
    return lines.join('\n');
  }
  return '';
}

function normalizeOpening(opening = {}) {
  return {
    ...opening,
    kind: opening.kind || opening.type || 'opening',
    x: Number(opening.x || 0),
    y: Number(opening.y || 0),
    width: Number(opening.width || 0),
    height: Number(opening.height || 0),
    orientation: opening.orientation || (Number(opening.width || 0) >= Number(opening.height || 0) ? 'horizontal' : 'vertical')
  };
}

function openingCenter(opening) {
  return {
    x: Number(opening.x || 0) + Number(opening.width || 0) / 2,
    y: Number(opening.y || 0) + Number(opening.height || 0) / 2
  };
}

function roomContainsOpening(room = {}, opening = {}, tolerance = 24) {
  const center = openingCenter(opening);
  return center.x >= Number(room.x || 0) - tolerance
    && center.y >= Number(room.y || 0) - tolerance
    && center.x <= Number(room.x || 0) + Number(room.width || 0) + tolerance
    && center.y <= Number(room.y || 0) + Number(room.height || 0) + tolerance;
}

function renderOpening(opening, project, index) {
  const normalized = normalizeOpening(opening);
  const center = project(openingCenter(normalized));
  const scale = center.scale;
  const length = Math.max(18, (normalized.orientation === 'horizontal' ? normalized.width : normalized.height) * scale);
  const isDoor = normalized.kind === 'door' || normalized.type === 'door';
  const isHorizontal = normalized.orientation === 'horizontal';
  const stroke = isDoor ? '#f97316' : '#0284c7';
  const clearStroke = isDoor ? '#fff7ed' : '#e0f2fe';
  const strokeWidth = isDoor ? 7 : 5;
  const half = length / 2;

  if (isHorizontal) {
    const y = center.y;
    const x1 = center.x - half;
    const x2 = center.x + half;
    const swing = isDoor
      ? `<path d="M ${x1} ${y} Q ${x1 + half * 0.65} ${y - Math.max(18, half * 0.42)} ${center.x} ${y}" fill="none" stroke="#fb923c" stroke-width="2" opacity="0.72"/>`
      : '';
    return `<g data-opening="${escapeXml(normalized.id || `opening-${index + 1}`)}"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${clearStroke}" stroke-width="${strokeWidth + 6}" stroke-linecap="round"/><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round"/>${swing}</g>`;
  }

  const x = center.x;
  const y1 = center.y - half;
  const y2 = center.y + half;
  const swing = isDoor
    ? `<path d="M ${x} ${y1} Q ${x + Math.max(18, half * 0.42)} ${y1 + half * 0.65} ${x} ${center.y}" fill="none" stroke="#fb923c" stroke-width="2" opacity="0.72"/>`
    : '';
  return `<g data-opening="${escapeXml(normalized.id || `opening-${index + 1}`)}"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${clearStroke}" stroke-width="${strokeWidth + 6}" stroke-linecap="round"/><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round"/>${swing}</g>`;
}

function generateEffectRender({ outputDir, rooms = [], walls = [], openings = [], colors = {}, materials = {} }) {
  const width = 1600;
  const height = 1000;
  const planWidth = 1180;
  const planHeight = 820;
  const normalizedOpenings = openings.map(normalizeOpening).filter((opening) => opening.x || opening.y);
  const bounds = getBounds(rooms, walls.map(normalizeWall).filter(Boolean), normalizedOpenings);
  const project = makeProjector(bounds, planWidth, planHeight, 56);
  const normalizedWalls = walls.map(normalizeWall).filter(Boolean);
  const roomRects = rooms.map((room, index) => ({
    room,
    rect: projectedRect(room, project),
    index,
    openings: normalizedOpenings.filter((opening) => roomContainsOpening(room, opening))
  }));
  const wallLines = normalizedWalls.map((wall) => {
    const start = project(wall.start);
    const end = project(wall.end);
    const thickness = Math.max(3, Math.min(10, Number(wall.thickness || 10) * start.scale));
    const color = wall.isExterior || wall.wallRole === 'exterior' ? '#0f172a' : '#334155';
    return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${color}" stroke-width="${thickness}" stroke-linecap="square"/>`;
  }).join('\n');

  const openingLines = normalizedOpenings.map((opening, index) => renderOpening(opening, project, index)).join('\n');
  const roomLayers = roomRects.map(({ room, rect, index, openings: roomOpenings }) => `
    <g data-room="${escapeXml(room.id || `room-${index + 1}`)}">
      <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="4" fill="${roomColor(room.type)}" stroke="#ffffff" stroke-width="2"/>
      ${floorPatternForRoom(room, rect, index)}
      ${furnitureForRoom(room, rect, index, roomOpenings)}
      <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="4" fill="none" stroke="rgba(15,23,42,0.22)" stroke-width="1.5"/>
      <text x="${rect.x + rect.width / 2}" y="${rect.y + rect.height / 2 + Math.min(28, rect.height * 0.32)}" text-anchor="middle" font-size="${Math.max(13, Math.min(22, rect.width / Math.max(4, String(room.name || '').length) * 1.25))}" font-weight="800" fill="#0f172a">${escapeXml(room.name || `空间 ${index + 1}`)}</text>
    </g>`).join('\n');

  const legendRows = rooms.map((room, index) => {
    const y = 206 + index * 42;
    return `<g><rect x="1270" y="${y - 18}" width="18" height="18" rx="3" fill="${roomColor(room.type)}" stroke="#cbd5e1"/><text x="1298" y="${y - 3}" font-size="18" fill="#1f2937" font-weight="700">${escapeXml(room.name || `空间 ${index + 1}`)}</text><text x="1510" y="${y - 3}" text-anchor="end" font-size="15" fill="#64748b">${escapeXml(room.type || 'space')}</text></g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="planShadow" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0f172a" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="#f4f6f8"/>
  <rect x="48" y="48" width="${planWidth}" height="${planHeight}" rx="8" fill="#ffffff" filter="url(#planShadow)"/>
  <g transform="translate(48 48)">
    <rect width="${planWidth}" height="${planHeight}" rx="8" fill="#f8fafc"/>
    ${roomLayers}
    <g data-layer="walls">${wallLines}</g>
    <g data-layer="openings">${openingLines}</g>
  </g>
  <g>
    <text x="1270" y="88" font-size="30" font-weight="900" fill="#0f172a">AIInHouse 装修平面效果</text>
    <text x="1270" y="124" font-size="17" fill="#64748b">按识别房间边界、墙体和功能布置生成</text>
    <text x="1270" y="160" font-size="16" fill="#64748b">${rooms.length} 个空间 · ${normalizedWalls.length} 条墙线 · ${normalizedOpenings.length} 个门窗 · ${bounds.width.toFixed(0)}x${bounds.height.toFixed(0)} 源图尺度</text>
    ${legendRows}
  </g>
</svg>`;

  const fileName = 'effect-render.svg';
  fs.writeFileSync(path.join(outputDir, fileName), svg, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'birdseye-render.svg'), svg, 'utf8');
  return fileName;
}

function slugifyRoomId(room = {}, index = 0) {
  return String(room.id || `room-${index + 1}`).replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function interiorAccentForRoom(type = '') {
  const accents = {
    living: '#c97342',
    bedroom: '#8b5cf6',
    kitchen: '#64748b',
    bathroom: '#06b6d4',
    dining: '#a16207',
    balcony: '#38bdf8',
    entry: '#475569',
    space: '#94a3b8'
  };
  return accents[type] || accents.space;
}

function interiorDecorForRoom(room = {}, width, height) {
  const type = room.type || 'space';
  const cx = width / 2;
  const floorY = height * 0.78;
  const backY = height * 0.28;
  const parts = [];

  if (type === 'living') {
    parts.push(`<rect x="${width * 0.18}" y="${floorY - 58}" width="${width * 0.34}" height="58" rx="10" fill="#2f5d50"/>`);
    parts.push(`<rect x="${cx - 70}" y="${floorY - 34}" width="140" height="34" rx="8" fill="#f8fafc" stroke="#94a3b8"/>`);
    parts.push(`<rect x="${width * 0.68}" y="${backY + 24}" width="84" height="54" rx="6" fill="#111827" opacity="0.82"/>`);
  } else if (type === 'bedroom') {
    parts.push(`<rect x="${cx - 110}" y="${floorY - 72}" width="220" height="72" rx="12" fill="#ffffff" stroke="#a78bfa" stroke-width="3"/>`);
    parts.push(`<rect x="${width * 0.12}" y="${backY + 18}" width="72" height="150" rx="8" fill="#8b5cf6" opacity="0.45"/>`);
  } else if (type === 'kitchen') {
    parts.push(`<rect x="${width * 0.12}" y="${floorY - 88}" width="${width * 0.76}" height="88" rx="8" fill="#94a3b8"/>`);
    parts.push(`<circle cx="${width * 0.24}" cy="${floorY - 44}" r="18" fill="#e2e8f0"/>`);
    parts.push(`<rect x="${width * 0.72}" y="${floorY - 78}" width="54" height="58" rx="6" fill="#0f172a" opacity="0.75"/>`);
  } else if (type === 'bathroom') {
    parts.push(`<circle cx="${width * 0.22}" cy="${floorY - 42}" r="28" fill="#ffffff" stroke="#06b6d4" stroke-width="3"/>`);
    parts.push(`<rect x="${width * 0.62}" y="${backY + 30}" width="110" height="72" rx="8" fill="#e0f2fe" stroke="#0891b2"/>`);
  } else if (type === 'dining') {
    parts.push(`<ellipse cx="${cx}" cy="${floorY - 42}" rx="92" ry="42" fill="#a16207" opacity="0.86"/>`);
  } else if (type === 'balcony') {
    parts.push(`<rect x="${width * 0.1}" y="${backY + 40}" width="${width * 0.8}" height="18" rx="8" fill="#38bdf8" opacity="0.75"/>`);
    parts.push(`<circle cx="${width * 0.82}" cy="${floorY - 70}" r="24" fill="#22c55e" opacity="0.78"/>`);
  } else {
    parts.push(`<rect x="${cx - 60}" y="${floorY - 70}" width="120" height="70" rx="10" fill="#e2e8f0" stroke="#94a3b8"/>`);
  }

  return parts.join('\n');
}

function generateInteriorView({ outputDir, room, index = 0, openings = [], colors = {}, materials = {} }) {
  const width = 1600;
  const height = 1000;
  const accent = colors.accent || interiorAccentForRoom(room.type);
  const floorColor = materials.floor?.color || roomColor(room.type);
  const wallColor = materials.wall?.color || '#f1ece5';
  const roomOpenings = openings.filter((opening) => roomContainsOpening(room, opening));
  const window = roomOpenings.find((opening) => opening.kind === 'window' || opening.type === 'window');
  const roomSlug = slugifyRoomId(room, index);
  const windowPanel = window
    ? `<rect x="${width * 0.34}" y="${height * 0.16}" width="${width * 0.32}" height="${height * 0.18}" rx="14" fill="url(#windowGlow)" stroke="#ffffff" stroke-width="8"/>`
    : `<rect x="${width * 0.4}" y="${height * 0.2}" width="${width * 0.2}" height="${height * 0.12}" rx="10" fill="#f8fafc" opacity="0.35"/>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="floorGrad" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${floorColor}"/>
      <stop offset="1" stop-color="#8b5e34"/>
    </linearGradient>
    <linearGradient id="wallGrad" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#d6d3d1"/>
      <stop offset="0.5" stop-color="${wallColor}"/>
      <stop offset="1" stop-color="#d6d3d1"/>
    </linearGradient>
    <linearGradient id="windowGlow" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#e0f2fe"/>
      <stop offset="0.55" stop-color="#7dd3fc"/>
      <stop offset="1" stop-color="#0369a1"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#0f172a"/>
  <polygon points="0,${height * 0.24} ${width},${height * 0.24} ${width},${height} 0,${height}" fill="url(#wallGrad)"/>
  <polygon points="0,${height * 0.24} ${width * 0.5},${height * 0.08} ${width},${height * 0.24}" fill="#faf9f7"/>
  <polygon points="0,${height * 0.24} 0,${height} ${width * 0.5},${height * 0.92} ${width * 0.5},${height * 0.24}" fill="#ebe4dc" opacity="0.92"/>
  <polygon points="${width},${height * 0.24} ${width},${height} ${width * 0.5},${height * 0.92} ${width * 0.5},${height * 0.24}" fill="#e7dfd6" opacity="0.92"/>
  <polygon points="0,${height * 0.78} ${width},${height * 0.78} ${width * 0.88},${height} ${width * 0.12},${height}" fill="url(#floorGrad)"/>
  ${windowPanel}
  ${interiorDecorForRoom(room, width, height)}
  <text x="48" y="72" font-size="34" font-weight="800" fill="#ffffff">${escapeXml(room.name || `空间 ${index + 1}`)}</text>
  <text x="48" y="112" font-size="18" fill="#cbd5e1">${escapeXml(room.type || 'space')} · 室内观赏视角</text>
  <rect x="48" y="130" width="120" height="10" rx="5" fill="${accent}" opacity="0.9"/>
</svg>`;

  const fileName = `interior-${roomSlug}.svg`;
  fs.writeFileSync(path.join(outputDir, fileName), svg, 'utf8');
  return fileName;
}

function generateInteriorViews({ outputDir, rooms = [], openings = [], colors = {}, materials = {}, limit = 12 }) {
  return rooms.slice(0, limit).map((room, index) => generateInteriorView({
    outputDir,
    room,
    index,
    openings,
    colors,
    materials
  }));
}

function generateBirdseyeRender(options) {
  return generateEffectRender(options);
}

function generatePanoramaImage({ outputDir, rooms = [], colors = {}, materials = {} }) {
  const width = 2048;
  const height = 1024;
  const primary = colors.primary || '#c97342';
  const accent = colors.accent || '#2f5d50';
  const base = colors.base || '#f4efe8';
  const floorColor = materials.floor?.color || '#c8a676';
  const sceneRooms = rooms.length ? rooms : [{ name: '客厅', type: 'living' }, { name: '卧室', type: 'bedroom' }, { name: '厨房', type: 'kitchen' }];
  const roomLabels = sceneRooms.slice(0, 5).map((room, index) => {
    const x = 238 + index * 356;
    return `
      <g>
        <circle cx="${x}" cy="596" r="24" fill="${index % 2 ? accent : primary}" opacity="0.78"/>
        <text x="${x}" y="650" text-anchor="middle" font-size="24" font-weight="800" fill="#ffffff">${escapeXml(room.name || `空间 ${index + 1}`)}</text>
      </g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="wallSweep" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#d6d3d1"/>
      <stop offset="0.18" stop-color="#f8fafc"/>
      <stop offset="0.34" stop-color="${base}"/>
      <stop offset="0.5" stop-color="#fff7ed"/>
      <stop offset="0.66" stop-color="${base}"/>
      <stop offset="0.82" stop-color="#f8fafc"/>
      <stop offset="1" stop-color="#d6d3d1"/>
    </linearGradient>
    <radialGradient id="ceiling" cx="50%" cy="0%" r="74%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.56" stop-color="#f8fafc"/>
      <stop offset="1" stop-color="#e7e5e4"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${floorColor}"/>
      <stop offset="0.54" stop-color="#b9894d"/>
      <stop offset="1" stop-color="#5f4324"/>
    </linearGradient>
    <linearGradient id="window" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#e0f2fe"/>
      <stop offset="0.52" stop-color="#7dd3fc"/>
      <stop offset="1" stop-color="#0369a1"/>
    </linearGradient>
    <filter id="panoShadow" x="-20%" y="-30%" width="140%" height="170%">
      <feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#020617" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#wallSweep)"/>
  <ellipse cx="1024" cy="80" rx="1220" ry="292" fill="url(#ceiling)" opacity="0.96"/>
  <path d="M 0 682 C 254 620 456 620 684 682 C 884 736 1158 736 1364 682 C 1604 620 1816 620 2048 682 V 1024 H 0 Z" fill="url(#floor)"/>
  <g opacity="0.18">
    ${Array.from({ length: 34 }, (_, index) => `<path d="M ${index * 74 - 180} 700 L ${index * 42 - 420} 1024" stroke="#fff" stroke-width="3"/>`).join('\n')}
    ${Array.from({ length: 9 }, (_, index) => `<path d="M 0 ${742 + index * 34} C 520 ${702 + index * 16} 1510 ${702 + index * 16} 2048 ${742 + index * 34}" fill="none" stroke="#fff" stroke-width="3"/>`).join('\n')}
  </g>

  <g filter="url(#panoShadow)">
    <rect x="120" y="292" width="350" height="244" rx="18" fill="url(#window)" stroke="#ffffff" stroke-width="9"/>
    <path d="M 120 466 C 210 410 316 402 470 482 V 536 H 120 Z" fill="#0f766e" opacity="0.55"/>
    <circle cx="412" cy="336" r="38" fill="#fde68a"/>
    <line x1="295" y1="292" x2="295" y2="536" stroke="#ffffff" stroke-width="7"/>
    <line x1="120" y1="414" x2="470" y2="414" stroke="#ffffff" stroke-width="7"/>
  </g>

  <g filter="url(#panoShadow)">
    <rect x="790" y="264" width="468" height="270" rx="24" fill="#ffffff" opacity="0.92"/>
    <rect x="828" y="300" width="178" height="92" rx="18" fill="${primary}" opacity="0.82"/>
    <rect x="1038" y="300" width="178" height="92" rx="18" fill="${accent}" opacity="0.82"/>
    <rect x="858" y="428" width="330" height="38" rx="19" fill="#94a3b8" opacity="0.34"/>
  </g>

  <g filter="url(#panoShadow)">
    <path d="M 1424 548 C 1512 492 1712 492 1808 552 L 1840 716 C 1706 788 1504 788 1378 716 Z" fill="${primary}"/>
    <rect x="1454" y="456" width="318" height="108" rx="48" fill="${accent}"/>
    <path d="M 1462 558 C 1548 532 1684 532 1774 558 L 1788 638 C 1688 676 1548 676 1446 638 Z" fill="#f8fafc" opacity="0.9"/>
  </g>

  <g filter="url(#panoShadow)">
    <ellipse cx="1024" cy="190" rx="120" ry="44" fill="#ffffff" opacity="0.92"/>
    <circle cx="1024" cy="190" r="36" fill="#fde68a"/>
    <ellipse cx="1024" cy="190" rx="34" ry="12" fill="#fef3c7" opacity="0.9"/>
  </g>

  <g opacity="0.94">
    <rect x="0" y="0" width="2048" height="1024" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="22"/>
  </g>
  ${roomLabels}
</svg>`;

  const fileName = 'panorama-equirectangular.svg';
  fs.writeFileSync(path.join(outputDir, fileName), svg, 'utf8');
  return fileName;
}

module.exports = {
  generateEffectRender,
  generateBirdseyeRender,
  generateInteriorViews,
  generateInteriorView,
  generatePanoramaImage
};
