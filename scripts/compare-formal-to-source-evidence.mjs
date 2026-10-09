import fs from 'node:fs';
import path from 'node:path';

function arg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
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

function rectFromOpening(opening = {}) {
  const width = Math.max(6, num(opening.width ?? opening.widthPx, opening.type === 'door' ? 28 : 48));
  const height = Math.max(6, num(opening.height ?? opening.heightPx, 8));
  const x = num(opening.x ?? opening.center?.x) - width / 2;
  const y = num(opening.y ?? opening.center?.y) - height / 2;
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function rectFromCandidate(candidate = {}) {
  const width = Math.max(6, num(candidate.width));
  const height = Math.max(6, num(candidate.height));
  const cx = num(candidate.center?.x, num(candidate.x) + width / 2);
  const cy = num(candidate.center?.y, num(candidate.y) + height / 2);
  return { x: num(candidate.x), y: num(candidate.y), width, height, cx, cy };
}

function rectContainsPoint(rect = {}, point = {}, tolerance = 0) {
  return num(point.x) >= num(rect.x) - tolerance
    && num(point.y) >= num(rect.y) - tolerance
    && num(point.x) <= num(rect.x) + num(rect.width) + tolerance
    && num(point.y) <= num(rect.y) + num(rect.height) + tolerance;
}

function classifyRawWindowCandidate(candidate = {}, context = {}) {
  const rect = rectFromCandidate(candidate);
  const support = candidate.wallSupport || {};
  const strongWallSupport = num(support.score) >= 1.15 || (num(support.distance, 999) <= 18 && num(support.overlapRatio) >= 0.75);
  const insideBalconyCandidate = (context.rawBalconies || []).find((balcony) => rectContainsPoint(balcony, { x: rect.cx, y: rect.cy }, 18));
  const insideRoom = (context.rooms || []).find((room) => rectContainsPoint(room, { x: rect.cx, y: rect.cy }, 8));
  const nearRoomEdge = insideRoom && (
    Math.min(
      Math.abs(rect.cy - num(insideRoom.y)),
      Math.abs(rect.cy - (num(insideRoom.y) + num(insideRoom.height))),
      Math.abs(rect.cx - num(insideRoom.x)),
      Math.abs(rect.cx - (num(insideRoom.x) + num(insideRoom.width)))
    ) <= 24
  );
  const tiny = Math.max(rect.width, rect.height) < 46;

  if (insideBalconyCandidate) {
    return {
      classification: 'balcony_outline_or_window_review',
      action: 'review_balcony_outline_before_promote',
      reason: `inside ${insideBalconyCandidate.id}; do not cut 3D until balcony contour is confirmed`
    };
  }

  if (strongWallSupport && nearRoomEdge) {
    return {
      classification: 'strong_wall_window_candidate',
      action: 'promote_to_proposed_window_for_review',
      reason: `strong wall support ${num(support.score).toFixed(2)} near ${insideRoom.id} edge`
    };
  }

  if (strongWallSupport) {
    if (!insideRoom) {
      return {
        classification: 'isolated_wall_symbol_without_room_owner',
        action: 'keep_rejected_unless_room_boundary_changes',
        reason: `strong wall support ${num(support.score).toFixed(2)} but no containing room/proposed room`
      };
    }
    return {
      classification: 'internal_wall_or_opening_symbol_review',
      action: 'review_against_room_topology',
      reason: `strong wall support ${num(support.score).toFixed(2)} but not on a clear exterior/room edge`
    };
  }

  if (insideRoom || tiny || num(candidate.nearbyTextComponentCount) > 0) {
    return {
      classification: 'likely_auxiliary_or_furniture_line',
      action: 'keep_rejected_unless_confirmed',
      reason: insideRoom ? `inside ${insideRoom.id}` : (tiny ? 'small short parallel lines' : 'near text/annotation')
    };
  }

  return {
    classification: 'unresolved_raw_window_candidate',
    action: 'manual_review',
    reason: 'not covered by formal openings and no decisive local context'
  };
}

function overlapRatio(a = {}, b = {}) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const width = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const overlap = width * height;
  const smaller = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return overlap / smaller;
}

function largerOverlapRatio(a = {}, b = {}) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const width = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const overlap = width * height;
  const larger = Math.max(1, Math.max(a.width * a.height, b.width * b.height));
  return overlap / larger;
}

function centerDistance(a = {}, b = {}) {
  return Math.hypot(num(a.cx) - num(b.cx), num(a.cy) - num(b.cy));
}

function findOpeningMatch(candidate = {}, openings = [], type = '') {
  const candidateRect = rectFromCandidate(candidate);
  let best = null;
  for (const opening of openings) {
    if (type && opening.type !== type) {
      continue;
    }
    const openingRect = rectFromOpening(opening);
    const overlap = overlapRatio(candidateRect, openingRect);
    const distance = centerDistance(candidateRect, openingRect);
    const sameOrientation = (candidateRect.width >= candidateRect.height) === (openingRect.width >= openingRect.height);
    const score = overlap * 1.8 + Math.max(0, 1 - distance / 90) + (sameOrientation ? 0.3 : 0);
    if (!best || score > best.score) {
      best = { opening, overlap, distance, sameOrientation, score };
    }
  }
  return best;
}

function classifyEvidenceCoverage(rawCandidates = [], openings = [], type = '', context = {}) {
  return rawCandidates.map((candidate) => {
    const match = findOpeningMatch(candidate, openings, type);
    const covered = Boolean(match && (
      match.overlap >= 0.42
      || match.distance <= 42
      || (match.sameOrientation && match.distance <= 48)
    ));
    const classification = type === 'window' && !covered
      ? classifyRawWindowCandidate(candidate, context)
      : {
        classification: covered ? 'covered_by_formal_opening' : 'missing_or_misaligned',
        action: covered ? 'none' : 'manual_review',
        reason: covered ? `matched ${match?.opening?.id || ''}` : 'no matching formal opening'
      };
    return {
      id: candidate.id,
      type,
      x: num(candidate.x),
      y: num(candidate.y),
      width: num(candidate.width),
      height: num(candidate.height),
      confidence: candidate.confidence ?? null,
      covered,
      matchedOpeningId: covered ? match.opening.id : '',
      matchedOpeningSource: covered ? match.opening.source || '' : '',
      overlap: match ? Number(match.overlap.toFixed(3)) : 0,
      distance: match ? Number(match.distance.toFixed(1)) : null,
      status: covered ? 'covered' : 'missing_or_misaligned',
      classification: classification.classification,
      recommendedAction: classification.action,
      classificationReason: classification.reason
    };
  });
}

function classifyProposedRoomConflicts(formalPlan = {}) {
  const rooms = formalPlan.rooms || [];
  const proposedRooms = formalPlan.proposedRooms || [];
  return proposedRooms
    .filter((room) => room.type === 'balcony')
    .map((room) => {
      const roomRect = rectFromCandidate(room);
      const overlaps = rooms
        .map((acceptedRoom) => {
          const acceptedRect = rectFromCandidate(acceptedRoom);
          return {
            id: acceptedRoom.id,
            type: acceptedRoom.type || '',
            name: acceptedRoom.name || '',
            overlapRatio: Number(overlapRatio(roomRect, acceptedRect).toFixed(3)),
            largerOverlapRatio: Number(largerOverlapRatio(roomRect, acceptedRect).toFixed(3))
          };
        })
        .filter((item) => item.overlapRatio >= 0.18 || item.largerOverlapRatio >= 0.08)
        .sort((a, b) => b.overlapRatio - a.overlapRatio);
      const hasAcceptedBalcony = rooms.some((acceptedRoom) => acceptedRoom.type === 'balcony' && overlapRatio(roomRect, rectFromCandidate(acceptedRoom)) >= 0.5);
      const highestOverlap = overlaps[0]?.overlapRatio || 0;
      let classification = 'proposed_balcony_pending_confirmation';
      let recommendedAction = 'review_balcony_boundary_against_source';
      let reason = 'balcony candidate is proposed but not confirmed';
      if (!hasAcceptedBalcony && highestOverlap >= 0.28) {
        classification = 'balcony_candidate_covered_by_accepted_rooms';
        recommendedAction = 'split_or_trim_overlapping_rooms_before_confirming_balcony';
        reason = `overlaps accepted room model: ${overlaps.map((item) => `${item.id}:${item.overlapRatio}`).join(', ')}`;
      }
      return {
        id: room.id,
        sourceCandidateId: room.sourceCandidateId || '',
        type: room.type,
        x: num(room.x),
        y: num(room.y),
        width: num(room.width),
        height: num(room.height),
        confidence: room.confidence ?? null,
        classification,
        recommendedAction,
        reason,
        overlappingRooms: overlaps
      };
    });
}

function openingRectSvg(opening = {}, options = {}) {
  const rect = rectFromOpening(opening);
  const dash = options.dash ? ` stroke-dasharray="${options.dash}"` : '';
  return `
    <g data-opening="${escapeXml(opening.id || '')}">
      <rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}" width="${rect.width.toFixed(1)}" height="${rect.height.toFixed(1)}" fill="${options.color}" fill-opacity="${options.opacity ?? 0.18}" stroke="${options.color}" stroke-width="${options.strokeWidth ?? 3}"${dash}>
        <title>${escapeXml(`${opening.id || ''} ${opening.type || ''} ${opening.source || ''}`)}</title>
      </rect>
      <text x="${rect.x.toFixed(1)}" y="${Math.max(18, rect.y - 6).toFixed(1)}" font-size="12" font-weight="900" fill="${options.color}" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(options.label || opening.type || '')}</text>
    </g>`;
}

function candidateRectSvg(candidate = {}, options = {}) {
  const rect = rectFromCandidate(candidate);
  const dash = options.dash ? ` stroke-dasharray="${options.dash}"` : '';
  return `
    <g data-candidate="${escapeXml(candidate.id || '')}">
      <rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}" width="${rect.width.toFixed(1)}" height="${rect.height.toFixed(1)}" fill="${options.color}" fill-opacity="${options.opacity ?? 0.08}" stroke="${options.color}" stroke-width="${options.strokeWidth ?? 2}"${dash}>
        <title>${escapeXml(`${candidate.id || ''} ${candidate.source || ''}`)}</title>
      </rect>
    </g>`;
}

function coverageRectSvg(item = {}) {
  const palette = {
    strong_wall_window_candidate: '#16a34a',
    balcony_outline_or_window_review: '#0891b2',
    internal_wall_or_opening_symbol_review: '#d97706',
    likely_auxiliary_or_furniture_line: '#64748b',
    unresolved_raw_window_candidate: '#dc2626'
  };
  const color = palette[item.classification] || '#dc2626';
  const dash = item.classification === 'strong_wall_window_candidate' ? '' : ' stroke-dasharray="6 5"';
  return `
    <g data-missing-evidence="${escapeXml(item.id || '')}">
      <rect x="${num(item.x).toFixed(1)}" y="${num(item.y).toFixed(1)}" width="${Math.max(6, num(item.width)).toFixed(1)}" height="${Math.max(6, num(item.height)).toFixed(1)}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="4"${dash}>
        <title>${escapeXml(`${item.id} ${item.classification} ${item.classificationReason}`)}</title>
      </rect>
      <text x="${num(item.x).toFixed(1)}" y="${Math.max(18, num(item.y) - 8).toFixed(1)}" font-size="12" font-weight="900" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(item.classification || '')}</text>
    </g>`;
}

function roomSvg(room = {}) {
  const color = room.type === 'balcony' ? '#0284c7' : '#64748b';
  return `<rect x="${num(room.x).toFixed(1)}" y="${num(room.y).toFixed(1)}" width="${num(room.width).toFixed(1)}" height="${num(room.height).toFixed(1)}" fill="${color}" fill-opacity="0.06" stroke="${color}" stroke-width="2" stroke-dasharray="${room.type === 'balcony' ? '8 5' : ''}"/>`;
}

function proposedRoomSvg(room = {}) {
  const isConflict = (room.reviewReasons || []).some((reason) => String(reason).includes('overlaps-accepted-room-model'));
  const color = isConflict ? '#dc2626' : '#0891b2';
  return `
    <g data-proposed-room="${escapeXml(room.id || '')}">
      <rect x="${num(room.x).toFixed(1)}" y="${num(room.y).toFixed(1)}" width="${num(room.width).toFixed(1)}" height="${num(room.height).toFixed(1)}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="4" stroke-dasharray="14 8">
        <title>${escapeXml(`${room.id || ''} ${room.name || ''} ${(room.reviewReasons || []).join(', ')}`)}</title>
      </rect>
      <text x="${num(room.x).toFixed(1)}" y="${Math.max(18, num(room.y) - 10).toFixed(1)}" font-size="13" font-weight="900" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(isConflict ? 'balcony-room-boundary-conflict' : 'proposed-balcony')}</text>
    </g>`;
}

function writeSvg(outputDir, report, preprocess, formalPlan) {
  const width = num(preprocess.image?.width, 1400);
  const height = num(preprocess.image?.height, 973);
  const confirmed = formalPlan.openings || [];
  const proposed = formalPlan.proposedOpenings || [];
  const rawWindows = preprocess.geometryCandidates?.windowSymbolCandidates || [];
  const rawDoors = preprocess.geometryCandidates?.doorSymbolCandidates || [];
  const rawBalconies = preprocess.geometryCandidates?.balconyCandidates || [];
  const rooms = formalPlan.rooms || [];
  const proposedRooms = formalPlan.proposedRooms || [];
  const missingWindows = report.rawWindowCoverage.filter((item) => !item.covered);
  const rawBalconySvg = rawBalconies.map((candidate) => {
    const matchedAccepted = rooms.some((room) => room.type === 'balcony' && overlapRatio(rectFromCandidate(candidate), rectFromCandidate(room)) >= 0.55);
    const stillProposed = proposedRooms.some((room) => room.sourceCandidateId === candidate.id);
    return candidateRectSvg(candidate, matchedAccepted
      ? { color: '#0891b2', dash: '', strokeWidth: 3 }
      : stillProposed
        ? { color: '#06b6d4', dash: '12 7', strokeWidth: 3 }
        : { color: '#64748b', dash: '5 5', strokeWidth: 2 });
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="./recognition-input.jpg" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" opacity="0.08"/>
  <g data-layer="formal-rooms">${rooms.map(roomSvg).join('\n')}</g>
  <g data-layer="formal-proposed-rooms">${proposedRooms.map(proposedRoomSvg).join('\n')}</g>
  <g data-layer="raw-balcony-candidates">${rawBalconySvg}</g>
  <g data-layer="raw-window-candidates">${rawWindows.map((candidate) => candidateRectSvg(candidate, { color: '#2563eb', dash: '6 5' })).join('\n')}</g>
  <g data-layer="raw-door-candidates">${rawDoors.map((candidate) => candidateRectSvg(candidate, { color: '#f59e0b', dash: '6 5' })).join('\n')}</g>
  <g data-layer="missing-window-classification">${missingWindows.map(coverageRectSvg).join('\n')}</g>
  <g data-layer="formal-confirmed-openings">${confirmed.map((opening) => openingRectSvg(opening, { color: opening.type === 'door' ? '#ea580c' : '#059669', label: `confirmed-${opening.type}` })).join('\n')}</g>
  <g data-layer="formal-proposed-openings">${proposed.map((opening) => openingRectSvg(opening, { color: '#dc2626', dash: '9 6', opacity: 0.1, label: `review-${opening.type}` })).join('\n')}</g>
  <rect x="18" y="16" width="850" height="98" rx="8" fill="#fff" fill-opacity="0.94" stroke="#cbd5e1"/>
  <text x="34" y="42" font-size="16" font-weight="900" fill="#0f172a">正式平面图 vs 原图证据: confirmed ${report.summary.confirmedOpeningCount} / proposed ${report.summary.proposedOpeningCount}</text>
  <text x="34" y="65" font-size="13" fill="#475569">绿/橙=正式 confirmed, 红虚线=正式 proposed/review, 蓝虚线=原始窗候选, 橙虚线=原始门候选, 青色=确认/拟议阳台, 灰虚线=已拒绝轮廓</text>
  <text x="34" y="88" font-size="13" fill="#b91c1c">missing raw door ${report.summary.missingRawDoorEvidenceCount} / window ${report.summary.missingRawWindowEvidenceCount}; green=promote review, cyan=balcony review, amber=topology review, gray=likely auxiliary</text>
</svg>`;
  fs.writeFileSync(path.join(outputDir, 'formal-vs-source-review.svg'), svg, 'utf8');
}

function main() {
  const outputDir = path.resolve(arg('--output', process.cwd()));
  const preprocess = readJson(path.join(outputDir, 'recognition-preprocess.json'));
  const formalPlan = readJson(path.join(outputDir, 'formal-plan.json'));
  const projectionReview = readJson(path.join(outputDir, 'projection-review.json'), { reviewItems: [] });
  const confirmed = formalPlan.openings || [];
  const proposed = formalPlan.proposedOpenings || [];
  const allOpenings = [...confirmed, ...proposed];
  const rawWindows = preprocess.geometryCandidates?.windowSymbolCandidates || [];
  const rawDoors = preprocess.geometryCandidates?.doorSymbolCandidates || [];

  const context = {
    rawBalconies: preprocess.geometryCandidates?.balconyCandidates || [],
    rooms: [...(formalPlan.rooms || []), ...(formalPlan.proposedRooms || [])]
  };
  const rawWindowCoverage = classifyEvidenceCoverage(rawWindows, allOpenings, 'window', context);
  const rawDoorCoverage = classifyEvidenceCoverage(rawDoors, allOpenings, 'door', context);
  const proposedRoomConflicts = classifyProposedRoomConflicts(formalPlan);
  const missingRawWindows = rawWindowCoverage.filter((item) => !item.covered);
  const missingRawDoors = rawDoorCoverage.filter((item) => !item.covered);
  const balconyConflictCount = proposedRoomConflicts.filter((item) => item.classification === 'balcony_candidate_covered_by_accepted_rooms').length;
  const missingRawWindowClassifications = missingRawWindows.reduce((acc, item) => {
    acc[item.classification] = (acc[item.classification] || 0) + 1;
    return acc;
  }, {});

  const report = {
    status: (projectionReview.reviewItems || []).length || missingRawWindows.length || missingRawDoors.length ? 'review_required' : 'passed',
    files: {
      overlay: 'formal-vs-source-review.svg',
      projectionReview: 'projection-review.json',
      formalPlan: 'formal-plan.json',
      sourceImage: 'recognition-input.jpg'
    },
    summary: {
      confirmedOpeningCount: confirmed.length,
      proposedOpeningCount: proposed.length,
      projectionReviewItemCount: (projectionReview.reviewItems || []).length,
      rawDoorEvidenceCount: rawDoors.length,
      rawWindowEvidenceCount: rawWindows.length,
      missingRawDoorEvidenceCount: missingRawDoors.length,
      missingRawWindowEvidenceCount: missingRawWindows.length,
      proposedRoomConflictCount: proposedRoomConflicts.length,
      balconyRoomBoundaryConflictCount: balconyConflictCount,
      missingRawWindowClassifications
    },
    rawDoorCoverage,
    rawWindowCoverage,
    proposedRoomConflicts,
    projectionReviewItems: projectionReview.reviewItems || []
  };

  writeSvg(outputDir, report, preprocess, formalPlan);
  fs.writeFileSync(path.join(outputDir, 'formal-vs-source-review.json'), JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify({ output: report.files, summary: report.summary })}\n`);
}

main();
