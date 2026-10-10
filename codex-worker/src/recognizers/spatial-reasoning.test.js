'use strict';

const assert = require('node:assert/strict');
const { buildSpatialGraph, validateFloorplanDraft } = require('./spatial-reasoning');

const room = { id: 'room-a', name: 'Living', type: 'living', x: 0, y: 0, width: 100, height: 100 };
const nearDoor = { id: 'door-near-wall', center: { x: 108, y: 50 }, width: 30, height: 4 };
const farDoor = { id: 'door-far-away', center: { x: 150, y: 50 }, width: 30, height: 4 };

const nearReport = validateFloorplanDraft({ rooms: [room], doors: [nearDoor] });
assert.equal(nearReport.issues.some(issue => issue.code === 'door-not-associated-with-room'), false,
  'opening near a room boundary should be associated within the bounded tolerance');
assert.deepEqual(buildSpatialGraph({ rooms: [room], doors: [nearDoor] }).doorConnections[0].connectedRoomIds, ['room-a'],
  'spatial graph and validation should use the same opening association rule');

const farReport = validateFloorplanDraft({ rooms: [room], doors: [farDoor] });
assert.equal(farReport.issues.some(issue => issue.code === 'door-not-associated-with-room'), true,
  'opening far from all rooms must remain flagged');

const rectangleDoor = { id: 'door-rectangle', x: -10, y: 40, width: 20, height: 10 };
const rectangleReport = validateFloorplanDraft({ rooms: [room], doors: [rectangleDoor] });
assert.equal(rectangleReport.issues.some(issue => issue.code === 'door-not-associated-with-room'), false,
  'scanner rectangle x/y must be interpreted as top-left and associated by its center');
assert.deepEqual(buildSpatialGraph({ rooms: [room], doors: [rectangleDoor] }).doorConnections[0].connectedRoomIds, ['room-a'],
  'spatial graph must use rectangle center instead of top-left coordinates');

const attachedWall = { id: 'wall-a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
const conflictingWindow = {
  id: 'window-conflict',
  center: { x: 50, y: 10 },
  width: 20,
  height: 5,
  attachedWallId: 'wall-a',
  sourceEvidence: { attachedWallId: 'wall-a', withinWallSpan: false, withinAttachmentSpan: true, wallDistance: 61, wallAxisDelta: -61 }
};
const attachmentReport = validateFloorplanDraft({ rooms: [room], walls: [attachedWall], windows: [conflictingWindow] });
assert.equal(attachmentReport.issues.some(issue => issue.code === 'opening-wall-attachment-evidence-conflict'), true,
  'an existing wall ID must not override explicit evidence that the opening falls outside the wall span');
assert.equal(attachmentReport.metrics.wallAttachedOpeningCount, 0,
  'contradictory attachment evidence must not count as a verified wall attachment');

const overlapReport = validateFloorplanDraft({
  rooms: [
    room,
    { id: 'room-b', name: 'Bedroom', type: 'bedroom', x: 90, y: 90, width: 40, height: 30 }
  ]
});
const overlap = overlapReport.issues.find(issue => issue.code === 'room-bounds-overlap');
assert.deepEqual(overlap?.overlap, { width: 10, height: 10, area: 100 },
  'overlap diagnostics should quantify intersection geometry');

console.log('spatial-reasoning tests passed');
