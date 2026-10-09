function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function snapPoint(point = {}, grid = 4) {
  return {
    x: Math.round(toNumber(point.x) / grid) * grid,
    y: Math.round(toNumber(point.y) / grid) * grid
  };
}

function normalizeWall(wall = {}, index = 0) {
  const start = snapPoint(wall.start);
  const end = snapPoint(wall.end);
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  if (dx >= dy) {
    const y = Math.round((start.y + end.y) / 2);
    start.y = y;
    end.y = y;
  } else {
    const x = Math.round((start.x + end.x) / 2);
    start.x = x;
    end.x = x;
  }

  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return {
    ...wall,
    id: wall.id || `wall-${index + 1}`,
    start,
    end,
    thickness: toNumber(wall.thickness, 12),
    confidence: toNumber(wall.confidence, 0.65),
    length: Number(length.toFixed(2)),
    orientation: Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical'
  };
}

function wallKey(wall) {
  const a = `${wall.start.x},${wall.start.y}`;
  const b = `${wall.end.x},${wall.end.y}`;
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function dedupeWalls(walls = []) {
  const byKey = new Map();
  for (const wall of walls) {
    if (wall.length < 16) {
      continue;
    }
    const key = wallKey(wall);
    const existing = byKey.get(key);
    if (!existing || wall.confidence > existing.confidence) {
      byKey.set(key, wall);
    }
  }

  return [...byKey.values()];
}

function mergeAxisAlignedWalls(walls = []) {
  const groups = new Map();

  for (const wall of walls) {
    const key = wall.orientation === 'horizontal'
      ? `h:${Math.round(wall.start.y / 8) * 8}`
      : `v:${Math.round(wall.start.x / 8) * 8}`;
    const start = wall.orientation === 'horizontal'
      ? Math.min(wall.start.x, wall.end.x)
      : Math.min(wall.start.y, wall.end.y);
    const end = wall.orientation === 'horizontal'
      ? Math.max(wall.start.x, wall.end.x)
      : Math.max(wall.start.y, wall.end.y);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push({ wall, start, end });
  }

  const merged = [];
  const mergeGap = 10;

  for (const segments of groups.values()) {
    const sorted = segments.sort((a, b) => a.start - b.start);
    let current = null;

    for (const segment of sorted) {
      if (!current) {
        current = { ...segment };
        continue;
      }

      if (segment.start <= current.end + mergeGap) {
        current.end = Math.max(current.end, segment.end);
        current.wall = current.wall.confidence >= segment.wall.confidence ? current.wall : segment.wall;
        continue;
      }

      merged.push(current);
      current = { ...segment };
    }

    if (current) {
      merged.push(current);
    }
  }

  return merged.map((segment, index) => {
    const wall = segment.wall;
    const orientation = wall.orientation;
    const fixed = orientation === 'horizontal' ? wall.start.y : wall.start.x;
    const start = orientation === 'horizontal'
      ? { x: segment.start, y: fixed }
      : { x: fixed, y: segment.start };
    const end = orientation === 'horizontal'
      ? { x: segment.end, y: fixed }
      : { x: fixed, y: segment.end };

    return normalizeWall({
      ...wall,
      id: wall.id || `wall-${index + 1}`,
      start,
      end
    }, index);
  });
}

function classifyWallEnvelope(walls = []) {
  if (!walls.length) {
    return walls;
  }

  const xs = walls.flatMap((wall) => [wall.start.x, wall.end.x]);
  const ys = walls.flatMap((wall) => [wall.start.y, wall.end.y]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const tolerance = 16;

  return walls.map((wall) => {
    const isEnvelope = wall.orientation === 'horizontal'
      ? Math.abs(wall.start.y - minY) <= tolerance || Math.abs(wall.start.y - maxY) <= tolerance
      : Math.abs(wall.start.x - minX) <= tolerance || Math.abs(wall.start.x - maxX) <= tolerance;

    return {
      ...wall,
      wallRole: isEnvelope ? 'exterior' : 'interior',
      isExterior: isEnvelope
    };
  });
}

function normalizeRoom(room = {}, index = 0) {
  const x = Math.max(0, toNumber(room.x));
  const y = Math.max(0, toNumber(room.y));
  const width = Math.max(20, toNumber(room.width, 100));
  const height = Math.max(20, toNumber(room.height, 80));

  return {
    ...room,
    id: room.id || `room-${index + 1}`,
    x,
    y,
    width,
    height,
    area: toNumber(room.area, Math.max(4, Math.round((width * height) / 900))),
    confidence: toNumber(room.confidence, 0.65)
  };
}

function wallAxisRange(wall) {
  if (wall.orientation === 'horizontal') {
    return {
      fixed: wall.start.y,
      min: Math.min(wall.start.x, wall.end.x),
      max: Math.max(wall.start.x, wall.end.x)
    };
  }

  return {
    fixed: wall.start.x,
    min: Math.min(wall.start.y, wall.end.y),
    max: Math.max(wall.start.y, wall.end.y)
  };
}

function openingToWallDistance(opening, wall) {
  const range = wallAxisRange(wall);
  const pointFixed = wall.orientation === 'horizontal' ? opening.y : opening.x;
  const pointAxis = wall.orientation === 'horizontal' ? opening.x : opening.y;
  const clampedAxis = Math.min(Math.max(pointAxis, range.min), range.max);
  const axisDelta = pointAxis - clampedAxis;
  const fixedDelta = pointFixed - range.fixed;
  return {
    distance: Math.hypot(axisDelta, fixedDelta),
    axisDelta: Number(axisDelta.toFixed(2)),
    clampedAxis,
    fixed: range.fixed,
    withinSpan: pointAxis >= range.min && pointAxis <= range.max
  };
}

function resolveOpeningRoomId(opening = {}) {
  if (opening.sourceEvidence?.roomId || opening.roomId) {
    return opening.sourceEvidence?.roomId || opening.roomId;
  }

  const match = String(opening.id || '').match(/^door-(.+)$/);
  return match?.[1] || '';
}

function wallsForRoom(room = {}, walls = []) {
  const roomId = room.id || '';
  const prefixed = walls.filter((wall) => String(wall.id || '').startsWith(`${roomId}-w`));
  if (prefixed.length) {
    return prefixed;
  }

  const x1 = toNumber(room.x);
  const y1 = toNumber(room.y);
  const x2 = x1 + toNumber(room.width);
  const y2 = y1 + toNumber(room.height);
  const tolerance = 14;

  return walls.filter((wall) => {
    const start = wall.start || (Array.isArray(wall.from) ? { x: wall.from[0], y: wall.from[1] } : null);
    const end = wall.end || (Array.isArray(wall.to) ? { x: wall.to[0], y: wall.to[1] } : null);
    if (!start || !end) {
      return false;
    }

    const sx = toNumber(start.x);
    const sy = toNumber(start.y);
    const ex = toNumber(end.x);
    const ey = toNumber(end.y);
    const onLeft = Math.abs(sx - x1) <= tolerance && Math.abs(ex - x1) <= tolerance;
    const onRight = Math.abs(sx - x2) <= tolerance && Math.abs(ex - x2) <= tolerance;
    const onTop = Math.abs(sy - y1) <= tolerance && Math.abs(ey - y1) <= tolerance;
    const onBottom = Math.abs(sy - y2) <= tolerance && Math.abs(ey - y2) <= tolerance;
    return onLeft || onRight || onTop || onBottom;
  });
}

function alignSemanticOpeningToRoom(opening = {}, room = {}, walls = []) {
  if (!room?.id || opening.source !== 'semantic-room-opening-prior') {
    return opening;
  }

  const roomWalls = wallsForRoom(room, walls);
  if (!roomWalls.length) {
    return opening;
  }

  const nearest = findNearestWall(opening, roomWalls);
  if (!nearest?.wall) {
    return opening;
  }

  const wall = nearest.wall;
  const openingType = opening.type || 'door';
  const aligned = {
    ...opening,
    attachedWallId: wall.id,
    orientation: wall.orientation,
    x: wall.orientation === 'horizontal' ? nearest.clampedAxis : nearest.fixed,
    y: wall.orientation === 'horizontal' ? nearest.fixed : nearest.clampedAxis,
    width: wall.orientation === 'horizontal'
      ? Math.max(toNumber(opening.width, openingType === 'door' ? 28 : 56), 8)
      : Math.max(toNumber(opening.width, 8), 8),
    height: wall.orientation === 'horizontal'
      ? Math.max(toNumber(opening.height, 8), 8)
      : Math.max(toNumber(opening.height, openingType === 'door' ? 28 : 56), 8),
    sourceEvidence: {
      ...(opening.sourceEvidence || {}),
      roomId: room.id,
      roomBoundaryAligned: true,
      alignedWallId: wall.id
    }
  };

  return aligned;
}

function findNearestWall(opening, walls = []) {
  const expectedWallOrientation = opening.sourceEvidence?.expectedWallOrientation || opening.expectedWallOrientation || '';
  const preferredCandidateId = opening.sourceEvidence?.wallSupport?.wallCandidateId
    || opening.sourceEvidence?.wallCandidateId
    || '';
  let eligibleWalls = expectedWallOrientation
    ? walls.filter((wall) => wall.orientation === expectedWallOrientation)
    : walls;
  if (preferredCandidateId) {
    const preferred = walls.filter((wall) => (
      wall.sourceCandidateId === preferredCandidateId
      || wall.id === preferredCandidateId
      || String(wall.id || '').includes(preferredCandidateId)
    ));
    if (preferred.length) {
      eligibleWalls = preferred;
    }
  }
  let nearest = null;
  for (const wall of eligibleWalls) {
    const candidate = openingToWallDistance(opening, wall);
    const effectiveDistance = candidate.distance + (candidate.withinSpan ? 0 : 18);
    if (!nearest || effectiveDistance < nearest.effectiveDistance) {
      nearest = {
        ...candidate,
        effectiveDistance,
        wall
      };
    }
  }
  return nearest;
}

function isGapOrExteriorOpening(opening = {}) {
  const inferred = opening.sourceEvidence?.inferredFrom || '';
  return Boolean(
    opening.source === 'exterior-wall-gap-scanner'
    || opening.source === 'bay-window-outline-scanner'
    || inferred.includes('exterior')
    || inferred.includes('wall-gap')
    || inferred.includes('bay-outline')
    || opening.sourceEvidence?.acceptedAsExteriorWindow
    || opening.sourceEvidence?.nearExteriorEnvelope
  );
}

function attachOpeningToWall(opening, walls = [], type = 'door', rooms = []) {
  const roomId = resolveOpeningRoomId(opening);
  const room = roomId ? rooms.find((item) => item.id === roomId) : null;
  const preferredWalls = room ? wallsForRoom(room, walls) : walls;
  // 视觉洞口优先全墙网匹配；房间墙网过稀时易把洞口贴到远端端点
  const searchWalls = (opening.source === 'semantic-room-opening-prior' && preferredWalls.length)
    ? preferredWalls
    : walls;
  const nearest = findNearestWall(opening, searchWalls.length ? searchWalls : walls);
  const reviewReasons = [];
  const semanticPrior = opening.source === 'semantic-room-opening-prior';
  const gapOrExterior = isGapOrExteriorOpening(opening);
  const assetMatched = Boolean(opening.sourceEvidence?.assetMatch?.assetId);
  const strongWallSupport = Boolean(
    opening.sourceEvidence?.strongWallSupport
    || toNumber(opening.sourceEvidence?.wallSupport?.score, 0) >= 1.15
  );
  const openingSpan = Math.max(toNumber(opening.width, 0), toNumber(opening.height, 0));
  let maxAttachmentDistance = semanticPrior
    ? (type === 'door' ? 48 : 42)
    : (type === 'door' ? 32 : 40);
  if (gapOrExterior) {
    maxAttachmentDistance = Math.max(maxAttachmentDistance, type === 'door' ? 52 : 56);
  }
  if (assetMatched || strongWallSupport) {
    maxAttachmentDistance = Math.max(maxAttachmentDistance, 48);
  }

  if (!nearest) {
    reviewReasons.push('no-wall-candidate');
    return {
      ...opening,
      needsWallAttachmentReview: true,
      reviewReasons
    };
  }

  const wall = nearest.wall;
  const preservesDetectedOutlineCenter = [
    'exterior-vertical-wall-gap',
    'exterior-bay-outline-with-return-support'
  ].includes(opening.sourceEvidence?.inferredFrom);
  const spanTolerance = semanticPrior
    ? Math.max(18, openingSpan * 0.9)
    : Math.max(10, openingSpan * 0.65);
  // 墙缝/外轮廓洞口：洞口常落在墙段外侧端点之外，固定轴重合即可视为可贴
  const nearWallEndpoint = Math.abs(toNumber(nearest.fixed, 0) - (
    wall.orientation === 'horizontal' ? toNumber(opening.y) : toNumber(opening.x)
  )) <= Math.max(12, toNumber(wall.thickness, 10))
    && Math.abs(toNumber(nearest.axisDelta, 0)) <= Math.max(48, openingSpan * 0.85);
  const withinAttachmentSpan = nearest.withinSpan
    || Math.abs(toNumber(nearest.axisDelta, 0)) <= spanTolerance
    || (semanticPrior && Boolean(room) && nearest.distance <= maxAttachmentDistance)
    || (gapOrExterior && nearWallEndpoint)
    || ((assetMatched || strongWallSupport) && nearest.distance <= maxAttachmentDistance && Math.abs(toNumber(nearest.axisDelta, 0)) <= Math.max(spanTolerance, 36));
  const attached = {
    ...opening,
    attachedWallId: wall.id,
    wallRole: wall.wallRole || '',
    wallDistance: Number(nearest.distance.toFixed(2)),
    orientation: wall.orientation,
    x: wall.orientation === 'horizontal' ? nearest.clampedAxis : nearest.fixed,
    y: wall.orientation === 'horizontal'
      ? nearest.fixed
      : (preservesDetectedOutlineCenter ? toNumber(opening.y) : nearest.clampedAxis),
    width: wall.orientation === 'horizontal'
      ? Math.max(toNumber(opening.width, type === 'door' ? 28 : 56), 8)
      : Math.max(toNumber(opening.width, 8), 8),
    height: wall.orientation === 'horizontal'
      ? Math.max(toNumber(opening.height, 8), 8)
      : Math.max(toNumber(opening.height, type === 'door' ? 28 : 56), 8),
    sourceEvidence: {
      ...(opening.sourceEvidence || {}),
      attachedWallId: wall.id,
      wallDistance: Number(nearest.distance.toFixed(2)),
      wallOrientation: wall.orientation,
      withinWallSpan: nearest.withinSpan,
      withinAttachmentSpan,
      wallAxisDelta: nearest.axisDelta,
      nearWallEndpoint: nearWallEndpoint || undefined,
      roomBoundaryAttached: Boolean(room)
    }
  };

  const outlineBridgesReturnWall = opening.sourceEvidence?.inferredFrom === 'exterior-bay-outline-with-return-support'
    && Math.abs(toNumber(opening.x) - toNumber(nearest.fixed)) <= 14
    && Math.abs(toNumber(nearest.axisDelta, 0)) <= Math.max(24, toNumber(opening.height, 0) * 0.65);
  if (nearest.distance > maxAttachmentDistance && !outlineBridgesReturnWall && !(gapOrExterior && nearWallEndpoint && nearest.distance <= 64)) {
    reviewReasons.push(`far-from-wall:${Number(nearest.distance.toFixed(1))}`);
  }
  if (!withinAttachmentSpan) {
    reviewReasons.push('outside-wall-span');
  }
  if (wall.wallRole === 'exterior' && type === 'door') {
    attached.exteriorOpening = true;
  }

  return {
    ...attached,
    confidence: Math.max(0.35, Math.min(0.9, attached.confidence - (reviewReasons.length ? 0.12 : 0) + (nearest.distance <= 8 ? 0.06 : 0))),
    needsWallAttachmentReview: reviewReasons.length > 0,
    reviewReasons
  };
}

function validateOpenings(openings = [], walls = [], type = 'door', rooms = []) {
  return openings.map((opening, index) => {
    const roomId = resolveOpeningRoomId(opening);
    const room = roomId ? rooms.find((item) => item.id === roomId) : null;
    const alignedOpening = alignSemanticOpeningToRoom(opening, room, walls);
    return attachOpeningToWall({
      id: alignedOpening.id || opening.id || `${type}-${index + 1}`,
      type: alignedOpening.type || type,
      x: toNumber(alignedOpening.x, toNumber(alignedOpening.position?.x, 0)),
      y: toNumber(alignedOpening.y, toNumber(alignedOpening.position?.y, 0)),
      width: toNumber(alignedOpening.width, type === 'door' ? 12 : 18),
      height: toNumber(alignedOpening.height, 8),
      confidence: Math.min(0.82, toNumber(alignedOpening.confidence, 0.68)),
      source: alignedOpening.source || '',
      sourceEvidence: alignedOpening.sourceEvidence || {}
    }, walls, type, rooms);
  });
}

function filterSpeculativeOpenings(openings = []) {
  const kept = [];
  const suppressed = [];

  for (const opening of openings) {
    const speculative = opening.source === 'semantic-room-opening-prior';
    const keepForBalconyOutlineReview = Boolean(opening.sourceEvidence?.proposedBalconyOutlineWindow);
    const keepForEntryExteriorReview = opening.sourceEvidence?.inferredFrom === 'entry-room-exterior-door-prior';
    const keepForRoomBoundary = Boolean(opening.sourceEvidence?.roomBoundaryAligned || opening.sourceEvidence?.roomBoundaryAttached)
      && toNumber(opening.wallDistance, 99) <= 48;
    const farFromWall = toNumber(opening.wallDistance, 0) > 80
      || (opening.reviewReasons || []).some((reason) => {
        const match = String(reason).match(/^far-from-wall:(\d+(?:\.\d+)?)$/);
        return match && Number(match[1]) > 80;
      });
    // 过远的视觉窗多为外轮廓误晋升，不应进入确认洞口
    if (!speculative && opening.needsWallAttachmentReview && farFromWall && opening.type === 'window') {
      suppressed.push({
        id: opening.id,
        type: opening.type || 'window',
        reason: 'far-from-wall-visual-window',
        wallDistance: opening.wallDistance,
        reviewReasons: opening.reviewReasons || []
      });
      continue;
    }
    if (speculative && opening.needsWallAttachmentReview && !keepForBalconyOutlineReview && !keepForEntryExteriorReview && !keepForRoomBoundary) {
      suppressed.push({
        id: opening.id,
        type: opening.type,
        wallDistance: opening.wallDistance,
        reviewReasons: opening.reviewReasons || []
      });
      continue;
    }
    kept.push(opening);
  }

  return { kept, suppressed };
}

function averageConfidence(items = []) {
  if (!items.length) {
    return 0;
  }
  return items.reduce((sum, item) => sum + toNumber(item.confidence, 0), 0) / items.length;
}

function countRoomsBySource(rooms = []) {
  return rooms.reduce((acc, room) => {
    const source = room.source || 'unknown';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
}

function openingNeedsVisualConfirmation(opening = {}) {
  if (opening.sourceEvidence?.confirmedOpening && !opening.sourceEvidence?.needsVisualConfirmation) {
    return false;
  }
  return Boolean(
    opening.sourceEvidence?.needsVisualConfirmation
    || opening.source === 'semantic-room-opening-prior'
  );
}

function pruneLowValueOpeningProposals({ doors = [], windows = [], rooms = [] }) {
  const confirmedVisualDoorCount = doors.filter((opening) => (
    opening.source !== 'semantic-room-opening-prior'
    && !openingNeedsVisualConfirmation(opening)
  )).length;
  const suppressSemanticDoorPriors = confirmedVisualDoorCount >= Math.max(4, rooms.length);
  const keptDoors = [];
  const keptWindows = [];
  const suppressed = [];

  for (const opening of doors) {
    if (suppressSemanticDoorPriors && opening.source === 'semantic-room-opening-prior') {
      suppressed.push({
        id: opening.id,
        type: 'door',
        reason: 'redundant-semantic-door-prior',
        replacedByVisualDoorCount: confirmedVisualDoorCount
      });
      continue;
    }
    keptDoors.push(opening);
  }

  for (const opening of windows) {
    if (!openingNeedsVisualConfirmation(opening)) {
      keptWindows.push(opening);
      continue;
    }
    const evidence = opening.sourceEvidence || {};
    const highValueProposal = Boolean(
      evidence.proposedBalconyOutlineWindow
      || evidence.nearExteriorEnvelope
      || (evidence.exteriorSides || []).length
      || evidence.rawBalconyCandidateId
    );
    if (opening.source === 'wall-line-window-candidate' || (opening.source === 'window-symbol-scanner' && !highValueProposal)) {
      suppressed.push({
        id: opening.id,
        type: 'window',
        reason: opening.source === 'wall-line-window-candidate'
          ? 'wall-line-without-window-symbol-evidence'
          : 'interior-parallel-line-without-exterior-evidence'
      });
      continue;
    }
    keptWindows.push(opening);
  }

  return { doors: keptDoors, windows: keptWindows, suppressed };
}

function assessExpectedSpaceCoverage(draft = {}, rooms = []) {
  const expectedSpaces = Array.isArray(draft.expectedSpaces) ? draft.expectedSpaces : [];
  const availableByType = rooms.reduce((counts, room) => {
    const type = room.type || 'space';
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const consumedByType = {};
  const missing = [];

  for (const expected of expectedSpaces) {
    const type = expected.type || 'space';
    const used = consumedByType[type] || 0;
    if (used >= (availableByType[type] || 0)) {
      missing.push(expected);
      continue;
    }
    consumedByType[type] = used + 1;
  }

  return {
    expectedSpaces,
    missing,
    coverageRatio: expectedSpaces.length
      ? (expectedSpaces.length - missing.length) / expectedSpaces.length
      : 1
  };
}

function assessCommercialReadiness({ draft = {}, rooms = [], walls = [], doors = [], windows = [], proposedOpenings = [], unattachedOpenings = [] }) {
  const sourceCounts = countRoomsBySource(rooms);
  const templateRoomCount = (sourceCounts['layout-template-from-plan-labels'] || 0)
    + (sourceCounts['layout-template-supplemental'] || 0);
  const semanticTemplateCount = sourceCounts['opencv-wall-grid-with-template-semantics'] || 0;
  const reviewSemanticCount = rooms.filter((room) => (
    room.source === 'opencv-wall-grid-with-review-semantics'
    || room.source === 'ocr-label-supplemental'
    || room.source === 'layout-template-supplemental'
    || room.sourceEvidence?.semanticNeedsReview
  )).length;
  const boundaryReviewCount = rooms.filter((room) => room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview).length;
  const roomConfidence = averageConfidence(rooms);
  const wallConfidence = averageConfidence(walls);
  const openingConfidence = averageConfidence([...doors, ...windows]);
  const expectedMinWalls = Math.max(4, rooms.length * 2);
  const wallCoverageRatio = expectedMinWalls ? Math.min(1, walls.length / expectedMinWalls) : 0;
  const attachedOpeningRatio = doors.length + windows.length
    ? (doors.length + windows.length - unattachedOpenings.length) / (doors.length + windows.length)
    : 0;
  const openingCount = doors.length + windows.length;
  const expectedMinOpenings = Math.max(3, Math.floor(rooms.length * 0.75));
  const hasStableOpeningEvidence = openingCount >= expectedMinOpenings && attachedOpeningRatio >= 0.92;
  const geometryRoomCount = toNumber(draft.quality?.geometryRoomCandidateCount, (draft.geometryRooms || []).length);
  const hasGeometryRooms = geometryRoomCount >= Math.max(2, Math.min(rooms.length, 4));
  const templateDependencyRatio = rooms.length ? templateRoomCount / rooms.length : 1;
  const roomScore = Math.min(1, rooms.length / Math.max(4, Math.min(10, rooms.length || 4))) * roomConfidence;
  const wallScore = wallCoverageRatio * Math.max(0.45, wallConfidence);
  const openingEvidenceConfidence = hasStableOpeningEvidence
    ? Math.max(0.82, openingConfidence || 0)
    : Math.max(0.45, openingConfidence || 0.45);
  const openingScore = (openingCount ? attachedOpeningRatio : 0) * openingEvidenceConfidence;
  const geometryScore = hasGeometryRooms ? 0.9 : geometryRoomCount > 0 ? 0.62 : 0.35;
  const semanticScore = Math.max(0.35, 1 - templateDependencyRatio * 0.45 - (semanticTemplateCount ? 0.08 : 0));
  const expectedSpaceCoverage = assessExpectedSpaceCoverage(draft, rooms);
  const baseScore = (
    roomScore * 0.22
    + wallScore * 0.24
    + openingScore * 0.18
    + geometryScore * 0.22
    + semanticScore * 0.14
  );
  const proposedOpeningPenalty = Math.min(0.18, proposedOpenings.length * 0.015);
  const score = Number(Math.max(
    0,
    baseScore
      - Math.min(0.24, expectedSpaceCoverage.missing.length * 0.06)
      - proposedOpeningPenalty
  ).toFixed(2));
  const blockingReasons = [];
  const reviewChecklist = [];

  if (rooms.length < 4) {
    blockingReasons.push('room-count-too-low');
    reviewChecklist.push('补齐主要空间：卧室、客餐厅、厨房、卫生间等。');
  }
  if (expectedSpaceCoverage.missing.length) {
    blockingReasons.push('missing-expected-spaces');
    reviewChecklist.push(`户型描述中的空间尚未识别完整：${expectedSpaceCoverage.missing.map((space) => space.name).join('、')}。`);
  }
  if (walls.length < expectedMinWalls) {
    blockingReasons.push('insufficient-wall-candidates');
    reviewChecklist.push('复核墙体闭合关系，补画缺失外墙和内墙。');
  }
  if (!doors.length && !windows.length) {
    blockingReasons.push('missing-openings');
    reviewChecklist.push('补充门、窗、阳台推拉门等洞口位置。');
  }
  // 1/30 未贴墙不应阻断；仅当贴墙率显著偏低时阻断
  const unattachedRatio = openingCount ? unattachedOpenings.length / openingCount : 0;
  if (unattachedOpenings.length >= 3 || (unattachedOpenings.length > 0 && unattachedRatio > 0.08)) {
    blockingReasons.push('openings-not-attached-to-wall');
    reviewChecklist.push(`有 ${unattachedOpenings.length} 个门窗未能可靠贴墙（贴墙率 ${Number(((1 - unattachedRatio) * 100).toFixed(1))}%），请确认洞口所在墙体。`);
  } else if (unattachedOpenings.length) {
    reviewChecklist.push(`有 ${unattachedOpenings.length} 个门窗贴墙略偏，可人工微调；不阻断商用门禁。`);
  }
  const confirmedOpeningCount = doors.length + windows.length;
  if (proposedOpenings.length && confirmedOpeningCount < expectedMinOpenings) {
    blockingReasons.push('proposed-openings-require-review');
    reviewChecklist.push(`有 ${proposedOpenings.length} 个候选门窗尚未获得稳定图像证据，正式开洞不足（确认 ${confirmedOpeningCount}/${expectedMinOpenings}）。`);
  } else if (proposedOpenings.length) {
    reviewChecklist.push(`另有 ${proposedOpenings.length} 个候选门窗可人工复核；已有 ${confirmedOpeningCount} 个确认洞口，不阻断商用门禁。`);
  }
  if (templateDependencyRatio > 0.35 && !hasGeometryRooms) {
    blockingReasons.push('template-heavy-without-geometry-proof');
    reviewChecklist.push('模板语义占比较高，需要人工或高精度模型复核空间边界。');
  }
  // 语义复核旗标：多数房间已有明确类型 + 几何/洞口证据时只提示，不硬阻断
  const isUnknownRoom = (room) => !room.type || room.type === 'space' || /^候选空间/.test(String(room.name || ''));
  const unknownRooms = rooms.filter(isUnknownRoom);
  const typedRoomCount = rooms.length - unknownRooms.length;
  const typedRoomRatio = rooms.length ? typedRoomCount / rooms.length : 0;
  const softSemanticReview = reviewSemanticCount > 0
    && reviewSemanticCount <= Math.max(3, Math.floor(rooms.length * 0.45))
    && typedRoomRatio >= 0.85
    && hasGeometryRooms
    && hasStableOpeningEvidence;
  if (reviewSemanticCount > 0 && !softSemanticReview) {
    blockingReasons.push('review-semantic-room-types');
    reviewChecklist.push(`有 ${reviewSemanticCount} 个空间使用近邻模板语义，需要人工确认房间用途。`);
  } else if (reviewSemanticCount > 0) {
    reviewChecklist.push(`有 ${reviewSemanticCount} 个空间语义来自模板近邻，建议抽查；已有类型与洞口证据，不阻断商用门禁。`);
  }
  if (sourceCounts['ocr-label-supplemental']) {
    reviewChecklist.push(`有 ${sourceCounts['ocr-label-supplemental']} 个空间由文字标签补充生成，需要确认墙体边界。`);
  }
  // 边界复核：阳台冲突等常把多房间打上旗标；类型齐全且几何/洞口稳定时只 checklist
  const softBoundaryReview = boundaryReviewCount > 0
    && hasGeometryRooms
    && openingCount >= expectedMinOpenings
    && attachedOpeningRatio >= 0.92
    && score >= 0.78
    && (
      (
        boundaryReviewCount <= Math.max(2, Math.floor(rooms.length * 0.4))
        && typedRoomRatio >= 0.75
      )
      || (
        unknownRooms.length === 0
        && typedRoomRatio >= 0.75
      )
    );
  if (boundaryReviewCount > 0 && !softBoundaryReview) {
    blockingReasons.push('room-boundary-needs-review');
    reviewChecklist.push(`有 ${boundaryReviewCount} 个空间边界缺少稳定墙体闭合证据，需要确认墙体边界。`);
  } else if (boundaryReviewCount > 0) {
    reviewChecklist.push(`有 ${boundaryReviewCount} 个空间边界可微调；几何与洞口已可用，不阻断商用门禁。`);
  }
  // 未分类：少量「候选空间」且主体已归类时只提示
  const softUnclassifiedSemantics = unknownRooms.length > 0
    && unknownRooms.length <= Math.max(2, Math.floor(rooms.length * 0.25))
    && typedRoomRatio >= 0.7
    && hasGeometryRooms
    && hasStableOpeningEvidence
    && score >= 0.78;
  if (unknownRooms.length && !softUnclassifiedSemantics) {
    blockingReasons.push('unclassified-room-semantics');
    reviewChecklist.push(`仍有 ${unknownRooms.length} 个空间未完成语义归类，需确认是否为卧室、厨房、阳台、过道或储物空间。`);
  } else if (unknownRooms.length) {
    reviewChecklist.push(`另有 ${unknownRooms.length} 个候选空间待归类；主体房间已分类且几何/洞口可用，不阻断商用门禁。`);
  }
  if (openingCount < expectedMinOpenings) {
    reviewChecklist.push('门窗数量少于空间数量，需补充入户门、卧室门、厨房门和主要外窗。');
  }
  if (toNumber(draft.confidence?.geometry, 0) < 0.75) {
    reviewChecklist.push('几何置信度低于商用自动放行线，需复核比例尺和墙线。');
  }
  if (toNumber(draft.confidence?.semantics, 0) < 0.72) {
    reviewChecklist.push('语义置信度偏低，需复核房间名称和功能类型。');
  }
  const hasUnknownRooms = unknownRooms.length > 0 && !softUnclassifiedSemantics;
  const strongTopologyEvidence = score >= 0.8
    && rooms.length >= 6
    && hasGeometryRooms
    && wallCoverageRatio >= 1
    && hasStableOpeningEvidence
    && attachedOpeningRatio >= 0.95
    && templateDependencyRatio <= 0.15
    && (softSemanticReview || reviewSemanticCount <= Math.max(3, Math.floor(rooms.length * 0.45)))
    && (softBoundaryReview || boundaryReviewCount <= Math.max(2, Math.floor(rooms.length * 0.4)))
    && !hasUnknownRooms
    && toNumber(draft.confidence?.geometry, 0) >= 0.78;
  if (!blockingReasons.length && score < 0.82 && !strongTopologyEvidence) {
    blockingReasons.push('commercial-score-below-threshold');
    reviewChecklist.push('门禁得分未达到 0.82 自动商用线，需人工确认后再放行准确装修图。');
  }

  const status = blockingReasons.length === 0 && (score >= 0.82 || strongTopologyEvidence)
    ? 'commercial_ready'
    : score >= 0.62
      ? 'needs_human_review'
      : 'blocked';

  return {
    status,
    score,
    autoPass: status === 'commercial_ready',
    blockingReasons,
    reviewChecklist: [...new Set(reviewChecklist)],
    metrics: {
      roomCount: rooms.length,
      expectedSpaceCount: expectedSpaceCoverage.expectedSpaces.length,
      missingExpectedSpaceCount: expectedSpaceCoverage.missing.length,
      missingExpectedSpaces: expectedSpaceCoverage.missing.map((space) => space.name),
      expectedSpaceCoverageRatio: Number(expectedSpaceCoverage.coverageRatio.toFixed(2)),
      wallCount: walls.length,
      expectedMinWalls,
      openingCount,
      confirmedOpeningCount: openingCount,
      proposedOpeningCount: proposedOpenings.length,
      proposedOpeningPenalty: Number(proposedOpeningPenalty.toFixed(2)),
      expectedMinOpenings,
      unattachedOpeningCount: unattachedOpenings.length,
      geometryRoomCandidateCount: geometryRoomCount,
      templateRoomCount,
      reviewSemanticCount,
      boundaryReviewCount,
      typedRoomCount,
      typedRoomRatio: Number(typedRoomRatio.toFixed(2)),
      unknownRoomCount: unknownRooms.length,
      softSemanticReview,
      softBoundaryReview,
      softUnclassifiedSemantics,
      templateDependencyRatio: Number(templateDependencyRatio.toFixed(2)),
      roomConfidence: Number(roomConfidence.toFixed(2)),
      wallConfidence: Number(wallConfidence.toFixed(2)),
      openingConfidence: Number(openingConfidence.toFixed(2)),
      openingEvidenceConfidence: Number(openingEvidenceConfidence.toFixed(2)),
      wallCoverageRatio: Number(wallCoverageRatio.toFixed(2)),
      attachedOpeningRatio: Number(attachedOpeningRatio.toFixed(2)),
      strongTopologyEvidence
    }
  };
}

function assessThreeDReadiness({ draft = {}, rooms = [], walls = [], doors = [], windows = [], proposedOpenings = [], unattachedOpenings = [], commercialReadiness = {} }) {
  const layoutAssignedCount = rooms.filter((room) => (
    room.sourceEvidence?.layoutCountAssigned
    || (room.source || '').includes('layout-count-semantics')
  )).length;
  const geometryRoomCount = Math.max(
    toNumber(draft.quality?.geometryRoomCandidateCount, (draft.geometryRooms || []).length),
    layoutAssignedCount
  );
  const boundaryReviewCount = rooms.filter((room) => room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview).length;
  const templateOnlyRoomCount = rooms.filter((room) => (
    room.source === 'layout-template-from-plan-labels'
    || room.source === 'layout-template-supplemental'
    || room.sourceEvidence?.semanticTemplateOnly
  )).length;
  const modelableRoomCount = rooms.filter((room) => !room.boundaryNeedsReview && !room.sourceEvidence?.boundaryNeedsReview).length;
  const expectedMinWalls = Math.max(4, rooms.length * 2);
  const wallCoverageRatio = expectedMinWalls ? Math.min(1, walls.length / expectedMinWalls) : 0;
  const openingCount = doors.length + windows.length;
  const attachedOpeningRatio = openingCount
    ? (openingCount - unattachedOpenings.length) / openingCount
    : 0;
  const mlWallActive = Boolean(draft.preprocessing?.mlWall?.enabled)
    && (draft.preprocessing?.geometryCandidates?.mlWallSegmentCount || 0) >= 6;
  const geometryProofRatio = rooms.length
    ? Math.min(1, Math.max(geometryRoomCount / rooms.length, layoutAssignedCount / rooms.length))
    : 0;
  const geometryProofThreshold = mlWallActive && layoutAssignedCount >= 2 ? 0.45 : 0.55;
  const modelableRoomRatio = rooms.length ? modelableRoomCount / rooms.length : 0;
  const templateDependencyRatio = rooms.length ? templateOnlyRoomCount / rooms.length : 1;
  const geometryConfidence = toNumber(draft.confidence?.geometry, 0);
  const expectedSpaceCoverage = assessExpectedSpaceCoverage(draft, rooms);
  const blockers = [];
  const reviewChecklist = [];

  if (rooms.length < 2 || modelableRoomCount < 2) {
    blockers.push('insufficient-modelable-room-boundaries');
    reviewChecklist.push('至少需要两个有稳定图像边界证据的空间，才能作为 3D 户型建模输入。');
  }
  if (expectedSpaceCoverage.missing.length) {
    blockers.push('missing-expected-spaces-for-3d');
    reviewChecklist.push(`补齐 ${expectedSpaceCoverage.missing.map((space) => space.name).join('、')} 后再生成完整 3D 户型。`);
  }
  if (walls.length < expectedMinWalls) {
    blockers.push('insufficient-wall-network-for-extrusion');
    reviewChecklist.push('补齐外墙与主要隔墙，让墙体可闭合挤出为 3D 墙体。');
  }
  if (geometryProofRatio < geometryProofThreshold) {
    blockers.push('low-geometry-proof-ratio');
    reviewChecklist.push('当前房间过多依赖模板或语义推断，需先从图片中确认边界。');
  }
  if (templateDependencyRatio > 0.25) {
    blockers.push('template-dependent-rooms');
    reviewChecklist.push('模板房间只能用于提示语义，不能直接作为准确 3D 房间边界。');
  }
  if (boundaryReviewCount > 0) {
    blockers.push('room-boundary-review-required');
    reviewChecklist.push(`有 ${boundaryReviewCount} 个空间边界需复核，3D 只能作为草稿预览。`);
  }
  if (openingCount === 0) {
    blockers.push('missing-openings-for-3d');
    reviewChecklist.push('补充门窗洞口后，3D 墙体才能正确开洞和规划漫游。');
  } else if (attachedOpeningRatio < 0.9) {
    blockers.push('openings-not-wall-attached');
    reviewChecklist.push('门窗贴墙率偏低，避免 3D 开洞位置错误。');
  } else if (attachedOpeningRatio < 0.98) {
    reviewChecklist.push('少量门窗贴墙略偏，可人工微调后再挤出 3D。');
  }
  if (proposedOpenings.length && openingCount < Math.max(3, Math.floor(rooms.length * 0.75))) {
    blockers.push('proposed-openings-require-review');
    reviewChecklist.push(`先确认或删除 ${proposedOpenings.length} 个候选门窗；确认洞口不足，暂不自动写入 3D 开洞。`);
  } else if (proposedOpenings.length) {
    reviewChecklist.push(`另有 ${proposedOpenings.length} 个候选门窗可复核；已有确认洞口可进入 3D 开洞。`);
  }
  if (geometryConfidence < 0.7) {
    blockers.push('low-geometry-confidence');
    reviewChecklist.push('几何置信度偏低，建议提高图片清晰度、裁切边框或人工描墙。');
  }

  const rawScore = Number((
    Math.min(1, modelableRoomCount / Math.max(2, rooms.length || 2)) * 0.24
    + wallCoverageRatio * 0.24
    + geometryProofRatio * 0.2
    + (openingCount ? attachedOpeningRatio : 0) * 0.16
    + Math.max(0, 1 - templateDependencyRatio) * 0.16
  ).toFixed(2));
  const proposedOpeningPenalty = Math.min(0.18, proposedOpenings.length * 0.015);
  const score = Number(Math.max(0, rawScore - proposedOpeningPenalty).toFixed(2));
  const status = blockers.length === 0 && score >= 0.78
    ? 'ready_for_3d'
    : score >= 0.52
      ? 'review_required'
      : 'blocked';

  return {
    status,
    score,
    canAutoExtrude: status === 'ready_for_3d',
    basedOnSingleImage: true,
    commercialStatus: commercialReadiness.status || 'unknown',
    blockers,
    reviewChecklist: [...new Set(reviewChecklist)],
    metrics: {
      roomCount: rooms.length,
      expectedSpaceCount: expectedSpaceCoverage.expectedSpaces.length,
      missingExpectedSpaceCount: expectedSpaceCoverage.missing.length,
      missingExpectedSpaces: expectedSpaceCoverage.missing.map((space) => space.name),
      modelableRoomCount,
      boundaryReviewCount,
      templateOnlyRoomCount,
      wallCount: walls.length,
      expectedMinWalls,
      openingCount,
      confirmedOpeningCount: openingCount,
      proposedOpeningCount: proposedOpenings.length,
      proposedOpeningPenalty: Number(proposedOpeningPenalty.toFixed(2)),
      rawScore,
      unattachedOpeningCount: unattachedOpenings.length,
      geometryRoomCandidateCount: geometryRoomCount,
      geometryProofRatio: Number(geometryProofRatio.toFixed(2)),
      modelableRoomRatio: Number(modelableRoomRatio.toFixed(2)),
      templateDependencyRatio: Number(templateDependencyRatio.toFixed(2)),
      wallCoverageRatio: Number(wallCoverageRatio.toFixed(2)),
      attachedOpeningRatio: Number(attachedOpeningRatio.toFixed(2)),
      geometryConfidence: Number(geometryConfidence.toFixed(2))
    }
  };
}

function repairRecognitionTopology(draft = {}) {
  const rooms = (draft.rooms || []).map(normalizeRoom);
  const normalizedWalls = dedupeWalls((draft.walls || []).map(normalizeWall));
  const walls = classifyWallEnvelope(mergeAxisAlignedWalls(normalizedWalls));
  const validatedDoors = validateOpenings(draft.doors || [], walls, 'door', rooms);
  const validatedWindows = validateOpenings(draft.windows || [], walls, 'window', rooms);
  const doorFilter = filterSpeculativeOpenings(validatedDoors);
  const windowFilter = filterSpeculativeOpenings(validatedWindows);
  const proposalPruning = pruneLowValueOpeningProposals({
    doors: doorFilter.kept,
    windows: windowFilter.kept,
    rooms
  });
  const doors = proposalPruning.doors;
  const windows = proposalPruning.windows;
  const confirmedDoors = doors.filter((opening) => !openingNeedsVisualConfirmation(opening));
  const confirmedWindows = windows.filter((opening) => !openingNeedsVisualConfirmation(opening));
  const proposedOpenings = [...doors, ...windows].filter(openingNeedsVisualConfirmation);
  const suppressedOpenings = [...doorFilter.suppressed, ...windowFilter.suppressed, ...proposalPruning.suppressed];
  const issues = [...(draft.issues || [])];

  if (rooms.length === 0) {
    issues.push('拓扑修复后仍未得到房间候选，需要人工描边。');
  }

  if (walls.length < Math.max(4, rooms.length * 2)) {
    issues.push('墙体候选偏少，3D 建模前建议补画或确认墙线。');
  }

  if (doors.length + windows.length === 0) {
    issues.push('未识别到门窗，生成 3D/全景前建议人工补充洞口。');
  }

  const unattachedOpenings = [...confirmedDoors, ...confirmedWindows].filter((opening) => opening.needsWallAttachmentReview);
  if (unattachedOpenings.length) {
    issues.push(`有 ${unattachedOpenings.length} 个门窗未能可靠贴墙，建议在正式转 3D 前复核。`);
  }
  if (suppressedOpenings.length) {
    issues.push(`已隐藏 ${suppressedOpenings.length} 个未能可靠贴墙的语义推测门窗，避免正式图错误开洞。`);
  }
  const commercialReadiness = assessCommercialReadiness({
    draft,
    rooms,
    walls,
    doors: confirmedDoors,
    windows: confirmedWindows,
    proposedOpenings,
    unattachedOpenings
  });
  const threeDReadiness = assessThreeDReadiness({
    draft,
    rooms,
    walls,
    doors: confirmedDoors,
    windows: confirmedWindows,
    proposedOpenings,
    unattachedOpenings,
    commercialReadiness
  });

  return {
    ...draft,
    rooms,
    walls,
    doors,
    windows,
    topology: {
      repairedAt: new Date().toISOString(),
      snappedToGrid: 4,
      wallCountBefore: (draft.walls || []).length,
      wallCountAfter: walls.length,
      roomCount: rooms.length,
      openingCount: confirmedDoors.length + confirmedWindows.length,
      proposedOpeningCount: proposedOpenings.length,
      suppressedOpeningCount: suppressedOpenings.length,
      attachedOpeningCount: [...doors, ...windows].filter((opening) => !opening.needsWallAttachmentReview).length,
      needsReview: walls.length < Math.max(4, rooms.length * 2)
        || doors.length + windows.length === 0
        || unattachedOpenings.length > 0
        || proposedOpenings.length > 0
        || (suppressedOpenings.length > 0 && commercialReadiness.status !== 'commercial_ready'),
      suppressedOpenings
    },
    quality: {
      ...(draft.quality || {}),
      needsReview: Boolean(draft.quality?.needsReview)
        || walls.length < Math.max(4, rooms.length * 2)
        || doors.length + windows.length === 0
        || unattachedOpenings.length > 0
        || proposedOpenings.length > 0
        || commercialReadiness.status !== 'commercial_ready',
      commercialReadiness,
      threeDReadiness
    },
    issues
  };
}

module.exports = {
  repairRecognitionTopology
};
