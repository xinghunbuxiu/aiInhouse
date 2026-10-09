import fs from 'node:fs';
import path from 'node:path';

function getArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function roomTypeCounts(rooms = []) {
  return rooms.reduce((acc, room) => {
    const type = room.type || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
}

function layoutCountsFromSnapshot(snapshot = {}) {
  const design = snapshot.design || {};
  return {
    bedroom: Number(design.bedrooms || 0),
    livingDining: Number(design.halls || 0),
    kitchen: Number(design.kitchens || 0),
    bathroom: Number(design.baths || 0)
  };
}

function normalizeName(name = '') {
  return String(name)
    .replace(/\s+/g, '')
    .replace(/客餐厅/g, '客厅餐厅')
    .toLowerCase();
}

function isLivingDiningName(name = '') {
  const normalized = normalizeName(name);
  return normalized.includes('客厅餐厅')
    || normalized.includes('餐厅客厅')
    || normalized.includes('客餐')
    || normalized.includes('餐客');
}

function roomArea(room = {}) {
  const area = Number(room.area);
  return Number.isFinite(area) ? area : null;
}

function sumRoomArea(rooms = []) {
  return rooms.reduce((sum, room) => {
    const area = roomArea(room);
    return area == null ? sum : sum + area;
  }, 0);
}

function roundNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function areaMetrics(sourceArea, matchedArea) {
  if (!Number.isFinite(sourceArea) || !Number.isFinite(matchedArea) || sourceArea <= 0) {
    return {
      areaDiff: null,
      areaRatio: null,
      areaRatioDelta: null
    };
  }
  const areaDiff = Math.abs(sourceArea - matchedArea);
  const areaRatio = matchedArea / sourceArea;
  return {
    areaDiff: roundNumber(areaDiff),
    areaRatio: roundNumber(areaRatio, 3),
    areaRatioDelta: roundNumber(Math.abs(1 - areaRatio), 3)
  };
}

function formatReportNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits).replace(/\.?0+$/, '') : '-';
}

function combineRooms(rooms = [], combinedType) {
  const combinedArea = sumRoomArea(rooms);
  return {
    id: rooms.map((room) => room.id).filter(Boolean).join('+') || combinedType,
    name: rooms.map((room) => room.name).filter(Boolean).join('+') || combinedType,
    type: combinedType,
    area: Number(combinedArea.toFixed(2)),
    confidence: rooms.length
      ? Number((rooms.reduce((sum, room) => sum + Number(room.confidence || 0), 0) / rooms.length).toFixed(2))
      : null,
    source: rooms.map((room) => room.source).filter(Boolean).join('+') || undefined,
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      type: room.type,
      area: room.area
    }))
  };
}

function livingDiningCandidates(recognitionRooms = []) {
  const livingRooms = recognitionRooms.filter((room) => room.type === 'living');
  const diningRooms = recognitionRooms.filter((room) => room.type === 'dining');
  if (!livingRooms.length || !diningRooms.length) {
    return [];
  }
  return [
    combineRooms([...livingRooms, ...diningRooms], 'living+dining')
  ];
}

function toMatch(best) {
  return {
    id: best.room.id,
    name: best.room.name,
    type: best.room.type,
    area: best.room.area,
    confidence: best.room.confidence,
    source: best.room.source,
    areaDiff: best.areaDiff,
    areaRatio: best.areaRatio,
    areaRatioDelta: best.areaRatioDelta,
    matchKind: best.matchKind,
    rooms: best.room.rooms
  };
}

function compareVisibleRooms(snapshotRooms = [], recognitionRooms = []) {
  return snapshotRooms.map((sourceRoom) => {
    const sourceName = normalizeName(sourceRoom.name);
    const isLivingDining = isLivingDiningName(sourceRoom.name);
    const compositeCandidates = isLivingDining ? livingDiningCandidates(recognitionRooms) : [];
    const candidates = [...compositeCandidates, ...recognitionRooms].map((room) => {
      const roomName = normalizeName(room.name);
      const nameHit = roomName.includes(sourceName) || sourceName.includes(roomName);
      const combinedTypeHit = isLivingDining && room.type === 'living+dining';
      const typeHit = combinedTypeHit || (isLivingDining && (room.type === 'living' || room.type === 'dining'));
      const metrics = areaMetrics(sourceRoom.areaM2, room.area);
      const areaPenalty = metrics.areaRatioDelta == null
        ? 0
        : Math.min(1.5, metrics.areaRatioDelta * 1.5);
      return {
        room,
        score: (nameHit ? 2 : 0)
          + (typeHit ? 1 : 0)
          + (combinedTypeHit ? 3 : 0)
          - areaPenalty,
        ...metrics,
        matchKind: combinedTypeHit ? 'combined-visible-room' : 'single-room'
      };
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return {
      source: sourceRoom,
      match: best && best.score > 0 ? toMatch(best) : null
    };
  });
}

function buildComparison(snapshot, draft) {
  const rooms = draft.rooms || [];
  const geometryRooms = draft.geometryRooms || [];
  const sourceLayout = layoutCountsFromSnapshot(snapshot);
  const recognizedTypes = roomTypeCounts(rooms);
  const visualMatchedRooms = compareVisibleRooms(snapshot.visibleRooms || [], rooms);
  const expectedMainCount = Object.values(sourceLayout).reduce((sum, value) => sum + value, 0);

  return {
    generatedAt: new Date().toISOString(),
    source: {
      title: snapshot.source?.title || snapshot.design?.title || '',
      url: snapshot.source?.url || '',
      areaM2: snapshot.design?.areaM2 ?? null,
      layout: snapshot.design?.layout || ''
    },
    recognition: {
      strategy: draft.strategy?.localGeometry || '',
      roomCount: rooms.length,
      geometryRoomCount: geometryRooms.length,
      wallCount: (draft.walls || []).length,
      doorCount: (draft.doors || []).length,
      windowCount: (draft.windows || []).length,
      semanticFallback: draft.quality?.semanticFallback || null,
      confidence: draft.confidence || {}
    },
    comparison: {
      expectedMainRoomCount: expectedMainCount,
      recognizedRoomCount: rooms.length,
      recognizedGeometryRoomCount: geometryRooms.length,
      roomCountDelta: rooms.length - expectedMainCount,
      sourceLayout,
      recognizedTypes,
      visibleRoomMatches: visualMatchedRooms,
      needs3dJson: true
    },
    notes: [
      'Visible snapshot comparison is intentionally conservative: it only compares text visible in the Kujiale editor.',
      'For geometry-accurate comparison, provide an authenticated HAR/curl export for dds designdata/homedesign APIs.'
    ]
  };
}

function writeMarkdown(filePath, comparison) {
  const visibleRows = comparison.comparison.visibleRoomMatches.map((item) => {
    if (!item.match) {
      return `| ${item.source.name} | ${item.source.areaM2 ?? '-'} | 未匹配 | - | - | - | - |`;
    }
    return `| ${item.source.name} | ${item.source.areaM2 ?? '-'} | ${item.match.name} | ${formatReportNumber(item.match.area)} | ${formatReportNumber(item.match.areaDiff)} | ${formatReportNumber(item.match.areaRatio, 3)} | ${item.match.matchKind === 'combined-visible-room' ? 'combined' : 'single'} |`;
  }).join('\n');
  const md = `# Kujiale Recognition Comparison

## Source
- Title: ${comparison.source.title || '-'}
- Layout: ${comparison.source.layout || '-'}
- Area: ${comparison.source.areaM2 ?? '-'} m2

## Recognition
- Strategy: ${comparison.recognition.strategy || '-'}
- Rooms: ${comparison.recognition.roomCount}
- Geometry rooms: ${comparison.recognition.geometryRoomCount}
- Walls: ${comparison.recognition.wallCount}
- Semantic fallback: ${comparison.recognition.semanticFallback || '-'}

## Delta
- Expected main rooms: ${comparison.comparison.expectedMainRoomCount}
- Recognized rooms: ${comparison.comparison.recognizedRoomCount}
- Delta: ${comparison.comparison.roomCountDelta}

## Visible Room Matches
| Kujiale visible room | Kujiale area m2 | Recognition match | Recognition area m2 | Diff m2 | Area ratio | Match kind |
| --- | ---: | --- | ---: | ---: | ---: | --- |
${visibleRows || '| - | - | - | - | - | - | - |'}
`;
  fs.writeFileSync(filePath, md, 'utf8');
}

const snapshotFile = getArg('--snapshot', 'tmp/kujiale-design-visible-snapshot.json');
const draftFile = getArg('--draft');
const outputDir = getArg('--output', 'tmp/kujiale-recognition-compare');

if (!draftFile) {
  throw new Error('Missing --draft recognition-draft.json path');
}

const comparison = buildComparison(readJson(snapshotFile), readJson(draftFile));
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'comparison.json'), JSON.stringify(comparison, null, 2), 'utf8');
writeMarkdown(path.join(outputDir, 'comparison.md'), comparison);

console.log(JSON.stringify({
  outputDir,
  source: comparison.source,
  recognition: comparison.recognition,
  delta: comparison.comparison.roomCountDelta
}, null, 2));
