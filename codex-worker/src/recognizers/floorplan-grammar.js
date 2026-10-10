'use strict';

// Floorplan symbols form a visual grammar: meaning comes from both glyph shape
// and the spatial relations between glyphs, boundaries, labels, and openings.
// These rules are evidence prompts, not hard-coded assertions about every plan.
const FLOORPLAN_GRAMMAR = [
  {
    id: 'room-boundary',
    relation: 'wall-lines -> room-boundary -> room-region',
    require: ['boundary segments support the region perimeter', 'adjacent regions may share a boundary'],
    reject: ['a furniture outline alone defines a room', 'large unexplained overlap between room interiors'],
    trace: 'cite wall/segment IDs and any missing or inferred boundary edges'
  },
  {
    id: 'door-connection',
    relation: 'wall-gap + door-leaf-or-swing-arc -> opening -> adjacent spaces',
    require: ['door evidence is near a plausible wall gap', 'connected spaces lie on opposite sides where geometry permits'],
    reject: ['door glyph alone proves a connection', 'door center inside a room rectangle proves the correct doorway', 'moving a door without image evidence'],
    trace: 'cite door candidate, wall/gap evidence, connected room IDs, and conflicts'
  },
  {
    id: 'window-attachment',
    relation: 'parallel-frame-lines + exterior-wall-position -> window',
    require: ['frame-like parallel lines and a plausible wall attachment'],
    reject: ['any pair of parallel lines is a window', 'window detached from the envelope without an explicit reason'],
    trace: 'cite frame evidence, wall ID, span/offset, or missing attachment evidence'
  },
  {
    id: 'room-label',
    relation: 'OCR-label + label-center-inside-room -> room-name',
    require: ['label center falls inside the candidate room region'],
    reject: ['assigning by nearest text alone', 'copying one label to multiple adjacent rooms without evidence'],
    trace: 'cite OCR text and the containing room ID, or explain the containment conflict'
  },
  {
    id: 'wet-room-semantics',
    relation: 'toilet/sink/shower/drain + enclosed-region + label/context -> bathroom-candidate',
    require: ['fixtures support but do not independently determine room type'],
    reject: ['one isolated fixture proves bathroom', 'bathroom label contradicting geometry is silently accepted'],
    trace: 'list observed fixture IDs, region/boundary evidence, label evidence, and uncertainty'
  },
  {
    id: 'kitchen-semantics',
    relation: 'sink/cooktop/cabinet + plumbing/gas context + region -> kitchen-candidate',
    require: ['multiple compatible cues strengthen the interpretation'],
    reject: ['cabinet or appliance alone proves kitchen', 'symbol absence treated as proof that a room is not a kitchen'],
    trace: 'list each supporting cue and any contradictory label/layout cue'
  },
  {
    id: 'shaft-and-circulation',
    relation: 'shaft-enclosure/crossed-diagonals/stair-or-lift-mark -> shaft-or-circulation-candidate',
    require: ['interpret the symbol together with enclosure, doors, and neighboring spaces'],
    reject: ['crossed diagonals automatically mean furniture or sanitary fixture', 'a shaft is relabeled as a bedroom/bathroom to fit a template'],
    trace: 'cite enclosure edges, internal mark, door position, and adjacent-space evidence'
  },
  {
    id: 'balcony-boundary',
    relation: 'exterior-adjacency + outer-edge/railing + opening -> balcony-candidate',
    require: ['boundary and relation to the exterior envelope support the interpretation'],
    reject: ['a thin line alone proves a balcony', 'railing is treated as a load-bearing wall'],
    trace: 'cite exterior wall/opening, railing or edge evidence, and the candidate region'
  },
  {
    id: 'annotation-separation',
    relation: 'dimension-chain/text/axis/leader -> annotation-evidence',
    require: ['use dimensions and text as evidence only when their role is clear'],
    reject: ['dimension/extension/guide lines promoted to walls', 'dimension text used as a room label without spatial containment'],
    trace: 'cite annotation cues and why the geometry was excluded or retained'
  }
];

function buildFloorplanGrammarGuide() {
  return {
    version: 1,
    principle: 'A symbol is a candidate interpretation; its meaning is supported or weakened by composition and spatial relations. Never convert a prior into visual evidence.',
    rules: FLOORPLAN_GRAMMAR.map(rule => ({
      id: rule.id,
      relation: rule.relation,
      require: rule.require,
      reject: rule.reject,
      trace: rule.trace
    })),
    outputContract: {
      evidence: 'For every high-impact inference, record observable cue(s), candidate/entity IDs when available, the spatial relationship, and confidence.',
      uncertainty: 'If a relationship cannot be verified, preserve the candidate with an explicit uncertainty/issue instead of inventing geometry.',
      contradiction: 'Keep contradictory evidence visible; do not silently choose whichever interpretation makes the layout look conventional.'
    }
  };
}

module.exports = { FLOORPLAN_GRAMMAR, buildFloorplanGrammarGuide };
