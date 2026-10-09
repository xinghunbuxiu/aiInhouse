import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function basename(value) {
  return value ? path.basename(String(value)) : '';
}

function publicImage(value) {
  const name = basename(value);
  return name ? `./${name}` : '';
}

function num(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function lineSvg(wall = {}) {
  const start = wall.start || {};
  const end = wall.end || {};
  const role = wall.wallRole || wall.role || (wall.isExterior ? 'exterior' : 'interior');
  const color = role === 'exterior' ? '#ef4444' : '#f97316';
  const width = Math.max(3, Math.min(14, num(wall.thickness, role === 'exterior' ? 10 : 7)));
  return `<line x1="${num(start.x).toFixed(1)}" y1="${num(start.y).toFixed(1)}" x2="${num(end.x).toFixed(1)}" y2="${num(end.y).toFixed(1)}" stroke="${color}" stroke-width="${width.toFixed(1)}" stroke-opacity="0.82" stroke-linecap="square"><title>${escapeHtml(wall.id || 'wall')}</title></line>`;
}

function openingSvg(opening = {}) {
  const isWindow = opening.type === 'window';
  const color = isWindow ? '#0284c7' : '#f59e0b';
  const needsVisualConfirmation = opening.sourceEvidence?.needsVisualConfirmation || opening.sourceEvidence?.retainedAsSemanticDoorPrior;
  const x = num(opening.x) - num(opening.width, isWindow ? 48 : 28) / 2;
  const y = num(opening.y) - num(opening.height, 8) / 2;
  const width = Math.max(8, num(opening.width, isWindow ? 48 : 28));
  const height = Math.max(8, num(opening.height, 8));
  const review = opening.needsWallAttachmentReview || needsVisualConfirmation ? '#dc2626' : color;
  const dash = needsVisualConfirmation ? ' stroke-dasharray="7 5"' : '';
  const opacity = needsVisualConfirmation ? 0.36 : 0.82;
  return `
    <g data-opening="${escapeHtml(opening.id || '')}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="4" fill="${color}" fill-opacity="${opacity}" stroke="${review}" stroke-width="3"${dash}>
        <title>${escapeHtml(`${opening.type || 'opening'} ${opening.id || ''} ${opening.source || ''}`)}</title>
      </rect>
      <circle cx="${num(opening.x).toFixed(1)}" cy="${num(opening.y).toFixed(1)}" r="5" fill="#fff" stroke="${color}" stroke-width="2"/>
    </g>`;
}

function roomSvg(room = {}) {
  const color = {
    living: '#22c55e',
    bedroom: '#8b5cf6',
    kitchen: '#14b8a6',
    bathroom: '#06b6d4',
    dining: '#eab308',
    balcony: '#0ea5e9',
    entry: '#64748b'
  }[room.type] || '#94a3b8';
  const x = num(room.x);
  const y = num(room.y);
  const width = num(room.width);
  const height = num(room.height);
  return `
    <g data-room="${escapeHtml(room.id || '')}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-width="2" stroke-dasharray="${room.sourceEvidence?.boundaryNeedsReview || room.boundaryNeedsReview ? '10 7' : ''}"/>
      <text x="${(x + width / 2).toFixed(1)}" y="${(y + height / 2).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="900" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeHtml(room.name || room.type || 'room')}</text>
    </g>`;
}

function balconyCandidateSvg(candidate = {}) {
  const x = num(candidate.x);
  const y = num(candidate.y);
  const width = num(candidate.width);
  const height = num(candidate.height);
  return `
    <g data-balcony-candidate="${escapeHtml(candidate.id || '')}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="#06b6d4" fill-opacity="0.08" stroke="#06b6d4" stroke-width="4" stroke-dasharray="14 8"/>
      <text x="${x.toFixed(1)}" y="${Math.max(22, y - 8).toFixed(1)}" font-size="16" font-weight="900" fill="#0891b2" stroke="#fff" stroke-width="3" paint-order="stroke">阳台候选 ${escapeHtml(candidate.confidence ?? '')}</text>
    </g>`;
}

function windowCandidateSvg(candidate = {}, modelCandidate = {}) {
  const x = num(candidate.x);
  const y = num(candidate.y);
  const width = Math.max(6, num(candidate.width));
  const height = Math.max(6, num(candidate.height));
  const accepted = Boolean(modelCandidate.sourceEvidence?.acceptedAsExteriorWindow);
  const color = accepted ? '#059669' : '#2563eb';
  const label = accepted ? '最终窗' : '窗候选';
  return `
    <g data-window-symbol="${escapeHtml(candidate.id || '')}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="3" stroke-dasharray="8 5"/>
      <text x="${x.toFixed(1)}" y="${Math.max(22, y - 8).toFixed(1)}" font-size="14" font-weight="900" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${label} ${escapeHtml(candidate.confidence ?? '')}</text>
    </g>`;
}

function doorCandidateSvg(candidate = {}) {
  const x = num(candidate.x);
  const y = num(candidate.y);
  const width = Math.max(8, num(candidate.width));
  const height = Math.max(8, num(candidate.height));
  return `
    <g data-door-symbol="${escapeHtml(candidate.id || '')}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="#f59e0b" fill-opacity="0.16" stroke="#f59e0b" stroke-width="3" stroke-dasharray="7 5"/>
      <text x="${x.toFixed(1)}" y="${Math.max(22, y - 8).toFixed(1)}" font-size="14" font-weight="900" fill="#b45309" stroke="#fff" stroke-width="3" paint-order="stroke">门候选 ${escapeHtml(candidate.confidence ?? '')}</text>
    </g>`;
}

function symbolCandidateSvg(candidate = {}, fallbackColor = '') {
  const palette = {
    bed: '#8b5cf6',
    sofa_or_table: '#16a34a',
    table_or_fixture: '#0891b2',
    bath_fixture_or_appliance: '#d97706',
    kitchen_appliance: '#db2777',
    floor_heating: '#0ea5e9',
    radiator: '#0284c7',
    hvac_indoor: '#0369a1',
    fresh_air_vent: '#38bdf8',
    power_outlet: '#db2777',
    low_voltage_outlet: '#c026d3',
    switch_single: '#a21caf',
    ceiling_light: '#9333ea',
    light_strip: '#7c3aed'
  };
  const color = fallbackColor || palette[candidate.type] || '#64748b';
  const x = num(candidate.x);
  const y = num(candidate.y);
  const width = Math.max(8, num(candidate.width));
  const height = Math.max(8, num(candidate.height));
  return `
    <g data-symbol="${escapeHtml(candidate.id || '')}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="2"/>
      <text x="${x.toFixed(1)}" y="${Math.max(18, y - 6).toFixed(1)}" font-size="12" font-weight="900" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeHtml(candidate.type || 'symbol')}</text>
    </g>`;
}

function summarizeOpenings(draft) {
  return [...(draft.doors || []), ...(draft.windows || [])].map((opening) => ({
    id: opening.id,
    type: opening.type,
    attachedWallId: opening.attachedWallId || '',
    wallDistance: opening.wallDistance ?? null,
    confidence: opening.confidence ?? null,
    needsReview: Boolean(
      opening.needsWallAttachmentReview
      || opening.sourceEvidence?.needsVisualConfirmation
      || opening.sourceEvidence?.retainedAsSemanticDoorPrior
    ),
    reviewReasons: [
      ...(opening.reviewReasons || []),
      ...(opening.sourceEvidence?.needsVisualConfirmation || opening.sourceEvidence?.retainedAsSemanticDoorPrior ? ['needs-visual-door-confirmation'] : [])
    ]
  }));
}

function buildDiagnostics(outputDir) {
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const draft = readJson(path.join(outputDir, 'recognition-draft.json'));
  const formalPlan = readJson(path.join(outputDir, 'formal-plan.json'));
  const openings = summarizeOpenings(draft);
  const reviewOpenings = openings.filter((opening) => opening.needsReview);
  const wallSources = Object.entries((draft.walls || []).reduce((acc, wall) => {
    const source = wall.source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {})).map(([source, count]) => ({ source, count }));
  const roomSources = Object.entries((draft.rooms || []).reduce((acc, room) => {
    const source = room.source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {})).map(([source, count]) => ({ source, count }));
  const doorSources = Object.entries((draft.doors || []).reduce((acc, door) => {
    const source = door.source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {})).map(([source, count]) => ({ source, count }));
  const windowSources = Object.entries((draft.windows || []).reduce((acc, window) => {
    const source = window.source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {})).map(([source, count]) => ({ source, count }));
  const acceptedWindowSymbols = (draft.floorplanModel?.openings?.windowSymbols || [])
    .filter((candidate) => candidate.sourceEvidence?.acceptedAsExteriorWindow);
  const rejectedWindowSymbols = (draft.floorplanModel?.openings?.windowSymbols || [])
    .filter((candidate) => !candidate.sourceEvidence?.acceptedAsExteriorWindow);
  const confirmedWindows = (draft.windows || []).filter((window) => (
    !window.sourceEvidence?.needsVisualConfirmation
    && window.source !== 'semantic-room-opening-prior'
  ));
  const proposedWindows = (draft.windows || []).filter((window) => (
    window.sourceEvidence?.needsVisualConfirmation
    || window.source === 'semantic-room-opening-prior'
  ));

  return {
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    summary: {
      qualityScore: preprocess.quality?.score ?? null,
      geometryConfidence: draft.confidence?.geometry ?? null,
      semanticsConfidence: draft.confidence?.semantics ?? null,
      roomCount: (draft.rooms || []).length,
      geometryRoomCandidateCount: (draft.geometryRooms || []).length,
      wallCountBefore: draft.topology?.wallCountBefore ?? (preprocess.geometryCandidates?.lines || []).length,
      wallCountAfter: draft.topology?.wallCountAfter ?? (draft.walls || []).length,
      openingCount: openings.length,
      attachedOpeningCount: draft.topology?.attachedOpeningCount ?? openings.filter((opening) => !opening.needsReview).length,
      reviewOpeningCount: reviewOpenings.length,
      formalOpeningCount: (formalPlan.openings || []).length,
      confirmedWindowCount: confirmedWindows.length,
      proposedWindowCount: proposedWindows.length,
      recognitionAssetVersion: preprocess.recognitionAssets?.version || draft.quality?.recognitionAssetVersion || '',
      recognitionAssetMatchCount: preprocess.recognitionAssets?.matchedCandidateCount || draft.quality?.recognitionAssetMatchCount || 0,
      excludedAnnotationLineCount: preprocess.recognitionAssets?.excludedAnnotationLineCount || draft.quality?.excludedAnnotationLineCount || 0
    },
    preprocessing: {
      visionAvailable: Boolean(preprocess.visionAvailable),
      image: preprocess.image || {},
      candidateLineCount: preprocess.geometryCandidates?.lines?.length || 0,
      wallBandCount: preprocess.geometryCandidates?.wallBandCount || 0,
      structuralWallVectorCount: preprocess.geometryCandidates?.structuralWallVectorCount || 0,
      balconyCandidateCount: preprocess.geometryCandidates?.balconyCandidateCount || 0,
      roomInteriorCandidateCount: preprocess.geometryCandidates?.roomInteriorCandidateCount || 0,
      windowSymbolCandidateCount: preprocess.geometryCandidates?.windowSymbolCandidateCount || 0,
      doorSymbolCandidateCount: preprocess.geometryCandidates?.doorSymbolCandidateCount || 0,
      acceptedWindowSymbolCandidateCount: draft.quality?.acceptedWindowSymbolCandidateCount || 0,
      rejectedWindowSymbolCandidateCount: draft.quality?.rejectedWindowSymbolCandidateCount || 0,
      acceptedDoorSymbolCandidateCount: draft.quality?.acceptedDoorSymbolCandidateCount || 0,
      furnitureSymbolCandidateCount: preprocess.geometryCandidates?.furnitureSymbolCandidateCount || 0,
      mepSymbolCandidateCount: preprocess.geometryCandidates?.mepSymbolCandidateCount || 0,
      electricalSymbolCandidateCount: preprocess.geometryCandidates?.electricalSymbolCandidateCount || 0,
      annotationSymbolCandidateCount: preprocess.geometryCandidates?.annotationSymbolCandidateCount || 0,
      recognitionAssetVersion: preprocess.recognitionAssets?.version || '',
      recognitionAssetMatchCount: preprocess.recognitionAssets?.matchedCandidateCount || 0,
      recognitionAssetMatchSummary: preprocess.recognitionAssets?.matchSummary || {},
      candidateContourCount: preprocess.geometryCandidates?.contours?.length || 0,
      debugImages: preprocess.debugImages || {}
    },
    modules: {
      walls: {
        status: (draft.walls || []).length >= Math.max(8, (draft.rooms || []).length * 2) ? 'usable' : 'weak',
        accepted: (draft.walls || []).length,
        rawCandidates: preprocess.geometryCandidates?.lines?.length || 0,
        sources: wallSources
      },
      rooms: {
        status: (draft.rooms || []).length >= 2 ? 'usable' : 'weak',
        accepted: (draft.rooms || []).length,
        rawCandidates: preprocess.geometryCandidates?.roomInteriorCandidateCount || 0,
        sources: roomSources
      },
      windows: {
        status: acceptedWindowSymbols.length || (draft.windows || []).length ? 'usable' : 'weak',
        accepted: confirmedWindows.length,
        proposed: proposedWindows.length,
        rawSymbolCandidates: preprocess.geometryCandidates?.windowSymbolCandidateCount || 0,
        acceptedSymbolCandidates: acceptedWindowSymbols.length,
        rejectedSymbolCandidates: rejectedWindowSymbols.length,
        sources: windowSources
      },
      doors: {
        status: (draft.doors || []).some((door) => door.source && door.source !== 'semantic-room-opening-prior') ? 'visual' : ((draft.doors || []).length ? 'semantic-only' : 'missing'),
        accepted: (draft.doors || []).length,
        rawSymbolCandidates: preprocess.geometryCandidates?.doorSymbolCandidateCount || 0,
        acceptedSymbolCandidates: draft.quality?.acceptedDoorSymbolCandidateCount || 0,
        sources: doorSources,
        limitation: (draft.doors || []).some((door) => door.source && door.source !== 'semantic-room-opening-prior') ? '' : 'visual-door-scanner-not-yet-stable'
      },
      balconies: {
        status: preprocess.geometryCandidates?.balconyCandidateCount ? 'has-candidates' : 'missing',
        rawCandidates: preprocess.geometryCandidates?.balconyCandidateCount || 0,
        acceptedRooms: (draft.rooms || []).filter((room) => room.type === 'balcony').length
      },
      symbols: {
        status: draft.floorplanModel?.symbols?.all?.length ? 'usable' : 'weak',
        rawFurnitureCandidates: preprocess.geometryCandidates?.furnitureSymbolCandidateCount || 0,
        accepted: draft.floorplanModel?.symbols?.all?.length || 0,
        rejected: draft.floorplanModel?.symbols?.rejected?.length || 0,
        annotations: preprocess.geometryCandidates?.annotationSymbolCandidateCount || 0
      }
    },
    floorplanModel: {
      scannerCount: draft.floorplanModel?.scannerCatalog?.length || 0,
      structuralWallCount: draft.floorplanModel?.structural?.walls?.length || 0,
      roomCellCount: draft.floorplanModel?.spaces?.roomCells?.length || 0,
      windowSymbolCount: draft.floorplanModel?.openings?.windowSymbolCount || 0,
      symbolCount: draft.floorplanModel?.symbols?.all?.length || 0
    },
    topology: draft.topology || {},
    wallSources,
    roomSources,
    openings,
    geometryRooms: draft.geometryRooms || [],
    reviewOpenings,
    issues: draft.issues || [],
    nextActions: [
      '优先复核 needsReview=true 的门窗，并把它们拖到正确墙线上。',
      '如果 wallBandCount 很低，建议上传更清晰的平面图或调整二值化参数。',
      '确认 formal-plan.json 后再进入 Blender 高质量渲染。'
    ]
  };
}

function buildProjectionReview(outputDir, diagnostics) {
  const formalPlan = readJson(path.join(outputDir, 'formal-plan.json'));
  const config3d = readJson(path.join(outputDir, '3d-config.json'));
  const confirmedOpenings = formalPlan.openings || [];
  const proposedOpenings = formalPlan.proposedOpenings || [];
  const reviewOpenings = diagnostics.openings.filter((opening) => opening.needsReview);
  const proposedByType = proposedOpenings.reduce((acc, opening) => {
    const type = opening.type || 'opening';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const reviewItems = proposedOpenings.map((opening) => ({
    id: opening.id,
    type: opening.type || 'opening',
    source: opening.source || '',
    x: opening.x ?? opening.center?.x ?? null,
    y: opening.y ?? opening.center?.y ?? null,
    width: opening.width ?? opening.widthPx ?? null,
    height: opening.height ?? opening.heightPx ?? null,
    attachedWallId: opening.attachedWallId || opening.sourceEvidence?.attachedWallId || '',
    wallDistance: opening.wallDistance ?? opening.sourceEvidence?.wallDistance ?? null,
    reasons: [
      ...(opening.reviewReasons || []),
      opening.sourceEvidence?.needsVisualConfirmation ? 'needs-visual-confirmation' : '',
      opening.sourceEvidence?.proposedBalconyOutlineWindow ? 'balcony-outline-window-proposed' : '',
      opening.sourceEvidence?.inferredFrom === 'entry-room-exterior-door-prior' ? 'entry-door-prior' : ''
    ].filter(Boolean)
  }));

  return {
    status: reviewItems.length ? 'review_required' : 'passed',
    summary: {
      confirmedOpeningCount: confirmedOpenings.length,
      proposedOpeningCount: proposedOpenings.length,
      reviewOpeningCount: reviewOpenings.length,
      threeDConfirmedOpeningCount: (config3d.openings || []).length,
      threeDProposedOpeningCount: (config3d.proposedOpenings || []).length,
      proposedByType
    },
    reviewItems
  };
}

function writeOverlaySvg(outputDir, diagnostics) {
  const draft = readJson(path.join(outputDir, 'recognition-draft.json'));
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const image = diagnostics.preprocessing.image || {};
  const width = num(image.width, 1400);
  const height = num(image.height, 973);
  const sourceImage = publicImage(preprocess.preprocessedImagePath || path.join(outputDir, 'recognition-input.jpg')) || './recognition-input.jpg';
  const rooms = (draft.rooms || []).map(roomSvg).join('\n');
  const walls = (draft.walls || []).map(lineSvg).join('\n');
  const doors = (draft.doors || []).map(openingSvg).join('\n');
  const windows = (draft.windows || []).map(openingSvg).join('\n');
  const balconyCandidates = (preprocess.geometryCandidates?.balconyCandidates || []).map(balconyCandidateSvg).join('\n');
  const modelWindowSymbols = new Map((draft.floorplanModel?.openings?.windowSymbols || []).map((candidate) => [candidate.sourceEvidence?.scannerId || candidate.id, candidate]));
  const windowCandidates = (preprocess.geometryCandidates?.windowSymbolCandidates || [])
    .map((candidate) => windowCandidateSvg(candidate, modelWindowSymbols.get(candidate.id)))
    .join('\n');
  const doorCandidates = (preprocess.geometryCandidates?.doorSymbolCandidates || []).map(doorCandidateSvg).join('\n');
  const symbolCandidates = (preprocess.geometryCandidates?.furnitureSymbolCandidates || []).map(symbolCandidateSvg).join('\n');
  const mepCandidates = (preprocess.geometryCandidates?.mepSymbolCandidates || []).map((candidate) => symbolCandidateSvg(candidate, '#0ea5e9')).join('\n');
  const electricalCandidates = (preprocess.geometryCandidates?.electricalSymbolCandidates || []).map((candidate) => symbolCandidateSvg(candidate, '#db2777')).join('\n');
  const legend = [
    ['外墙', '#ef4444'],
    ['内墙', '#f97316'],
    ['门', '#f59e0b'],
    ['窗', '#0284c7'],
    ['最终窗候选', '#059669'],
    ['未采用窗候选', '#2563eb'],
    ['家具/洁具候选', '#8b5cf6'],
    ['暖通地暖', '#0ea5e9'],
    ['电气点位', '#db2777'],
    ['阳台候选', '#06b6d4']
  ].map(([label, color], index) => {
    const x = 24 + index * 108;
    return `<g><rect x="${x}" y="20" width="24" height="16" rx="3" fill="${color}" fill-opacity="0.85"/><text x="${x + 32}" y="34" font-size="15" font-weight="800" fill="#0f172a">${escapeHtml(label)}</text></g>`;
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="${escapeHtml(sourceImage)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" opacity="0.05"/>
  <g data-layer="rooms">${rooms}</g>
  <g data-layer="balcony-candidates">${balconyCandidates}</g>
  <g data-layer="window-symbol-candidates">${windowCandidates}</g>
  <g data-layer="door-symbol-candidates">${doorCandidates}</g>
  <g data-layer="symbol-candidates">${symbolCandidates}</g>
  <g data-layer="mep-symbol-candidates">${mepCandidates}</g>
  <g data-layer="electrical-symbol-candidates">${electricalCandidates}</g>
  <g data-layer="walls">${walls}</g>
  <g data-layer="doors">${doors}</g>
  <g data-layer="windows">${windows}</g>
  <rect x="14" y="10" width="${Math.min(width - 28, 680)}" height="38" rx="8" fill="#fff" fill-opacity="0.88" stroke="#cbd5e1"/>
  ${legend}
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'recognition-overlay.svg'), svg, 'utf8');
}

function writeWallStageProjectionSvg(outputDir) {
  const draft = readJson(path.join(outputDir, 'recognition-draft.json'));
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const image = preprocess.image || {};
  const width = num(image.width, 1400);
  const height = num(image.height, 973);
  const sourceImage = publicImage(preprocess.preprocessedImagePath || path.join(outputDir, 'recognition-input.jpg')) || './recognition-input.jpg';
  const wallStage = (draft.floorplanModel?.stages || []).find((stage) => stage.stage === 'walls') || {};
  const raw = (wallStage.rawCandidates || []).map((line) => {
    const start = line.start || {};
    const end = line.end || {};
    return `<line x1="${num(start.x).toFixed(1)}" y1="${num(start.y).toFixed(1)}" x2="${num(end.x).toFixed(1)}" y2="${num(end.y).toFixed(1)}" stroke="#94a3b8" stroke-width="${Math.max(2, Math.min(8, num(line.thickness, 4))).toFixed(1)}" stroke-opacity="0.34"/>`;
  }).join('\n');
  const accepted = (wallStage.accepted || []).map((line) => {
    const start = line.start || {};
    const end = line.end || {};
    return `<line x1="${num(start.x).toFixed(1)}" y1="${num(start.y).toFixed(1)}" x2="${num(end.x).toFixed(1)}" y2="${num(end.y).toFixed(1)}" stroke="#dc2626" stroke-width="${Math.max(4, Math.min(14, num(line.thickness, 8))).toFixed(1)}" stroke-opacity="0.78"><title>${escapeHtml(line.id || '')}</title></line>`;
  }).join('\n');
  const shells = (wallStage.model3d?.wallShells || []).map((shell) => {
    const start = shell.start || {};
    const end = shell.end || {};
    return `<line x1="${num(start.x).toFixed(1)}" y1="${num(start.y).toFixed(1)}" x2="${num(end.x).toFixed(1)}" y2="${num(end.y).toFixed(1)}" stroke="#2563eb" stroke-width="2" stroke-opacity="0.9" stroke-dasharray="8 6"><title>${escapeHtml(shell.id || '')}</title></line>`;
  }).join('\n');
  const metrics = wallStage.metrics || {};
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="${escapeHtml(sourceImage)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" opacity="0.18"/>
  <g data-layer="raw-wall-candidates">${raw}</g>
  <g data-layer="accepted-wall-model">${accepted}</g>
  <g data-layer="projected-3d-wall-shells">${shells}</g>
  <rect x="18" y="16" width="600" height="58" rx="8" fill="#fff" fill-opacity="0.92" stroke="#cbd5e1"/>
  <text x="34" y="40" font-size="16" font-weight="900" fill="#0f172a">墙体闭环: raw ${escapeHtml(metrics.rawCandidateCount ?? 0)} / accepted ${escapeHtml(metrics.acceptedCount ?? 0)} / coverage ${escapeHtml(metrics.rawCoverageRatio ?? '-')}</text>
  <text x="34" y="62" font-size="13" fill="#475569">灰=原始候选, 红=采用墙体, 蓝虚线=3D墙壳回投</text>
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'wall-stage-projection.svg'), svg, 'utf8');
}

function writeRoomsStageProjectionSvg(outputDir) {
  const draft = readJson(path.join(outputDir, 'recognition-draft.json'));
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const image = preprocess.image || {};
  const width = num(image.width, 1400);
  const height = num(image.height, 973);
  const sourceImage = publicImage(preprocess.preprocessedImagePath || path.join(outputDir, 'recognition-input.jpg')) || './recognition-input.jpg';
  const roomStage = (draft.floorplanModel?.stages || []).find((stage) => stage.stage === 'rooms') || {};
  const rawInteriors = (roomStage.rawCandidates?.roomInteriors || []).map((candidate) => `
    <rect x="${num(candidate.x).toFixed(1)}" y="${num(candidate.y).toFixed(1)}" width="${num(candidate.width).toFixed(1)}" height="${num(candidate.height).toFixed(1)}" fill="#64748b" fill-opacity="0.08" stroke="#64748b" stroke-width="2" stroke-dasharray="5 5">
      <title>${escapeHtml(candidate.id || 'room-interior')}</title>
    </rect>
  `).join('\n');
  const rawBalconies = (roomStage.rawCandidates?.balconyCandidates || []).map((candidate) => `
    <rect x="${num(candidate.x).toFixed(1)}" y="${num(candidate.y).toFixed(1)}" width="${num(candidate.width).toFixed(1)}" height="${num(candidate.height).toFixed(1)}" fill="#06b6d4" fill-opacity="0.10" stroke="#0891b2" stroke-width="4" stroke-dasharray="12 7">
      <title>${escapeHtml(candidate.id || 'balcony-candidate')}</title>
    </rect>
  `).join('\n');
  const rejectedBalconies = (roomStage.rejected?.balconyCandidates || []).map((candidate) => `
    <rect x="${num(candidate.x).toFixed(1)}" y="${num(candidate.y).toFixed(1)}" width="${num(candidate.width).toFixed(1)}" height="${num(candidate.height).toFixed(1)}" fill="#ef4444" fill-opacity="0.08" stroke="#dc2626" stroke-width="4" stroke-dasharray="6 5">
      <title>${escapeHtml(`${candidate.id || 'rejected-balcony'} ${candidate.classifiedAs || 'rejected'} ${(candidate.rejectReasons || []).join(', ')}`)}</title>
    </rect>
  `).join('\n');
  const acceptedRooms = (roomStage.accepted || []).map(roomSvg).join('\n');
  const projectedVolumes = (roomStage.model3d?.roomVolumes || []).map((volume) => {
    const bounds = volume.bounds || {};
    return `
      <rect x="${num(bounds.x).toFixed(1)}" y="${num(bounds.y).toFixed(1)}" width="${num(bounds.width).toFixed(1)}" height="${num(bounds.height).toFixed(1)}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="9 6">
        <title>${escapeHtml(volume.id || 'room-volume')}</title>
      </rect>`;
  }).join('\n');
  const metrics = roomStage.metrics || {};
  const review = (roomStage.review || []).join(', ') || 'none';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="${escapeHtml(sourceImage)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" opacity="0.16"/>
  <g data-layer="raw-room-interiors">${rawInteriors}</g>
  <g data-layer="raw-balcony-candidates">${rawBalconies}</g>
  <g data-layer="rejected-balcony-candidates">${rejectedBalconies}</g>
  <g data-layer="accepted-rooms">${acceptedRooms}</g>
  <g data-layer="projected-3d-room-volumes">${projectedVolumes}</g>
  <rect x="18" y="16" width="790" height="78" rx="8" fill="#fff" fill-opacity="0.93" stroke="#cbd5e1"/>
  <text x="34" y="40" font-size="16" font-weight="900" fill="#0f172a">房间闭环: raw room ${escapeHtml(metrics.rawRoomInteriorCandidateCount ?? 0)} / raw balcony ${escapeHtml(metrics.rawBalconyCandidateCount ?? 0)} / accepted ${escapeHtml(metrics.acceptedCount ?? 0)} / balcony ${escapeHtml(metrics.acceptedBalconyCount ?? 0)}</text>
  <text x="34" y="62" font-size="13" fill="#475569">灰虚线=原始房间内腔, 青虚线=阳台候选, 红虚线=已归类误报, 彩色=采用房间, 蓝虚线=3D房间体块回投</text>
  <text x="34" y="82" font-size="13" fill="#b45309">review: ${escapeHtml(review)}</text>
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'rooms-stage-projection.svg'), svg, 'utf8');
}

function stageOpeningRectSvg(opening = {}, options = {}) {
  const cx = num(opening.x ?? opening.center?.x);
  const cy = num(opening.y ?? opening.center?.y);
  const width = Math.max(6, num(opening.width ?? opening.widthPx, options.defaultWidth || 24));
  const height = Math.max(6, num(opening.height ?? opening.heightPx, options.defaultHeight || 12));
  const x = cx - width / 2;
  const y = cy - height / 2;
  const label = options.label || opening.type || 'opening';
  const dash = options.dash ? ` stroke-dasharray="${options.dash}"` : '';
  const fillOpacity = options.fillOpacity ?? 0.14;
  const strokeWidth = options.strokeWidth ?? 3;
  const text = options.text || '';
  return `
    <g data-stage-opening="${escapeHtml(opening.id || opening.sourceOpeningId || '')}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="3" fill="${options.color}" fill-opacity="${fillOpacity}" stroke="${options.color}" stroke-width="${strokeWidth}"${dash}>
        <title>${escapeHtml(`${label} ${opening.id || opening.sourceOpeningId || ''}`)}</title>
      </rect>
      ${options.showCenter === false ? '' : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="#fff" stroke="${options.color}" stroke-width="2"/>`}
      ${text ? `<text x="${Math.max(12, x).toFixed(1)}" y="${Math.max(24, y - 8).toFixed(1)}" font-size="15" font-weight="900" fill="${options.color}" stroke="#fff" stroke-width="4" paint-order="stroke">${escapeHtml(text)}</text>` : ''}
    </g>`;
}

function writeConfirmedWindowsProjectionSvg(outputDir) {
  const draft = readJson(path.join(outputDir, 'recognition-draft.json'));
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const image = preprocess.image || {};
  const width = num(image.width, 1400);
  const height = num(image.height, 973);
  const sourceImage = publicImage(preprocess.preprocessedImagePath || path.join(outputDir, 'recognition-input.jpg')) || './recognition-input.jpg';
  const windows = draft.windows || [];
  const confirmed = windows.filter((opening) => (
    !opening.sourceEvidence?.needsVisualConfirmation
    && opening.source !== 'semantic-room-opening-prior'
  ));
  const proposed = windows.filter((opening) => (
    opening.sourceEvidence?.needsVisualConfirmation
    || opening.source === 'semantic-room-opening-prior'
  ));
  const proposedSvg = proposed.map((opening) => stageOpeningRectSvg(opening, {
    color: '#64748b',
    label: 'proposed-window-needs-review',
    dash: '5 7',
    fillOpacity: 0.025,
    strokeWidth: 1,
    showCenter: false
  })).join('\n');
  const confirmedSvg = confirmed.map((opening, index) => stageOpeningRectSvg(opening, {
    color: '#059669',
    label: `confirmed-window-${index + 1}`,
    fillOpacity: 0.22,
    strokeWidth: 5,
    text: `确认窗 ${index + 1}`
  })).join('\n');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="${escapeHtml(sourceImage)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" opacity="0.08"/>
  <g data-layer="proposed-windows">${proposedSvg}</g>
  <g data-layer="confirmed-windows">${confirmedSvg}</g>
  <rect x="18" y="16" width="610" height="62" rx="8" fill="#fff" fill-opacity="0.94" stroke="#cbd5e1"/>
  <text x="34" y="42" font-size="18" font-weight="900" fill="#0f172a">窗户最终审核: 确认 ${confirmed.length} / 待复核 ${proposed.length}</text>
  <text x="34" y="65" font-size="13" fill="#475569">绿色实线=进入 3D 开洞；浅灰虚线=候选证据，不进入最终模型</text>
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'confirmed-windows-projection.svg'), svg, 'utf8');
}

function writeOpeningsStageProjectionSvg(outputDir) {
  const draft = readJson(path.join(outputDir, 'recognition-draft.json'));
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const image = preprocess.image || {};
  const width = num(image.width, 1400);
  const height = num(image.height, 973);
  const sourceImage = publicImage(preprocess.preprocessedImagePath || path.join(outputDir, 'recognition-input.jpg')) || './recognition-input.jpg';
  const openingsStage = (draft.floorplanModel?.stages || []).find((stage) => stage.stage === 'openings') || {};
  const rawWindows = (openingsStage.rawCandidates?.windowSymbols || []).map((opening) => (
    stageOpeningRectSvg(opening, { color: '#2563eb', label: 'raw-window-symbol', dash: '7 5', fillOpacity: 0.10, strokeWidth: 2 })
  )).join('\n');
  const rawDoors = (openingsStage.rawCandidates?.doorSymbols || []).map((opening) => (
    stageOpeningRectSvg(opening, { color: '#f59e0b', label: 'raw-door-symbol', dash: '7 5', fillOpacity: 0.10, strokeWidth: 2 })
  )).join('\n');
  const rejectedWindows = (openingsStage.rejected?.windowSymbols || []).map((opening) => (
    stageOpeningRectSvg(opening, { color: '#dc2626', label: 'rejected-window-symbol', dash: '4 5', fillOpacity: 0.08, strokeWidth: 2 })
  )).join('\n');
  const rejectedDoors = (openingsStage.rejected?.doorSymbols || []).map((opening) => (
    stageOpeningRectSvg(opening, { color: '#b45309', label: 'rejected-door-symbol', dash: '4 5', fillOpacity: 0.08, strokeWidth: 2 })
  )).join('\n');
  const confirmedOpenings = openingsStage.model3d?.confirmedOpenings || [];
  const proposedOpenings = openingsStage.model3d?.proposedOpenings || [];
  const acceptedWindows = confirmedOpenings.filter((opening) => opening.type === 'window').map((opening, index) => (
    stageOpeningRectSvg(opening, { color: '#059669', label: 'accepted-window', fillOpacity: 0.24, strokeWidth: 4, text: `确认窗 ${index + 1}` })
  )).join('\n');
  const proposedWindows = proposedOpenings.filter((opening) => opening.type === 'window').map((opening) => (
    stageOpeningRectSvg(opening, { color: '#64748b', label: 'proposed-window', dash: '5 7', fillOpacity: 0.03, strokeWidth: 1, showCenter: false })
  )).join('\n');
  const visualDoors = (openingsStage.accepted?.doors || []).filter((opening) => opening.source !== 'semantic-room-opening-prior');
  const semanticDoors = (openingsStage.accepted?.doors || []).filter((opening) => opening.source === 'semantic-room-opening-prior');
  const acceptedDoors = visualDoors.map((opening) => (
    stageOpeningRectSvg(opening, { color: '#f59e0b', label: 'accepted-door', fillOpacity: 0.24, strokeWidth: 4 })
  )).join('\n');
  const semanticDoorPriors = semanticDoors.map((opening) => (
    stageOpeningRectSvg(opening, { color: '#b45309', label: 'semantic-door-prior-needs-review', dash: '9 6', fillOpacity: 0.08, strokeWidth: 3 })
  )).join('\n');
  const projectedCuts = (openingsStage.model3d?.confirmedOpenings || openingsStage.model3d?.openings || [])
    .filter((opening) => opening.source !== 'semantic-room-opening-prior')
    .map((opening) => (
    stageOpeningRectSvg(opening, { color: '#7c3aed', label: '3d-opening-cut-projection', dash: '10 6', fillOpacity: 0.04, strokeWidth: 2, showCenter: false })
  )).join('\n');
  const metrics = openingsStage.metrics || {};
  const review = (openingsStage.review || []).join(', ') || 'none';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="${escapeHtml(sourceImage)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" opacity="0.16"/>
  <g data-layer="raw-window-symbols">${rawWindows}</g>
  <g data-layer="raw-door-symbols">${rawDoors}</g>
  <g data-layer="rejected-window-symbols">${rejectedWindows}</g>
  <g data-layer="rejected-door-symbols">${rejectedDoors}</g>
  <g data-layer="accepted-windows">${acceptedWindows}</g>
  <g data-layer="proposed-windows">${proposedWindows}</g>
  <g data-layer="accepted-doors">${acceptedDoors}</g>
  <g data-layer="semantic-door-priors">${semanticDoorPriors}</g>
  <g data-layer="projected-3d-opening-cuts">${projectedCuts}</g>
  <rect x="18" y="16" width="760" height="78" rx="8" fill="#fff" fill-opacity="0.93" stroke="#cbd5e1"/>
  <text x="34" y="40" font-size="16" font-weight="900" fill="#0f172a">开口闭环: raw window ${escapeHtml(metrics.rawWindowSymbolCount ?? 0)} / raw door ${escapeHtml(metrics.rawDoorSymbolCount ?? 0)} / accepted window ${escapeHtml(metrics.acceptedWindowCount ?? 0)} / door ${escapeHtml(metrics.acceptedDoorCount ?? 0)}</text>
  <text x="34" y="62" font-size="13" fill="#475569">蓝虚线=原始窗, 绿实线=确认窗, 灰虚线=待复核窗, 橙实线=视觉门, 棕虚线=语义门待确认, 紫虚线=3D开口回投</text>
  <text x="34" y="82" font-size="13" fill="#b45309">review: ${escapeHtml(review)}</text>
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'openings-stage-projection.svg'), svg, 'utf8');
}

function writeHtml(outputDir, diagnostics) {
  const projectionReview = readJson(path.join(outputDir, 'projection-review.json'), { reviewItems: [], summary: {} });
  const sourceReview = readJson(path.join(outputDir, 'formal-vs-source-review.json'), { rawDoorCoverage: [], rawWindowCoverage: [], summary: {} });
  const debug = diagnostics.preprocessing.debugImages || {};
  const imageCards = [
    ['原图识别叠图', './recognition-overlay.svg'],
    ['正式图 vs 原图证据', './formal-vs-source-review.svg'],
    ['墙体闭环回投', './wall-stage-projection.svg'],
    ['房间/阳台闭环回投', './rooms-stage-projection.svg'],
    ['确认窗最终审核', './confirmed-windows-projection.svg'],
    ['门窗开口闭环回投', './openings-stage-projection.svg'],
    ['边缘图', publicImage(debug.edges)],
    ['二值墙体图', publicImage(debug.binary)],
    ['房间内腔候选图', publicImage(debug.roomInteriors)],
    ['窗户符号候选图', publicImage(debug.windowCandidates)],
    ['门洞候选图', publicImage(debug.doorCandidates)],
    ['家具洁具候选图', publicImage(debug.symbolCandidates)],
    ['厚墙候选图', publicImage(debug.wallBands)],
    ['结构墙向量图', publicImage(debug.structuralWallVectors)],
    ['正式平面图', './formal-plan.svg']
  ].filter(([, src]) => src);
  const issueItems = diagnostics.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('');
  const openingRows = diagnostics.openings.map((opening) => `
    <tr>
      <td>${escapeHtml(opening.id)}</td>
      <td>${escapeHtml(opening.type)}</td>
      <td>${escapeHtml(opening.attachedWallId || '-')}</td>
      <td>${escapeHtml(opening.wallDistance ?? '-')}</td>
      <td>${escapeHtml(opening.confidence ?? '-')}</td>
      <td>${opening.needsReview ? '<span class="bad">需复核</span>' : '<span class="ok">OK</span>'}</td>
      <td>${escapeHtml((opening.reviewReasons || []).join(', ') || '-')}</td>
    </tr>
  `).join('');
  const suppressedDoorRows = (diagnostics.topology?.suppressedSemanticDoors || []).map((door) => `
    <tr>
      <td>${escapeHtml(door.id)}</td>
      <td>${escapeHtml(door.reason || '-')}</td>
      <td>${escapeHtml(door.attachedWallId || '-')}</td>
      <td>${escapeHtml(door.wallDistance ?? '-')}</td>
    </tr>
  `).join('');
  const roomSourceItems = diagnostics.roomSources.map((item) => `<li>${escapeHtml(item.source)}: ${item.count}</li>`).join('');
  const moduleRows = Object.entries(diagnostics.modules || {}).map(([name, module]) => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(module.status || '-')}</td>
      <td>${escapeHtml(module.accepted ?? module.acceptedRooms ?? '-')}</td>
      <td>${escapeHtml(module.rawCandidates ?? module.rawSymbolCandidates ?? module.rawFurnitureCandidates ?? '-')}</td>
      <td>${escapeHtml(module.limitation || '')}</td>
    </tr>
  `).join('');
  const projectionRows = (projectionReview.reviewItems || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(`${item.x ?? '-'}, ${item.y ?? '-'}`)}</td>
      <td>${escapeHtml(`${item.width ?? '-'} x ${item.height ?? '-'}`)}</td>
      <td>${escapeHtml(item.attachedWallId || '-')}</td>
      <td>${escapeHtml(item.wallDistance ?? '-')}</td>
      <td>${escapeHtml((item.reasons || []).join(', ') || '-')}</td>
    </tr>
  `).join('');
  const sourceMissingRows = [
    ...(sourceReview.rawDoorCoverage || []).filter((item) => !item.covered),
    ...(sourceReview.rawWindowCoverage || []).filter((item) => !item.covered)
  ].map((item) => `
    <tr>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(`${item.x ?? '-'}, ${item.y ?? '-'}`)}</td>
      <td>${escapeHtml(`${item.width ?? '-'} x ${item.height ?? '-'}`)}</td>
      <td>${escapeHtml(item.distance ?? '-')}</td>
      <td>${escapeHtml(item.classification || item.status || '-')}</td>
      <td>${escapeHtml(item.recommendedAction || '-')}</td>
      <td>${escapeHtml(item.classificationReason || '-')}</td>
    </tr>
  `).join('');
  const proposedRoomConflictRows = (sourceReview.proposedRoomConflicts || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.sourceCandidateId || '-')}</td>
      <td>${escapeHtml(`${item.x ?? '-'}, ${item.y ?? '-'}`)}</td>
      <td>${escapeHtml(`${item.width ?? '-'} x ${item.height ?? '-'}`)}</td>
      <td>${escapeHtml(item.classification || '-')}</td>
      <td>${escapeHtml(item.recommendedAction || '-')}</td>
      <td>${escapeHtml((item.overlappingRooms || []).map((room) => `${room.id}:${room.overlapRatio}`).join(', ') || '-')}</td>
      <td>${escapeHtml(item.reason || '-')}</td>
    </tr>
  `).join('');
  const imageMarkup = imageCards.map(([label, src]) => `
    <figure>
      <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" />
      <figcaption>${escapeHtml(label)}</figcaption>
    </figure>
  `).join('');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>AIInHouse 识别诊断</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a}
    header{padding:28px 32px;background:#0f172a;color:#fff}
    h1{margin:0;font-size:28px} main{padding:24px 32px;display:grid;gap:22px}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
    .stat,.panel{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px}
    .stat b{display:block;font-size:26px;margin-top:6px}.muted{color:#64748b}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
    figure{margin:0;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
    img{display:block;width:100%;height:280px;object-fit:contain;background:#020617}
    figcaption{padding:10px 12px;color:#475569}
    table{width:100%;border-collapse:collapse;background:#fff}th,td{border-bottom:1px solid #e2e8f0;padding:10px;text-align:left;font-size:14px}th{background:#f1f5f9}
    .ok{color:#047857;font-weight:700}.bad{color:#b91c1c;font-weight:700}
    li{margin:7px 0}
  </style>
</head>
<body>
  <header><h1>识别诊断报告</h1><p class="muted">本报告只使用本地 OpenCV / 规则识别结果，不包含付费 API 调用。</p></header>
  <main>
    <section class="stats">
      <div class="stat"><span>质量分</span><b>${escapeHtml(diagnostics.summary.qualityScore ?? '-')}</b></div>
      <div class="stat"><span>房间</span><b>${diagnostics.summary.roomCount}</b></div>
      <div class="stat"><span>几何候选房间</span><b>${diagnostics.summary.geometryRoomCandidateCount}</b></div>
      <div class="stat"><span>墙线</span><b>${diagnostics.summary.wallCountAfter}</b></div>
      <div class="stat"><span>确认窗</span><b>${diagnostics.summary.confirmedWindowCount}</b></div>
      <div class="stat"><span>窗待复核</span><b>${diagnostics.summary.proposedWindowCount}</b></div>
      <div class="stat"><span>窗符号采用</span><b>${diagnostics.preprocessing.acceptedWindowSymbolCandidateCount}/${diagnostics.preprocessing.windowSymbolCandidateCount}</b></div>
      <div class="stat"><span>门符号采用</span><b>${diagnostics.preprocessing.acceptedDoorSymbolCandidateCount}/${diagnostics.preprocessing.doorSymbolCandidateCount}</b></div>
      <div class="stat"><span>语义门剪掉</span><b>${(diagnostics.topology?.suppressedSemanticDoors || []).length}</b></div>
      <div class="stat"><span>家具候选</span><b>${diagnostics.preprocessing.furnitureSymbolCandidateCount}</b></div>
      <div class="stat"><span>暖通候选</span><b>${diagnostics.preprocessing.mepSymbolCandidateCount}</b></div>
      <div class="stat"><span>电气候选</span><b>${diagnostics.preprocessing.electricalSymbolCandidateCount}</b></div>
      <div class="stat"><span>辅助标注</span><b>${diagnostics.preprocessing.annotationSymbolCandidateCount}</b></div>
      <div class="stat"><span>门窗需复核</span><b>${diagnostics.summary.reviewOpeningCount}</b></div>
      <div class="stat"><span>原图窗未覆盖</span><b>${escapeHtml(sourceReview.summary?.missingRawWindowEvidenceCount ?? '-')}</b></div>
      <div class="stat"><span>原图门未覆盖</span><b>${escapeHtml(sourceReview.summary?.missingRawDoorEvidenceCount ?? '-')}</b></div>
      <div class="stat"><span>图例匹配</span><b>${escapeHtml(diagnostics.summary.recognitionAssetMatchCount ?? '-')}</b></div>
      <div class="stat"><span>图例资产版本</span><b>${escapeHtml(diagnostics.summary.recognitionAssetVersion || '-')}</b></div>
    </section>
    <section class="grid">${imageMarkup}</section>
    <section class="panel"><h2>正式图 vs 原图证据</h2><p class="muted">raw door ${escapeHtml(sourceReview.summary?.rawDoorEvidenceCount ?? '-')} / missing ${escapeHtml(sourceReview.summary?.missingRawDoorEvidenceCount ?? '-')}；raw window ${escapeHtml(sourceReview.summary?.rawWindowEvidenceCount ?? '-')} / missing ${escapeHtml(sourceReview.summary?.missingRawWindowEvidenceCount ?? '-')}。missing 表示原图候选没有被 formal-plan 的 confirmed/proposed 开口覆盖。</p><table><thead><tr><th>ID</th><th>类型</th><th>左上角</th><th>尺寸</th><th>最近距离</th><th>分类</th><th>建议动作</th><th>原因</th></tr></thead><tbody>${sourceMissingRows || '<tr><td colspan="8">暂无</td></tr>'}</tbody></table></section>
    <section class="panel"><h2>阳台候选 vs 房间边界</h2><p class="muted">这里列出已从原图轮廓识别到、但还未进入 confirmed 房间的阳台候选。若分类为 covered_by_accepted_rooms，说明当前正式房间边界覆盖了该阳台，需要先修房间分割再确认阳台。</p><table><thead><tr><th>ID</th><th>原始候选</th><th>左上角</th><th>尺寸</th><th>分类</th><th>建议动作</th><th>重叠房间</th><th>原因</th></tr></thead><tbody>${proposedRoomConflictRows || '<tr><td colspan="8">暂无</td></tr>'}</tbody></table></section>
    <section class="panel"><h2>2D/3D 回投复核</h2><p class="muted">confirmed ${escapeHtml(projectionReview.summary?.confirmedOpeningCount ?? '-')} / proposed ${escapeHtml(projectionReview.summary?.proposedOpeningCount ?? '-')} / 3D confirmed ${escapeHtml(projectionReview.summary?.threeDConfirmedOpeningCount ?? '-')}</p><table><thead><tr><th>ID</th><th>类型</th><th>中心</th><th>尺寸</th><th>墙体</th><th>距离</th><th>原因</th></tr></thead><tbody>${projectionRows || '<tr><td colspan="7">暂无</td></tr>'}</tbody></table></section>
    <section class="panel"><h2>模块识别状态</h2><table><thead><tr><th>模块</th><th>状态</th><th>采用</th><th>候选</th><th>限制</th></tr></thead><tbody>${moduleRows}</tbody></table></section>
    <section class="panel"><h2>房间来源</h2><ul>${roomSourceItems || '<li>暂无</li>'}</ul></section>
    <section class="panel"><h2>门窗贴墙状态</h2><table><thead><tr><th>ID</th><th>类型</th><th>墙体</th><th>距离</th><th>置信度</th><th>状态</th><th>原因</th></tr></thead><tbody>${openingRows}</tbody></table></section>
    <section class="panel"><h2>已剪掉语义门</h2><table><thead><tr><th>ID</th><th>原因</th><th>墙体</th><th>距离</th></tr></thead><tbody>${suppressedDoorRows || '<tr><td colspan="4">暂无</td></tr>'}</tbody></table></section>
    <section class="panel"><h2>识别问题</h2><ul>${issueItems || '<li>暂无</li>'}</ul></section>
  </main>
</body>
</html>`;
  fs.writeFileSync(path.join(outputDir, 'recognition-diagnostics.html'), html, 'utf8');
}

function writeSourceEvidenceReview(outputDir) {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'compare-formal-to-source-evidence.mjs');
  const result = spawnSync(process.execPath, [scriptPath, '--output', outputDir], {
    cwd: path.dirname(scriptPath),
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`formal/source review failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}

function main() {
  const outputDir = path.resolve(getArg('--output') || process.cwd());
  const diagnostics = buildDiagnostics(outputDir);
  const projectionReview = buildProjectionReview(outputDir, diagnostics);
  writeOverlaySvg(outputDir, diagnostics);
  writeWallStageProjectionSvg(outputDir);
  writeRoomsStageProjectionSvg(outputDir);
  writeConfirmedWindowsProjectionSvg(outputDir);
  writeOpeningsStageProjectionSvg(outputDir);
  fs.writeFileSync(path.join(outputDir, 'recognition-diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'projection-review.json'), JSON.stringify(projectionReview, null, 2), 'utf8');
  writeSourceEvidenceReview(outputDir);
  writeHtml(outputDir, diagnostics);
  process.stdout.write(`${JSON.stringify({ output: { recognitionDiagnostics: 'recognition-diagnostics.html' }, summary: diagnostics.summary })}\n`);
}

main();
