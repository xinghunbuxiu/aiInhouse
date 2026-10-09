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
      .filter(({ room }) => pointInRoom(p, room, 3))
      .map(({ node }) => node.id);
    return { id: String(door.id || `door-${index + 1}`), connectedRoomIds: connected };
  }) };
}

function validateFloorplanDraft(draft = {}) {
  const issues = [];
  const rooms = Array.isArray(draft.rooms) ? draft.rooms : [];
  const walls = Array.isArray(draft.walls) ? draft.walls : [];
  const doors = Array.isArray(draft.doors) ? draft.doors : [];
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
  walls.forEach((wall, index) => {
    const id = String(wall.id || `wall-${index + 1}`);
    if (!point(wall.start) || !point(wall.end) || segmentLength(wall) < 2) {
      issues.push({ code: 'invalid-wall-segment', severity: 'error', entityId: id });
    }
  });
  doors.forEach((door, index) => {
    const id = String(door.id || `door-${index + 1}`);
    const p = door.center || door.position || door;
    if (!point(p)) {
      issues.push({ code: 'door-position-missing', severity: 'review', entityId: id });
      return;
    }
    const roomsContainingDoor = rooms.filter(room => pointInRoom(p, room, 3));
    if (roomsContainingDoor.length === 0) {
      issues.push({ code: 'door-not-associated-with-room', severity: 'review', entityId: id });
    }
  });
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i], b = rooms[j];
      if (![a.x,a.y,a.width,a.height,b.x,b.y,b.width,b.height].every(finite)) continue;
      const overlapX = Math.min(Number(a.x)+Number(a.width), Number(b.x)+Number(b.width)) - Math.max(Number(a.x),Number(b.x));
      const overlapY = Math.min(Number(a.y)+Number(a.height), Number(b.y)+Number(b.height)) - Math.max(Number(a.y),Number(b.y));
      if (overlapX > 2 && overlapY > 2) {
        issues.push({ code: 'room-bounds-overlap', severity: 'review', entityId: String(a.id || `room-${i+1}`), relatedEntityId: String(b.id || `room-${j+1}`) });
      }
    }
  }
  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    reviewRequired: issues.some(issue => issue.severity === 'review'),
    issues,
    graph: buildSpatialGraph(draft)
  };
}

module.exports = { buildSpatialGraph, validateFloorplanDraft, pointInRoom, segmentLength };
