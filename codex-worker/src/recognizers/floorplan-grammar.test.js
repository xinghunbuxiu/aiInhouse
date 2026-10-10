'use strict';

const assert = require('node:assert/strict');
const { FLOORPLAN_GRAMMAR, buildFloorplanGrammarGuide } = require('./floorplan-grammar');
const { buildRecognitionPrompt } = require('./prompt-builder');

const guide = buildFloorplanGrammarGuide();
assert.equal(guide.version, 1);
assert(guide.rules.length >= 9, 'grammar must cover core floorplan compositions');
assert.equal(new Set(guide.rules.map(rule => rule.id)).size, guide.rules.length,
  'grammar rule IDs must be unique');

for (const id of [
  'room-boundary',
  'door-connection',
  'window-attachment',
  'room-label',
  'wet-room-semantics',
  'kitchen-semantics',
  'shaft-and-circulation',
  'balcony-boundary',
  'annotation-separation'
]) {
  const rule = guide.rules.find(item => item.id === id);
  assert(rule, `missing compositional rule: ${id}`);
  assert(rule.relation && rule.require.length && rule.reject.length && rule.trace,
    `rule must define relationship, positive evidence, counter-evidence, and traceability: ${id}`);
}
assert(guide.outputContract.evidence && guide.outputContract.uncertainty && guide.outputContract.contradiction,
  'guide must require traceable evidence, explicit uncertainty, and preserved contradictions');

const prompt = buildRecognitionPrompt({});
assert(prompt.includes('floorplanGrammarGuide'), 'recognition prompt must include the compositional grammar');
assert(prompt.includes('空间关系') && prompt.includes('证据缺口'),
  'recognition prompt must instruct relational reasoning and explicit evidence gaps');
assert(FLOORPLAN_GRAMMAR.every(rule => prompt.includes(rule.id)),
  'all grammar rule IDs should be available in the model context');

console.log(`Floorplan grammar tests passed: ${guide.rules.length} compositional rules.`);
