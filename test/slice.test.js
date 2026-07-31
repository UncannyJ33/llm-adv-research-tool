'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sliceCorpus, similarity } = require('../lib/slice');
const { makeRecord } = require('../lib/corpus');

const rec = (id, title, abstract, cites = 0) =>
  makeRecord({ id, title, abstract, citation_count: cites });

function corpus() {
  return [
    rec('S1', 'Neurovascular coupling in cortex', 'blood flow response to neural activity', 500),
    rec('S2', 'Neurovascular coupling mechanisms', 'hemodynamic response and neural activity'),
    rec('S3', 'Transducer array design for imaging', 'piezoelectric element pitch and aperture'),
    rec('S4', 'Ultrasound transducer engineering', 'array pitch, bandwidth and aperture design'),
    rec('S5', 'Clinical neonatal bedside monitoring', 'infant patients monitored at the bedside'),
    rec('S6', 'Neonatal clinical outcomes', 'bedside infant patient outcomes in the clinic'),
  ];
}

test('similarity is 1 for identical text and low for unrelated text', () => {
  assert.strictEqual(similarity('brain imaging cortex', 'brain imaging cortex'), 1);
  assert.ok(similarity('brain imaging cortex', 'piezoelectric transducer pitch') < 0.2);
});

test('returns the requested number of slices', () => {
  assert.strictEqual(sliceCorpus(corpus(), 3).slices.length, 3);
});

// Withholding foundational work would cripple a perspective rather than diversify it.
test('the shared core appears in every slice', () => {
  const { shared, slices } = sliceCorpus(corpus(), 3, { sharedCount: 1 });
  assert.strictEqual(shared.length, 1);
  assert.strictEqual(shared[0], 'S1', 'most-cited source is the shared core');
  for (const s of slices) assert.ok(s.sourceIds.includes('S1'));
});

test('non-shared sources are partitioned disjointly', () => {
  const { shared, slices } = sliceCorpus(corpus(), 3, { sharedCount: 1 });
  const seen = new Map();
  for (const s of slices) {
    for (const id of s.sourceIds) {
      if (shared.includes(id)) continue;
      assert.ok(!seen.has(id), `${id} appears in more than one slice`);
      seen.set(id, s.index);
    }
  }
  assert.strictEqual(seen.size, 5, 'every non-shared source is assigned exactly once');
});

test('topically similar sources land in the same slice', () => {
  const { slices } = sliceCorpus(corpus(), 3, { sharedCount: 0 });
  const sliceOf = id => slices.findIndex(s => s.sourceIds.includes(id));
  assert.strictEqual(sliceOf('S3'), sliceOf('S4'), 'both transducer papers');
  assert.strictEqual(sliceOf('S5'), sliceOf('S6'), 'both neonatal papers');
});

test('no slice is empty', () => {
  for (const s of sliceCorpus(corpus(), 3).slices) assert.ok(s.sourceIds.length > 0);
});

test('asking for more slices than sources yields fewer slices, not empty ones', () => {
  const { slices } = sliceCorpus([rec('S1', 'a', 'b'), rec('S2', 'c', 'd')], 5);
  assert.ok(slices.length <= 2);
  for (const s of slices) assert.ok(s.sourceIds.length > 0);
});

test('slices carry a distinct human-readable label', () => {
  const { slices } = sliceCorpus(corpus(), 3, { sharedCount: 0 });
  const labels = slices.map(s => s.label);
  assert.strictEqual(new Set(labels).size, labels.length, 'labels are distinct');
  for (const l of labels) assert.ok(l && l.length > 0);
});

test('slicing is deterministic', () => {
  assert.strictEqual(
    JSON.stringify(sliceCorpus(corpus(), 3)),
    JSON.stringify(sliceCorpus(corpus(), 3))
  );
});

test('slicing does not depend on retrieval order', () => {
  const a = sliceCorpus(corpus(), 3);
  const b = sliceCorpus([...corpus()].reverse(), 3);
  assert.deepStrictEqual(
    a.slices.map(s => [...s.sourceIds].sort()),
    b.slices.map(s => [...s.sourceIds].sort())
  );
});

test('an empty corpus returns no slices without throwing', () => {
  const { slices, shared } = sliceCorpus([], 3);
  assert.deepStrictEqual(slices, []);
  assert.deepStrictEqual(shared, []);
});
