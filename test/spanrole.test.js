'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectSection, crossCheck } = require('../lib/spanrole');

const PAPER = `
Introduction
We study cortical imaging in rodents.

Results
Resolution reached 100 um in the rodent cortex across all trials.

Limitations
We cannot rule out motion artifacts in awake animals.

Related Work
Tanter et al. reported sub-millimeter resolution in neonates.
`;

test('detects a span inside a Results section', () => {
  const d = detectSection(PAPER, 'Resolution reached 100 um in the rodent cortex');
  assert.strictEqual(d.section, 'result');
  assert.strictEqual(d.heading, 'Results');
});

test('detects a span inside a Limitations section', () => {
  assert.strictEqual(detectSection(PAPER, 'We cannot rule out motion artifacts').section, 'limitation');
});

test('detects a span inside a Related Work section', () => {
  assert.strictEqual(
    detectSection(PAPER, 'Tanter et al. reported sub-millimeter resolution').section,
    'related-work'
  );
});

test('returns unknown when no heading precedes the span', () => {
  const d = detectSection('Just a bare abstract with no headings at all here.', 'bare abstract');
  assert.strictEqual(d.section, 'unknown');
  assert.strictEqual(d.confidence, 'none');
});

test('returns unknown when the span is absent rather than guessing', () => {
  assert.strictEqual(detectSection(PAPER, 'not in this document anywhere').section, 'unknown');
});

test('crossCheck agrees when declared role matches the detected section', () => {
  const c = crossCheck('result', { section: 'result', heading: 'Results', confidence: 'high' });
  assert.strictEqual(c.agrees, true);
  assert.strictEqual(c.warning, null);
});

// THE case this module exists for: the role is model-declared, so a wrong one would
// otherwise slip past every mechanical check.
test('crossCheck warns when a limitations span is declared as a result', () => {
  const c = crossCheck('result', { section: 'limitation', heading: 'Limitations', confidence: 'high' });
  assert.strictEqual(c.agrees, false);
  assert.match(c.warning, /limitation/i);
  assert.match(c.warning, /declared/i);
});

test('crossCheck warns when a related-work span is declared as a result', () => {
  const c = crossCheck('result', { section: 'related-work', heading: 'Related Work', confidence: 'high' });
  assert.strictEqual(c.agrees, false);
  assert.match(c.warning, /related.work/i);
});

test('crossCheck stays silent when the section is unknown — it advises, never overrides', () => {
  const c = crossCheck('result', { section: 'unknown', heading: null, confidence: 'none' });
  assert.strictEqual(c.agrees, true);
  assert.strictEqual(c.warning, null);
});

test('a Methods heading is detected distinctly from Results', () => {
  const doc = 'Methods\nWe imaged twelve rats using a linear array probe.\n\nResults\nAll twelve showed signal.';
  assert.strictEqual(detectSection(doc, 'We imaged twelve rats').section, 'method');
  assert.strictEqual(detectSection(doc, 'All twelve showed signal').section, 'result');
});
