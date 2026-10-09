import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    output: '',
    expectedRooms: ['主卧', '主卫', '男孩卧', '阳台', '厨房', '餐厅', '门厅', '客厅'],
    minWalls: 32,
    minAttachedOpeningRatio: 0.95,
    allowHumanReview: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--output') {
      args.output = next || '';
      i += 1;
    } else if (arg === '--expected-rooms') {
      args.expectedRooms = String(next || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--min-walls') {
      args.minWalls = Number(next || args.minWalls);
      i += 1;
    } else if (arg === '--min-attached-opening-ratio') {
      args.minAttachedOpeningRatio = Number(next || args.minAttachedOpeningRatio);
      i += 1;
    } else if (arg === '--require-commercial-ready') {
      args.allowHumanReview = false;
    }
  }

  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function roomArea(room) {
  return Number(room.area ?? ((Number(room.width) || 0) * (Number(room.height) || 0)));
}

function summarizeLivingDining(rooms) {
  const living = rooms.filter((room) => room.type === 'living' || room.name === '客厅');
  const dining = rooms.filter((room) => room.type === 'dining' || room.name === '餐厅');
  const combined = [...living, ...dining];
  return {
    present: living.length > 0 && dining.length > 0,
    roomNames: combined.map((room) => room.name || room.id),
    area: Number(combined.reduce((sum, room) => sum + roomArea(room), 0).toFixed(2))
  };
}

const args = parseArgs(process.argv.slice(2));
assert(args.output, 'Usage: node scripts/verify-commercial-recognition-target.mjs --output <worker-output-dir>');

const draftFile = path.join(args.output, 'recognition-draft.json');
const manifestFile = path.join(args.output, 'delivery-manifest.json');
assert(fs.existsSync(draftFile), `Missing recognition draft: ${draftFile}`);

const draft = readJson(draftFile);
const manifest = fs.existsSync(manifestFile) ? readJson(manifestFile) : null;
const deliveryStatus = manifest?.deliveryStatus || manifest?.status || manifest?.summary?.deliveryStatus || null;
const rooms = draft.rooms || [];
const walls = draft.walls || [];
const openings = [...(draft.doors || []), ...(draft.windows || [])];
const readiness = draft.quality?.commercialReadiness || {};
const roomNames = new Set(rooms.map((room) => room.name).filter(Boolean));
const missingRooms = args.expectedRooms.filter((name) => !roomNames.has(name));
const unknownRooms = rooms.filter((room) => !room.type || room.type === 'space' || /^候选空间/.test(String(room.name || '')));
const unattachedOpenings = openings.filter((opening) => opening.needsWallAttachmentReview);
const attachedOpeningRatio = openings.length ? (openings.length - unattachedOpenings.length) / openings.length : 0;
const livingDining = summarizeLivingDining(rooms);

assert(missingRooms.length === 0, `Missing expected rooms: ${missingRooms.join(', ')}`);
assert(unknownRooms.length === 0, `Found unclassified rooms: ${unknownRooms.map((room) => room.name || room.id).join(', ')}`);
assert(livingDining.present, 'Expected 客厅 and 餐厅 to be recognized as a living+dining combined comparison group.');
assert(walls.length >= args.minWalls, `Wall count too low: ${walls.length} < ${args.minWalls}`);
assert(openings.length > 0, 'No door/window openings found.');
assert(attachedOpeningRatio >= args.minAttachedOpeningRatio, `Attached opening ratio too low: ${attachedOpeningRatio.toFixed(2)}`);

if (args.allowHumanReview) {
  assert(['commercial_ready', 'needs_human_review'].includes(readiness.status), `Unexpected readiness status: ${readiness.status || '-'}`);
} else {
  assert(readiness.status === 'commercial_ready', `Recognition is not commercial-ready: ${readiness.status || '-'}`);
}

if (deliveryStatus === 'commercial_ready' || manifest?.commercialReady === true) {
  assert(readiness.status === 'commercial_ready', 'Delivery manifest cannot be commercial_ready unless recognition readiness is commercial_ready.');
}

console.log(JSON.stringify({
  ok: true,
  output: args.output,
  rooms: rooms.map((room) => ({
    name: room.name,
    type: room.type,
    source: room.source,
    boundaryNeedsReview: Boolean(room.boundaryNeedsReview || room.sourceEvidence?.boundaryNeedsReview)
  })),
  livingDining,
  wallCount: walls.length,
  openingCount: openings.length,
  attachedOpeningRatio: Number(attachedOpeningRatio.toFixed(2)),
  readiness: {
    status: readiness.status || null,
    score: readiness.score ?? null,
    blockingReasons: readiness.blockingReasons || []
  },
  deliveryStatus
}, null, 2));
