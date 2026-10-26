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

function openingPoint(opening = {}) {
  if (point(opening.center)) return opening.center;
  if (point(opening.position)) return opening.position;
  // Scanner-produced openings often store x/y as the rectangle's top-left,
  // not as its center. Use the rectangle center for room association.
  if (point(opening) && finite(opening.width) && finite(opening.height)
    && Number(opening.width) > 0 && Number(opening.height) > 0) {
    return {
      x: Number(opening.x) + Number(opening.width) / 2,
      y: Number(opening.y) + Number(opening.height) / 2
    };
  }
  return point(opening) ? { x: Number(opening.x), y: Number(opening.y) } : null;
}

function openingRoomTolerance(opening = {}) {
  // Door/window centers commonly sit on the wall line, just outside the room
  // interior rectangle. Allow a bounded, dimension-aware margin without
  // associating openings that are far away from every room.
  const span = Math.max(Number(opening.width) || 0, Number(opening.height) || 0);
  return Math.max(8, Math.min(24, span * 0.35));
}

function roomsNearOpening(opening, rooms = [], walls = []) {
  const p = openingPoint(opening);
  if (!point(p)) return [];
  const tolerance = openingRoomTolerance(opening);
  const directlyAssociated = rooms.filter(room => pointInRoom(p, room, tolerance));
  if (directlyAssociated.length) return directlyAssociated;

  // Exterior openings may sit outside the detected room-interior rectangle
  // because the rectangle excludes the wall band or a bay-window projection.
  // Permit a bounded fallback only when the same opening has a real wall
  // reference, agrees with that wall's measured segment, and is near one room.
  if (!Array.isArray(walls) || !walls.length || opening.needsWallAttachmentReview) return [];
  const sourceEvidence = opening.sourceEvidence || {};
  const attachedWallId = opening.attachedWallId || sourceEvidence.attachedWallId;
  if (!attachedWallId || sourceEvidence.withinWallSpan === false
    || sourceEvidence.withinAttachmentSpan === false) return [];
  const wall = walls.find((item, index) =>
    String(item.id || `wall-${index + 1}`) === String(attachedWallId));
  if (!wall) return [];
  const wallEvidence = pointToSegmentEvidence(p, wall);
  const wallTolerance = Math.max(8, Number(wall.thickness) || 0);
  if (!wallEvidence) return [];
  const onWallSegment = wallEvidence.distance <= wallTolerance && wallEvidence.withinSegmentSpan;
  const gapLength = Number(sourceEvidence.gapLength);
  const wallGapEvidence = sourceEvidence.inferredFrom === 'wall-gap-between-supported-wall-runs'
    && sourceEvidence.nearWallEndpoint === true
    && finite(gapLength) && gapLength > 0
    && wallEvidence.withinSegmentSpan === false;
  let onSupportedWallGap = false;
  if (wallGapEvidence) {
    const ax = Number(wall.start.x), ay = Number(wall.start.y);
    const dx = Number(wall.end.x) - ax, dy = Number(wall.end.y) - ay;
    const wallLength = Math.hypot(dx, dy);
    const perpendicularDistance = wallLength > 0
      ? Math.abs((Number(p.x) - ax) * dy - (Number(p.y) - ay) * dx) / wallLength
      : Infinity;
    const extensionLength = Math.max(0, -wallEvidence.projection, wallEvidence.projection - 1) * wallLength;
    onSupportedWallGap = perpendicularDistance <= wallTolerance
      && extensionLength <= gapLength / 2 + wallTolerance
      && wallEvidence.endpointDistance <= gapLength / 2 + wallTolerance;
  }
  if (!onWallSegment && !onSupportedWallGap) return [];

  const nearest = nearestRoomEvidence(opening, rooms);
  const span = Math.max(Number(opening.width) || 0, Number(opening.height) || 0);
  const supportedRoomTolerance = Math.max(tolerance, span * 0.8);
  if (!nearest || nearest.distanceToBounds > supportedRoomTolerance) return [];
  const associatedRoom = rooms.find((room, index) =>
    String(room.id || `room-${index + 1}`) === nearest.roomId);
  return associatedRoom ? [associatedRoom] : [];
}

function nearestRoomEvidence(opening, rooms = []) {
  const p = openingPoint(opening);
  if (!point(p)) return null;
  const tolerance = openingRoomTolerance(opening);
  const candidates = rooms
    .filter(room => [room.x, room.y, room.width, room.height].every(finite)
      && Number(room.width) > 0 && Number(room.height) > 0)
    .map((room, index) => {
      const left = Number(room.x), top = Number(room.y);
      const right = left + Number(room.width), bottom = top + Number(room.height);
      const dx = Math.max(left - Number(p.x), 0, Number(p.x) - right);
      const dy = Math.max(top - Number(p.y), 0, Number(p.y) - bottom);
      const distanceToBounds = Math.hypot(dx, dy);
      return {
        roomId: String(room.id || `room-${index + 1}`),
        distanceToBounds: Number(distanceToBounds.toFixed(2)),
        withinBounds: distanceToBounds === 0,
        withinAssociationTolerance: distanceToBounds <= tolerance,
        tolerance: Number(tolerance.toFixed(2)),
        openingPoint: { x: Number(Number(p.x).toFixed(2)), y: Number(Number(p.y).toFixed(2)) }
      };
    })
    .sort((a, b) => a.distanceToBounds - b.distanceToBounds);
  return candidates[0] || null;
}

function pointToSegmentEvidence(p, segment = {}) {
  if (!point(p) || !point(segment.start) || !point(segment.end)) return null;
  const ax = Number(segment.start.x), ay = Number(segment.start.y);
  const bx = Number(segment.end.x), by = Number(segment.end.y);
  const px = Number(p.x), py = Number(p.y);
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 4) return null;
  const projection = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const nearestX = ax + clampedProjection * dx;
  const nearestY = ay + clampedProjection * dy;
  return {
    distance: Number(Math.hypot(px - nearestX, py - nearestY).toFixed(2)),
    projection: Number(projection.toFixed(4)),
    withinSegmentSpan: projection >= 0 && projection <= 1,
    nearestEndpoint: projection < 0 ? 'start' : projection > 1 ? 'end' : null,
    endpointDistance: Number(Math.min(
      Math.hypot(px - ax, py - ay),
      Math.hypot(px - bx, py - by)
    ).toFixed(2))
  };
}

function nearestWallEvidence(opening, walls = []) {
  const p = openingPoint(opening);
  if (!point(p)) return null;
  const candidates = walls.map((wall, index) => {
    const evidence = pointToSegmentEvidence(p, wall);
    if (!evidence) return null;
    return {
      wallId: String(wall.id || `wall-${index + 1}`),
      ...evidence
    };
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
  return candidates[0] || null;
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
    const connected = roomsNearOpening(door, rooms, walls)
      .map((room, roomIndex) => String(room.id || `room-${roomIndex + 1}`));
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
      const p = openingPoint(opening);
      if (!point(p)) {
        issues.push({ code: `${kind}-position-missing`, severity: 'review', entityId: id });
        return;
      }
      if ((opening.width !== undefined && (!finite(opening.width) || Number(opening.width) <= 0))
        || (opening.height !== undefined && (!finite(opening.height) || Number(opening.height) <= 0))) {
        issues.push({ code: `invalid-${kind}-dimensions`, severity: 'review', entityId: id });
      }
      const roomsContainingOpening = roomsNearOpening(opening, rooms, walls);
      if (roomsContainingOpening.length === 0) {
        // Keep the room-association failure, but expose nearest-wall geometry
        // so reviewers can distinguish a wall-end/topology issue from a symbol
        // that is genuinely detached from the plan.
        issues.push({
          code: `${kind}-not-associated-with-room`,
          severity: 'review',
          entityId: id,
          nearestRoomEvidence: nearestRoomEvidence(opening, rooms),
          nearestWallEvidence: nearestWallEvidence(opening, walls)
        });
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
    const p = openingPoint(opening);
    return point(p) && roomsNearOpening(opening, rooms, walls).length > 0;
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
    const attachmentEvidence = opening.sourceEvidence || {};
    const contradictsAttachment = attachmentEvidence.withinWallSpan === false
      || attachmentEvidence.withinAttachmentSpan === false;
    if (contradictsAttachment) {
      issues.push({
        code: 'opening-wall-attachment-evidence-conflict',
        severity: 'review',
        entityId: id,
        relatedEntityId: String(attachedWallId),
        evidence: {
          withinWallSpan: attachmentEvidence.withinWallSpan ?? null,
          withinAttachmentSpan: attachmentEvidence.withinAttachmentSpan ?? null,
          wallDistance: attachmentEvidence.wallDistance ?? null,
          wallAxisDelta: attachmentEvidence.wallAxisDelta ?? null
        }
      });
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
  const openingById = new Map([
    ...doors.map((entity, index) => [String(entity.id || `door-${index + 1}`), entity]),
    ...windows.map((entity, index) => [String(entity.id || `window-${index + 1}`), entity])
  ]);
  const enrichedIssues = issues.map(issue => {
    const matches = evidenceEntities.filter(entry => entry.id === String(issue.entityId || ''));
    const relatedMatches = evidenceEntities.filter(entry => entry.id === String(issue.relatedEntityId || ''));
    const opening = openingById.get(String(issue.entityId || ''));
    const openingDiagnostics = opening ? {
      nearestRoomEvidence: nearestRoomEvidence(opening, rooms),
      nearestWallEvidence: nearestWallEvidence(opening, walls)
    } : {};
    return {
      ...issue,
      ...openingDiagnostics,
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
