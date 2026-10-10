'use strict';

// Deterministic spatial reasoning primitives. These functions do not invent
// geometry; they expose relationships and contradictions in an existing draft.
function finite(value) {
  return value !== null
    && value !== undefined
    && value !== ''
    && Number.isFinite(Number(value));
}

function point(value) {
  return value && finite(value.x) && finite(value.y);
}

function centerOfRoom(room = {}) {
  return {
    x: Number(room.x || 0) + Number(room.width || 0) / 2,
    y: Number(room.y || 0) + Number(room.height || 0) / 2
  };
}

function pointInRoom(p, room = {}, tolerance = 0) {
  return point(p)
    && finite(room.x) && finite(room.y) && finite(room.width) && finite(room.height)
    && Number(p.x) >= Number(room.x) - tolerance
    && Number(p.x) <= Number(room.x) + Number(room.width) + tolerance
    && Number(p.y) >= Number(room.y) - tolerance
    && Number(p.y) <= Number(room.y) + Number(room.height) + tolerance;
}

function openingRoomTolerance(opening = {}) {
  // Door/window centers commonly sit on the wall line, just outside the room
  // interior rectangle. Allow a bounded, dimension-aware margin without
  // associating openings that are far away from every room.
  const span = Math.max(Number(opening.width) || 0, Number(opening.height) || 0);
  return Math.max(8, Math.min(24, span * 0.35));
}

function roomsNearOpening(opening, rooms = []) {
  const p = opening.center || opening.position || opening;
  if (!point(p)) return [];
  const tolerance = openingRoomTolerance(opening);
  return rooms.filter(room => pointInRoom(p, room, tolerance));
}

function segmentLength(segment = {}) {
  if (!point(segment.start) || !point(segment.end)) return 0;
  return Math.hypot(
    Number(segment.end.x) - Number(segment.start.x),
    Number(segment.end.y) - Number(segment.start.y)
  );
}

function buildSpatialGraph(draft = {}) {
  const rooms = Array.isArray(draft.rooms) ? draft.rooms : [];
  const walls = Array.isArray(draft.walls) ? draft.walls : [];
  const doors = Array.isArray(draft.doors) ? draft.doors : [];
  const nodes = rooms.map((room, index) => ({
    id: String(room.id || `room-${index + 1}`),
    name: String(room.name || '未确认空间'),
    type: String(room.type || 'unknown'),
    center: centerOfRoom(room),
    confidence: Number.isFinite(Number(room.confidence)) ? Number(room.confidence) : null
  }));
  const edges = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i], b = rooms[j];
      // Invalid geometry must not create plausible-looking graph edges.
      if (![a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(finite)
        || Number(a.width) <= 0 || Number(a.height) <= 0
        || Number(b.width) <= 0 || Number(b.height) <= 0) {
        continue;
      }
      const verticalGap = Math.max(0,
        Number(a.y) - (Number(b.y) + Number(b.height)),
        Number(b.y) - (Number(a.y) + Number(a.height))
      );
      const horizontalGap = Math.max(0,
        Number(a.x) - (Number(b.x) + Number(b.width)),
        Number(b.x) - (Number(a.x) + Number(a.width))
      );
      const verticalOverlap = Math.max(0, Math.min(Number(a.y) + Number(a.height), Number(b.y) + Number(b.height)) - Math.max(Number(a.y), Number(b.y)));
      const horizontalOverlap = Math.max(0, Math.min(Number(a.x) + Number(a.width), Number(b.x) + Number(b.width)) - Math.max(Number(a.x), Number(b.x)));
      const near = (horizontalGap <= 2 && verticalOverlap > 0) || (verticalGap <= 2 && horizontalOverlap > 0);
      if (near) {
        edges.push({
          from: nodes[i].id,
          to: nodes[j].id,
          relation: 'adjacent',
          sharedBoundaryLength: Number((horizontalGap <= 2 ? verticalOverlap : horizontalOverlap).toFixed(2))
        });
      }
    }
  }
  return { nodes, edges, doorConnections: doors.map((door, index) => {
    const p = door.center || door.position || door;
    const connected = rooms
      .map((room, roomIndex) => ({ room, node: nodes[roomIndex] }))
      .filter(({ room }) => roomsNearOpening(door, [room]).length > 0)
      .map(({ node }) => node.id);
    return { id: String(door.id || `door-${index + 1}`), connectedRoomIds: connected };
  }) };
}

function validateFloorplanDraft(draft = {}) {
  const issues = [];
  const rooms = Array.isArray(draft.rooms) ? draft.rooms : [];
  const walls = Array.isArray(draft.walls) ? draft.walls : [];
  const doors = Array.isArray(draft.doors) ? draft.doors : [];
  const windows = Array.isArray(draft.windows) ? draft.windows : [];
  const ids = new Set();
  rooms.forEach((room, index) => {
    const id = String(room.id || `room-${index + 1}`);
    if (ids.has(id)) issues.push({ code: 'duplicate-room-id', severity: 'error', entityId: id });
    ids.add(id);
    if (![room.x, room.y, room.width, room.height].every(finite) || Number(room.width) <= 0 || Number(room.height) <= 0) {
      issues.push({ code: 'invalid-room-bounds', severity: 'error', entityId: id });
    }
    if (!room.name || room.type === 'unknown' || room.type === 'space') {
      issues.push({ code: 'room-semantics-unconfirmed', severity: 'review', entityId: id });
    }
  });
  const wallIds = new Set();
  walls.forEach((wall, index) => {
    const id = String(wall.id || `wall-${index + 1}`);
    if (wallIds.has(id)) issues.push({ code: 'duplicate-wall-id', severity: 'error', entityId: id });
    wallIds.add(id);
    if (!point(wall.start) || !point(wall.end) || segmentLength(wall) < 2) {
      issues.push({ code: 'invalid-wall-segment', severity: 'error', entityId: id });
    }
    if (wall.thickness !== undefined && (!finite(wall.thickness) || Number(wall.thickness) <= 0)) {
      issues.push({ code: 'invalid-wall-thickness', severity: 'review', entityId: id });
    }
  });
  const validateOpenings = (items, kind) => {
    const openingIds = new Set();
    items.forEach((opening, index) => {
      const id = String(opening.id || `${kind}-${index + 1}`);
      if (openingIds.has(id)) issues.push({ code: `duplicate-${kind}-id`, severity: 'error', entityId: id });
      openingIds.add(id);
      const p = opening.center || opening.position || opening;
      if (!point(p)) {
        issues.push({ code: `${kind}-position-missing`, severity: 'review', entityId: id });
        return;
      }
      if ((opening.width !== undefined && (!finite(opening.width) || Number(opening.width) <= 0))
        || (opening.height !== undefined && (!finite(opening.height) || Number(opening.height) <= 0))) {
        issues.push({ code: `invalid-${kind}-dimensions`, severity: 'review', entityId: id });
      }
      const roomsContainingOpening = roomsNearOpening(opening, rooms);
      if (roomsContainingOpening.length === 0) {
        issues.push({ code: `${kind}-not-associated-with-room`, severity: 'review', entityId: id });
      }
    });
  };
  validateOpenings(doors, 'door');
  validateOpenings(windows, 'window');
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i], b = rooms[j];
      if (![a.x,a.y,a.width,a.height,b.x,b.y,b.width,b.height].every(finite)) continue;
      const overlapX = Math.min(Number(a.x)+Number(a.width), Number(b.x)+Number(b.width)) - Math.max(Number(a.x),Number(b.x));
      const overlapY = Math.min(Number(a.y)+Number(a.height), Number(b.y)+Number(b.height)) - Math.max(Number(a.y),Number(b.y));
      if (overlapX > 2 && overlapY > 2) {
        issues.push({
          code: 'room-bounds-overlap',
          severity: 'review',
          entityId: String(a.id || `room-${i+1}`),
          relatedEntityId: String(b.id || `room-${j+1}`),
          overlap: {
            width: Number(overlapX.toFixed(2)),
            height: Number(overlapY.toFixed(2)),
            area: Number((overlapX * overlapY).toFixed(2))
          }
        });
      }
    }
  }
  // Keep evidence-backed metrics separate from the hard readiness gate.
  // A missing category is null (not 0), so absent detections are not mistaken
  // for a measured 0% success rate.
  const roomGeometryValidCount = rooms.filter(room =>
    [room.x, room.y, room.width, room.height].every(finite)
      && Number(room.width) > 0 && Number(room.height) > 0
  ).length;
  const wallGeometryValidCount = walls.filter(wall =>
    point(wall.start) && point(wall.end) && segmentLength(wall) >= 2
  ).length;
  const openings = [...doors, ...windows];
  const associatedOpeningCount = openings.filter(opening => {
    const p = opening.center || opening.position || opening;
    return point(p) && roomsNearOpening(opening, rooms).length > 0;
  }).length;
  const wallIdsForAttachment = new Set(walls.map((wall, index) => String(wall.id || `wall-${index + 1}`)));
  let wallAttachedOpeningCount = 0;
  openings.forEach((opening, index) => {
    const id = String(opening.id || `opening-${index + 1}`);
    const attachedWallId = opening.attachedWallId || opening.sourceEvidence?.attachedWallId;
    if (attachedWallId && !wallIdsForAttachment.has(String(attachedWallId))) {
      issues.push({ code: 'opening-attached-wall-missing', severity: 'review', entityId: id, relatedEntityId: String(attachedWallId) });
      return;
    }
    if (!attachedWallId) {
      issues.push({ code: 'opening-wall-attachment-missing', severity: 'review', entityId: id });
      if (opening.needsWallAttachmentReview) {
        issues.push({ code: 'opening-wall-attachment-review', severity: 'review', entityId: id });
      }
      return;
    }
    if (!opening.needsWallAttachmentReview) {
      wallAttachedOpeningCount += 1;
    } else {
      issues.push({ code: 'opening-wall-attachment-review', severity: 'review', entityId: id });
    }
  });
  // Attach only evidence that already exists on the detected entity. This lets
  // reviewers jump from a diagnostic back to the originating image candidate
  // without fabricating pixel coordinates for entities that lack provenance.
  const evidenceEntities = [
    ...rooms.map((entity, index) => ({ kind: 'room', id: String(entity.id || `room-${index + 1}`), entity })),
    ...walls.map((entity, index) => ({ kind: 'wall', id: String(entity.id || `wall-${index + 1}`), entity })),
    ...doors.map((entity, index) => ({ kind: 'door', id: String(entity.id || `door-${index + 1}`), entity })),
    ...windows.map((entity, index) => ({ kind: 'window', id: String(entity.id || `window-${index + 1}`), entity }))
  ];
  const describeEvidence = (entry) => {
    if (!entry) return null;
    const entity = entry.entity || {};
    const geometry = entry.kind === 'room'
      ? { x: entity.x, y: entity.y, width: entity.width, height: entity.height }
      : entry.kind === 'wall'
        ? { start: entity.start, end: entity.end, thickness: entity.thickness }
        : { x: entity.x, y: entity.y, center: entity.center, position: entity.position, width: entity.width, height: entity.height };
    return {
      kind: entry.kind,
      entityId: entry.id,
      source: entity.source || null,
      sourceEvidence: entity.sourceEvidence || null,
      geometry
    };
  };
  const enrichedIssues = issues.map(issue => {
    const matches = evidenceEntities.filter(entry => entry.id === String(issue.entityId || ''));
    const relatedMatches = evidenceEntities.filter(entry => entry.id === String(issue.relatedEntityId || ''));
    return {
      ...issue,
      ...(matches.length ? { entityEvidence: matches.map(describeEvidence) } : {}),
      ...(relatedMatches.length ? { relatedEntityEvidence: relatedMatches.map(describeEvidence) } : {})
    };
  });
  const bySeverity = issues.reduce((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    return counts;
  }, {});
  const byCode = issues.reduce((counts, issue) => {
    counts[issue.code] = (counts[issue.code] || 0) + 1;
    return counts;
  }, {});
  const ratio = (count, total) => total > 0 ? Number((count / total).toFixed(4)) : null;
  const metrics = {
    roomCount: rooms.length,
    roomGeometryValidCount,
    roomGeometryValidRatio: ratio(roomGeometryValidCount, rooms.length),
    wallCount: walls.length,
    wallGeometryValidCount,
    wallGeometryValidRatio: ratio(wallGeometryValidCount, walls.length),
    openingCount: openings.length,
    associatedOpeningCount,
    openingAssociationRatio: ratio(associatedOpeningCount, openings.length),
    wallAttachedOpeningCount,
    wallAttachmentRatio: ratio(wallAttachedOpeningCount, openings.length),
    issueCount: issues.length,
    errorCount: bySeverity.error || 0,
    reviewCount: bySeverity.review || 0,
    issuesBySeverity: bySeverity,
    issuesByCode: byCode
  };
  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    reviewRequired: issues.some(issue => issue.severity === 'review'),
    issues: enrichedIssues,
    metrics,
    graph: buildSpatialGraph(draft)
  };
}

module.exports = { buildSpatialGraph, validateFloorplanDraft, pointInRoom, segmentLength };
