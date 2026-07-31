'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { sliceCorpus, similarity, hasText } = require('../lib/slice');
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

// A real corpus produced buckets of 41 and 5 under pure nearest-seed assignment. A
// perspective starved to a handful of sources is a crippled agent, not a viewpoint.
test('slices are balanced — no slice absorbs the corpus', () => {
  const many = [];
  for (let i = 1; i <= 40; i++) {
    many.push(rec(`S${i}`, 'Neural activity and cortical blood flow', 'hemodynamic coupling in cortex'));
  }
  many.push(rec('S41', 'Piezoelectric transducer pitch', 'aperture and bandwidth design'));
  many.push(rec('S42', 'Neonatal bedside clinical monitoring', 'infant patient outcomes'));

  const { slices } = sliceCorpus(many, 4, { sharedCount: 0 });
  const sizes = slices.map(s => s.sourceIds.length);
  const total = sizes.reduce((a, b) => a + b, 0);

  // The cap is a balancing target during assignment, not an invariant: collapsing an
  // undersized slice must place its sources somewhere, and that can push a bucket over.
  // The property that matters is that no slice absorbs the corpus and none is unusable.
  assert.ok(Math.max(...sizes) / total < 0.6, `one slice absorbed the corpus: ${sizes}`);
  for (const n of sizes) assert.ok(n >= 2, `slice of ${n} is too small to interrogate: ${sizes}`);
});

// Forcing k slices onto a corpus that supports fewer manufactures the appearance of
// diversity rather than the substance.
test('a corpus that cannot support k perspectives returns fewer, not tiny ones', () => {
  const records = [
    rec('S1', 'cortical blood flow coupling', 'hemodynamic response in cortex'),
    rec('S2', 'cortical blood flow response', 'hemodynamic coupling in the cortex'),
    rec('S3', 'cortical hemodynamics', 'blood flow coupling measured in cortex'),
  ];
  const { slices } = sliceCorpus(records, 3, { sharedCount: 0 });
  assert.ok(slices.length < 3, `expected fewer than 3 slices, got ${slices.length}`);
  for (const s of slices) assert.ok(s.sourceIds.length >= 2);
});

test('slice indexes stay contiguous after collapsing', () => {
  const many = [];
  for (let i = 1; i <= 20; i++) many.push(rec(`S${i}`, 'same topic', 'identical body'));
  many.push(rec('S21', 'utterly unrelated transducer pitch', 'aperture bandwidth'));
  const { slices } = sliceCorpus(many, 5, { sharedCount: 0 });
  slices.forEach((s, i) => assert.strictEqual(s.index, i));
});

test('the balance factor is configurable', () => {
  const many = [];
  for (let i = 1; i <= 20; i++) many.push(rec(`S${i}`, 'same topic here', 'identical body text'));
  const { slices } = sliceCorpus(many, 4, { sharedCount: 0, balance: 1 });
  for (const s of slices) assert.ok(s.sourceIds.length <= 5);
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

// A quarter of one real corpus had neither abstract nor full text. Those records cannot be
// read by a perspective and can never support a claim, so handing them out silently starves
// the agent that receives them.
test('sources with no text are withheld from slices and reported', () => {
  const readable = [
    rec('S1', 'cortical blood flow', 'hemodynamic coupling in cortex'),
    rec('S2', 'cortical hemodynamics', 'blood flow coupling measured'),
    rec('S3', 'transducer pitch design', 'aperture and bandwidth geometry'),
    rec('S4', 'transducer array bandwidth', 'element pitch and aperture'),
  ];
  const blank = [rec('S5', 'A title with no abstract', ''), rec('S6', 'Another textless record', '')];

  const { slices, unreadable } = sliceCorpus([...readable, ...blank], 2, { sharedCount: 0 });
  assert.deepStrictEqual(unreadable.sort(), ['S5', 'S6']);
  const assigned = slices.flatMap(s => s.sourceIds);
  assert.ok(!assigned.includes('S5'));
  assert.ok(!assigned.includes('S6'));
  assert.strictEqual(assigned.length, 4, 'every readable source is still assigned');
});

test('hasText treats stored full text as readable even with no abstract', () => {
  assert.strictEqual(hasText(makeRecord({ id: 'S1', abstract: '' })), false);
  assert.strictEqual(hasText(makeRecord({ id: 'S2', abstract: '   ' })), false);
  assert.strictEqual(hasText(makeRecord({ id: 'S3', abstract: 'text' })), true);
  assert.strictEqual(hasText(makeRecord({ id: 'S4', abstract: '', fulltext_path: 'fulltext/S4.txt' })), true);
});

test('a corpus of entirely textless sources yields no slices rather than empty ones', () => {
  const { slices, unreadable } = sliceCorpus([rec('S1', 'no text', ''), rec('S2', 'also none', '')], 2);
  assert.deepStrictEqual(slices, []);
  assert.strictEqual(unreadable.length, 2);
});
