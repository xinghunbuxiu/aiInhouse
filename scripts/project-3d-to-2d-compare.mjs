import fs from 'node:fs';
import path from 'node:path';

function arg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function num(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtml(value) {
  return escapeXml(value);
}

function fileNameIfExists(filePath) {
  return filePath && fs.existsSync(filePath) ? path.basename(filePath) : '';
}

function normalizeRoomsFrom3d(config = {}) {
  return (config.rooms || []).map((room, index) => ({
    id: room.id || `room-${index + 1}`,
    name: room.name || `空间 ${index + 1}`,
    type: room.type || 'space',
    area: num(room.area),
    x: num(room.bounds?.x),
    y: num(room.bounds?.y),
    width: num(room.bounds?.width),
    height: num(room.bounds?.height),
    furniture: room.furniture || []
  }));
}

function normalizeStructuralWallShells(config = {}) {
  return (config.structuralWallShells || []).map((wall, index) => ({
    id: wall.id || `structural-wall-shell-${index + 1}`,
    polygon: wall.polygon2d || wall.polygon || [],
    confidence: num(wall.confidence, 0.72),
    source: wall.source || '3d-structural-wall-shell'
  })).filter((wall) => wall.polygon.length >= 3);
}

function normalizeWallsFromFormal(formal = {}) {
  return (formal.walls || []).map((wall, index) => {
    const start = wall.start || (Array.isArray(wall.from) ? { x: wall.from[0], y: wall.from[1] } : null);
    const end = wall.end || (Array.isArray(wall.to) ? { x: wall.to[0], y: wall.to[1] } : null);
    if (!start || !end) {
      return null;
    }
    return {
      id: wall.id || `wall-${index + 1}`,
      start: { x: num(start.x), y: num(start.y) },
      end: { x: num(end.x), y: num(end.y) },
      thickness: num(wall.thickness, 10),
      confidence: num(wall.confidence, 0.6),
      role: wall.wallRole || wall.role || (wall.isExterior ? 'exterior' : 'interior')
    };
  }).filter(Boolean);
}

function roomBounds(room = {}) {
  return {
    x1: num(room.x),
    y1: num(room.y),
    x2: num(room.x) + num(room.width),
    y2: num(room.y) + num(room.height)
  };
}

function roomArea(room = {}) {
  return Math.max(0, num(room.width) * num(room.height));
}

function intersectionArea(a = {}, b = {}) {
  const ar = roomBounds(a);
  const br = roomBounds(b);
  const width = Math.max(0, Math.min(ar.x2, br.x2) - Math.max(ar.x1, br.x1));
  const height = Math.max(0, Math.min(ar.y2, br.y2) - Math.max(ar.y1, br.y1));
  return width * height;
}

function iou(a = {}, b = {}) {
  const intersection = intersectionArea(a, b);
  const union = roomArea(a) + roomArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

function center(room = {}) {
  return {
    x: num(room.x) + num(room.width) / 2,
    y: num(room.y) + num(room.height) / 2
  };
}

function matchRooms(sourceRooms = [], projectedRooms = []) {
  const unused = new Set(projectedRooms.map((room) => room.id));
  return sourceRooms.map((source) => {
    let best = null;
    for (const candidate of projectedRooms) {
      if (!unused.has(candidate.id)) {
        continue;
      }
      const typeBonus = source.type === candidate.type ? 0.18 : 0;
      const nameBonus = source.name === candidate.name ? 0.12 : 0;
      const score = iou(source, candidate) + typeBonus + nameBonus;
      if (!best || score > best.score) {
        best = { room: candidate, score };
      }
    }

    if (best) {
      unused.delete(best.room.id);
    }

    const projection = best?.room || null;
    const sourceCenter = center(source);
    const projectionCenter = projection ? center(projection) : { x: 0, y: 0 };
    const centerDelta = projection
      ? Math.hypot(sourceCenter.x - projectionCenter.x, sourceCenter.y - projectionCenter.y)
      : null;
    const widthDelta = projection ? Math.abs(num(source.width) - num(projection.width)) : null;
    const heightDelta = projection ? Math.abs(num(source.height) - num(projection.height)) : null;
    const areaDeltaRatio = projection
      ? Math.abs(roomArea(source) - roomArea(projection)) / Math.max(roomArea(source), 1)
      : null;
    const overlap = projection ? iou(source, projection) : 0;
    const status = !projection
      ? 'missing_in_3d'
      : overlap >= 0.92 && centerDelta <= 4 && areaDeltaRatio <= 0.08
        ? 'aligned'
        : overlap >= 0.76
          ? 'needs_minor_adjustment'
          : 'needs_repair';

    return {
      id: source.id,
      name: source.name,
      type: source.type,
      matched3dRoomId: projection?.id || null,
      overlap: Number(overlap.toFixed(3)),
      centerDelta: centerDelta == null ? null : Number(centerDelta.toFixed(1)),
      widthDelta: widthDelta == null ? null : Number(widthDelta.toFixed(1)),
      heightDelta: heightDelta == null ? null : Number(heightDelta.toFixed(1)),
      areaDeltaRatio: areaDeltaRatio == null ? null : Number(areaDeltaRatio.toFixed(3)),
      status,
      source,
      projection
    };
  });
}

function boundsForRooms(rooms = []) {
  const xs = [];
  const ys = [];
  for (const room of rooms) {
    xs.push(num(room.x), num(room.x) + num(room.width));
    ys.push(num(room.y), num(room.y) + num(room.height));
  }

  if (!xs.length) {
    return { minX: 0, minY: 0, width: 100, height: 100 };
  }

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function projector(bounds, width, height, padding = 52) {
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  const dx = (width - bounds.width * scale) / 2;
  const dy = (height - bounds.height * scale) / 2;
  return (point) => ({
    x: dx + (num(point.x) - bounds.minX) * scale,
    y: dy + (num(point.y) - bounds.minY) * scale,
    scale
  });
}

function colorFor(type = '') {
  return {
    living: '#0ea5e9',
    bedroom: '#8b5cf6',
    kitchen: '#22c55e',
    bathroom: '#06b6d4',
    dining: '#f59e0b',
    balcony: '#38bdf8',
    entry: '#64748b',
    space: '#94a3b8'
  }[type] || '#94a3b8';
}

function labelForType(type = '') {
  return {
    living: '客',
    bedroom: '卧',
    kitchen: '厨',
    bathroom: '卫',
    dining: '餐',
    balcony: '阳',
    entry: '玄',
    space: '空'
  }[type] || '空';
}

function furnitureLabel(type = '') {
  return {
    toilet: '马桶',
    vanity: '台盆',
    shower: '淋浴',
    bed: '床',
    wardrobe: '柜',
    nightstand: '几',
    sofa: '沙发',
    coffee_table: '茶几',
    tv_console: '电视',
    base_cabinet: '橱柜',
    sink: '水槽',
    stove: '灶',
    dining_table: '餐桌',
    dining_chair_set: '餐椅',
    shoe_cabinet: '鞋柜',
    laundry_cabinet: '洗衣',
    plant_stand: '花架',
    flex_storage: '收纳'
  }[type] || type || '物件';
}

function rectSvg(room, project, options = {}) {
  const p1 = project({ x: room.x, y: room.y });
  const p2 = project({ x: num(room.x) + num(room.width), y: num(room.y) + num(room.height) });
  const width = Math.max(1, p2.x - p1.x);
  const height = Math.max(1, p2.y - p1.y);
  const color = options.color || colorFor(room.type);
  return `<rect x="${p1.x.toFixed(1)}" y="${p1.y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="4" fill="${color}" fill-opacity="${options.opacity ?? 0.35}" stroke="${color}" stroke-width="${options.strokeWidth ?? 2}" stroke-dasharray="${options.dash || ''}"/>`;
}

function furnitureSvg(room, project) {
  const roomRect = {
    x: num(room.x),
    y: num(room.y),
    width: num(room.width),
    height: num(room.height)
  };

  return (room.furniture || []).map((item) => {
    const px = num(item.position?.x, 0.5);
    const pz = num(item.position?.z, 0.5);
    const width = Math.max(20, num(room.width) * Math.min(0.38, Math.max(0.08, num(item.size?.width, 0.8) / 6)));
    const height = Math.max(16, num(room.height) * Math.min(0.34, Math.max(0.08, num(item.size?.depth, 0.6) / 6)));
    const raw = {
      x: roomRect.x + roomRect.width * px - width / 2,
      y: roomRect.y + roomRect.height * pz - height / 2,
      width,
      height,
      type: room.type
    };
    const p1 = project({ x: raw.x, y: raw.y });
    const p2 = project({ x: raw.x + raw.width, y: raw.y + raw.height });
    return `<rect x="${p1.x.toFixed(1)}" y="${p1.y.toFixed(1)}" width="${Math.max(5, p2.x - p1.x).toFixed(1)}" height="${Math.max(5, p2.y - p1.y).toFixed(1)}" rx="3" fill="#111827" fill-opacity="0.48"><title>${escapeXml(item.type)}</title></rect>`;
  }).join('\n');
}

function writeProjectionSvg(outputDir, projectedRooms) {
  const width = 1200;
  const height = 820;
  const bounds = boundsForRooms(projectedRooms);
  const project = projector(bounds, width, height);
  const rooms = projectedRooms.map((room) => {
    const p = project({ x: num(room.x) + num(room.width) / 2, y: num(room.y) + num(room.height) / 2 });
    return `
      <g>
        ${rectSvg(room, project, { opacity: 0.22 })}
        ${furnitureSvg(room, project)}
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">${escapeXml(room.name)}</text>
      </g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  <text x="44" y="46" font-size="20" font-weight="900" fill="#0f172a">3D 顶视回投影</text>
  <text x="44" y="72" font-size="13" fill="#64748b">由 3d-config.json 的房间壳体和家具对象反投影生成</text>
  ${rooms}
</svg>`;
  fs.writeFileSync(path.join(outputDir, '3d-topdown-projection.svg'), svg, 'utf8');
}

function writeDiffSvg(outputDir, matches) {
  const width = 1200;
  const height = 820;
  const rooms = matches.flatMap((match) => [match.source, match.projection].filter(Boolean));
  const bounds = boundsForRooms(rooms);
  const project = projector(bounds, width, height);
  const layers = matches.map((match) => {
    const source = rectSvg(match.source, project, { color: '#0f172a', opacity: 0.12, strokeWidth: 2 });
    const projection = match.projection
      ? rectSvg(match.projection, project, { color: match.status === 'aligned' ? '#16a34a' : '#dc2626', opacity: 0.08, strokeWidth: 2, dash: '8 6' })
      : '';
    const c = project(center(match.source));
    const label = `${match.name} ${match.status} IoU ${match.overlap}`;
    return `<g>${source}${projection}<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" text-anchor="middle" font-size="13" font-weight="800" fill="#0f172a">${escapeXml(label)}</text></g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#fff"/>
  <text x="44" y="46" font-size="20" font-weight="900" fill="#0f172a">2D vs 3D 回投影差异</text>
  <text x="44" y="72" font-size="13" fill="#64748b">黑色实线是 formal-plan，彩色虚线是 3D 回投影；红色需要调节，绿色已对齐。</text>
  ${layers}
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'projection-diff.svg'), svg, 'utf8');
}

function wallShellSvg(shells = []) {
  return shells.map((shell) => {
    const points = shell.polygon
      .map((point) => `${num(point.x).toFixed(1)},${num(point.y).toFixed(1)}`)
      .join(' ');
    return `<polygon points="${points}" fill="#ef4444" fill-opacity="0.58" stroke="#b91c1c" stroke-width="2" data-wall-shell="${escapeXml(shell.id)}"/>`;
  }).join('\n');
}

function writeRawCoordinateOverlaySvg(outputDir, report, projectedRooms, walls, wallShells, imageSize) {
  const width = imageSize.width || 1400;
  const height = imageSize.height || 973;
  const sourcePlan = report.files.sourcePlan || 'recognition-input.jpg';
  const roomLayers = projectedRooms.map((room) => {
    const x = num(room.x);
    const y = num(room.y);
    const roomWidth = num(room.width);
    const roomHeight = num(room.height);
    const color = colorFor(room.type);
    const labelX = x + roomWidth / 2;
    const labelY = y + roomHeight / 2;
    const furniture = (room.furniture || []).map((item) => {
      const fw = Math.max(22, roomWidth * Math.min(0.34, Math.max(0.08, num(item.size?.width, 0.7) / 6)));
      const fh = Math.max(18, roomHeight * Math.min(0.3, Math.max(0.08, num(item.size?.depth, 0.6) / 6)));
      const fx = x + roomWidth * num(item.position?.x, 0.5) - fw / 2;
      const fy = y + roomHeight * num(item.position?.z, 0.5) - fh / 2;
      return `
        <g>
          <rect x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" rx="5" fill="#111827" fill-opacity="0.52" stroke="#fff" stroke-width="1"/>
          <text x="${(fx + fw / 2).toFixed(1)}" y="${(fy + fh / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">${escapeXml(furnitureLabel(item.type))}</text>
        </g>`;
    }).join('\n');

    return `
      <g data-room="${escapeXml(room.id)}">
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${roomWidth.toFixed(1)}" height="${roomHeight.toFixed(1)}" rx="2" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="4"/>
        <circle cx="${labelX.toFixed(1)}" cy="${labelY.toFixed(1)}" r="18" fill="${color}" fill-opacity="0.9" stroke="#fff" stroke-width="2"/>
        <text x="${labelX.toFixed(1)}" y="${(labelY + 5).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="900" fill="#fff">${escapeXml(labelForType(room.type))}</text>
        ${furniture}
      </g>`;
  }).join('\n');

  const wallLayers = walls.map((wall) => {
    const strokeWidth = Math.max(4, Math.min(18, num(wall.thickness, 10)));
    const color = wall.role === 'exterior' ? '#111827' : '#ef4444';
    return `<line x1="${wall.start.x.toFixed(1)}" y1="${wall.start.y.toFixed(1)}" x2="${wall.end.x.toFixed(1)}" y2="${wall.end.y.toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth.toFixed(1)}" stroke-opacity="0.78" stroke-linecap="square"/>`;
  }).join('\n');
  const structuralWallLayer = wallShells.length ? wallShellSvg(wallShells) : wallLayers;

  const legendItems = [
    ['墙', '#ef4444'],
    ['卧', colorFor('bedroom')],
    ['卫/马桶', colorFor('bathroom')],
    ['厨', colorFor('kitchen')],
    ['阳', colorFor('balcony')],
    ['客', colorFor('living')]
  ].map(([label, color], index) => {
    const x = 28 + index * 108;
    return `<g><rect x="${x}" y="22" width="22" height="22" rx="4" fill="${color}" fill-opacity="0.85"/><text x="${x + 30}" y="39" font-size="15" font-weight="800" fill="#111827">${escapeXml(label)}</text></g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="./${escapeXml(sourcePlan)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" opacity="0.08"/>
  <g data-layer="3d-projected-structural-wall-shells">${structuralWallLayer}</g>
  <g data-layer="3d-projected-rooms">${roomLayers}</g>
  <rect x="16" y="12" width="${Math.min(width - 32, 690)}" height="44" rx="8" fill="#fff" fill-opacity="0.86" stroke="#cbd5e1"/>
  ${legendItems}
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'raw-plan-3d-overlay.svg'), svg, 'utf8');
}

function writeComparisonHtml(outputDir, report) {
  const cards = [
    ['真实原始平面图', report.files.sourcePlan, '本次识别实际输入图，用来肉眼判断是否跑偏。'],
    ['真实图坐标系校准叠图', report.files.rawCoordinateOverlay, '真实原图作为底图，3D 房间/墙/家具按同一坐标系覆盖。'],
    ['标准化平面图', report.files.formalPlanSvg, '系统从真实图理解出的结构化 2D 平面图。'],
    ['3D 后二维投影图', report.files.topdownProjection, '由 3d-config.json 的房间壳体和家具对象反投影。'],
    ['差异叠加图', report.files.diffOverlay, '黑色是标准平面图，彩色虚线是 3D 回投影。']
  ].filter(([, src]) => src);

  const cardsHtml = cards.map(([title, src, description]) => `
    <section class="panel">
      <div class="panel-title">
        <h2>${escapeHtml(title)}</h2>
        <span>${escapeHtml(description)}</span>
      </div>
      <div class="image-wrap">
        <img src="./${escapeHtml(src)}" alt="${escapeHtml(title)}" />
      </div>
    </section>
  `).join('\n');

  const issueRows = report.matches.map((match) => `
    <tr>
      <td>${escapeHtml(match.name)}</td>
      <td>${escapeHtml(match.type)}</td>
      <td><span class="${match.status === 'aligned' ? 'ok' : 'bad'}">${escapeHtml(match.status)}</span></td>
      <td>${escapeHtml(match.overlap)}</td>
      <td>${escapeHtml(match.centerDelta ?? '-')}</td>
      <td>${escapeHtml(match.areaDeltaRatio ?? '-')}</td>
    </tr>
  `).join('');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>平面图与 3D 回投影对比</title>
  <style>
    :root{color-scheme:light;--bg:#f6f7f9;--ink:#111827;--muted:#667085;--line:#d9dee7;--panel:#fff;--ok:#047857;--bad:#b42318}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{padding:24px 28px 18px;border-bottom:1px solid var(--line);background:#fff}
    h1{margin:0 0 8px;font-size:24px;line-height:1.2}
    .meta{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:14px}
    main{padding:22px 28px;display:grid;gap:18px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}
    .panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
    .panel-title{padding:14px 16px;border-bottom:1px solid var(--line);display:grid;gap:4px}
    .panel-title h2{font-size:17px;margin:0}
    .panel-title span{font-size:13px;color:var(--muted)}
    .image-wrap{height:520px;background:#eef1f5;display:flex;align-items:center;justify-content:center}
    img{display:block;max-width:100%;max-height:100%;object-fit:contain}
    table{width:100%;border-collapse:collapse;background:#fff}
    th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}
    th{background:#f2f4f7;color:#344054}
    .ok{color:var(--ok);font-weight:800}.bad{color:var(--bad);font-weight:800}
    @media (max-width: 980px){.grid{grid-template-columns:1fr}.image-wrap{height:420px}}
  </style>
</head>
<body>
  <header>
    <h1>真实平面图 vs 3D 回投影</h1>
    <div class="meta">
      <span>房间：${report.summary.sourceRoomCount} / ${report.summary.projectedRoomCount}</span>
      <span>已对齐：${report.summary.alignedRoomCount}</span>
      <span>需修复：${report.summary.repairCount}</span>
      <span>平均 IoU：${report.summary.meanOverlap}</span>
      <span>家具/洁具对象：${report.summary.furnishingObjectCount}</span>
    </div>
  </header>
  <main>
    <div class="grid">${cardsHtml}</div>
    <section class="panel">
      <div class="panel-title">
        <h2>房间对齐结果</h2>
        <span>这里用于决定先修外围、再修格局、最后修家具洁具。</span>
      </div>
      <table>
        <thead><tr><th>空间</th><th>类型</th><th>状态</th><th>IoU</th><th>中心偏差</th><th>面积偏差</th></tr></thead>
        <tbody>${issueRows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;

  fs.writeFileSync(path.join(outputDir, 'projection-comparison.html'), html, 'utf8');
}

function main() {
  const outputDir = path.resolve(arg('--output', process.cwd()));
  const formalPath = path.resolve(arg('--formal', path.join(outputDir, 'formal-plan.json')));
  const threeDPath = path.resolve(arg('--three-d', path.join(outputDir, '3d-config.json')));
  const sourcePath = path.resolve(arg('--source', path.join(outputDir, 'recognition-input.jpg')));
  const formal = readJson(formalPath, {});
  const threeD = readJson(threeDPath, {});
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'), {});
  const sourceRooms = formal.rooms || [];
  const projectedRooms = normalizeRoomsFrom3d(threeD);
  const projectedWalls = normalizeWallsFromFormal(formal);
  const imageSize = {
    width: num(formal.meta?.image?.width, num(preprocess?.image?.width, 1400)),
    height: num(formal.meta?.image?.height, num(preprocess?.image?.height, 973))
  };
  const matches = matchRooms(sourceRooms, projectedRooms);
  const summary = {
    sourceRoomCount: sourceRooms.length,
    projectedRoomCount: projectedRooms.length,
    alignedRoomCount: matches.filter((match) => match.status === 'aligned').length,
    minorAdjustmentCount: matches.filter((match) => match.status === 'needs_minor_adjustment').length,
    repairCount: matches.filter((match) => match.status === 'needs_repair' || match.status === 'missing_in_3d').length,
    meanOverlap: Number((matches.reduce((sum, match) => sum + match.overlap, 0) / Math.max(1, matches.length)).toFixed(3)),
    furnishingObjectCount: projectedRooms.reduce((sum, room) => sum + (room.furniture || []).length, 0),
    bathroomFixtureCount: projectedRooms
      .filter((room) => room.type === 'bathroom')
      .reduce((sum, room) => sum + (room.furniture || []).filter((item) => ['toilet', 'vanity', 'shower'].includes(item.type)).length, 0)
  };
  const report = {
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    files: {
      sourcePlan: fileNameIfExists(sourcePath),
      formalPlan: path.basename(formalPath),
      formalPlanSvg: fileNameIfExists(path.join(outputDir, 'formal-plan.svg')),
      threeDConfig: path.basename(threeDPath),
      topdownProjection: '3d-topdown-projection.svg',
      rawCoordinateOverlay: 'raw-plan-3d-overlay.svg',
      diffOverlay: 'projection-diff.svg',
      comparisonHtml: 'projection-comparison.html'
    },
    strategy: [
      '先用平面图/布局语义生成 3D 房间壳体和家具对象。',
      '从 3D 房间壳体回投影顶视 2D。',
      '按房间 IoU、中心点偏差、面积偏差找出需要调节的空间。',
      '实际产品中可先修外围，再修室内格局，最后修家具/洁具。'
    ],
    summary,
    matches
  };

  writeProjectionSvg(outputDir, projectedRooms);
  writeDiffSvg(outputDir, matches);
  writeRawCoordinateOverlaySvg(outputDir, report, projectedRooms, projectedWalls, normalizeStructuralWallShells(threeD), imageSize);
  writeComparisonHtml(outputDir, report);
  fs.writeFileSync(path.join(outputDir, 'projection-diff-report.json'), JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify({ output: report.files, summary })}\n`);
}

main();
