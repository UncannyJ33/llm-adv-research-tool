'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { noteSimilarity, findCollapsed, DEFAULT_OVERLAP } = require('../lib/overlap');

const A = 'Neurovascular coupling links neural activity to local blood flow changes in cortex.';
const A2 = 'Neurovascular coupling links neural activity to blood flow changes in the cortex.';
const B = 'Piezoelectric transducer arrays are designed around element pitch and aperture.';

test('identical notes are fully similar', () => {
  assert.strictEqual(noteSimilarity(A, A), 1);
});

test('near-identical notes score high', () => {
  assert.ok(noteSimilarity(A, A2) > 0.6, `got ${noteSimilarity(A, A2)}`);
});

test('unrelated notes score low', () => {
  assert.ok(noteSimilarity(A, B) < 0.15, `got ${noteSimilarity(A, B)}`);
});

test('empty notes do not throw', () => {
  assert.strictEqual(noteSimilarity('', A), 0);
  assert.strictEqual(noteSimilarity('', ''), 1);
});

// Two perspectives that read different sources can still write the same notes, which makes a
// run LOOK multi-perspective while being single-perspective repeated.
test('findCollapsed flags a pair above threshold', () => {
  const pairs = findCollapsed([
    { id: 'p1', text: A }, { id: 'p2', text: A2 }, { id: 'p3', text: B },
  ]);
  assert.strictEqual(pairs.length, 1);
  assert.deepStrictEqual([pairs[0].a, pairs[0].b].sort(), ['p1', 'p2']);
});

test('each pair is reported once, not in both directions', () => {
  assert.strictEqual(findCollapsed([{ id: 'p1', text: A }, { id: 'p2', text: A }]).length, 1);
});

test('divergent perspectives produce no pairs', () => {
  assert.deepStrictEqual(findCollapsed([{ id: 'p1', text: A }, { id: 'p2', text: B }]), []);
});

test('fewer than two notes yields no pairs', () => {
  assert.deepStrictEqual(findCollapsed([{ id: 'p1', text: A }]), []);
  assert.deepStrictEqual(findCollapsed([]), []);
});

test('pairs are sorted worst-first so the orchestrator re-runs the worst offender', () => {
  const pairs = findCollapsed(
    [{ id: 'p1', text: A }, { id: 'p2', text: A }, { id: 'p3', text: A2 }],
    { threshold: 0.1 }
  );
  assert.ok(pairs.length >= 2);
  assert.ok(pairs[0].score >= pairs[1].score);
});

test('the threshold is configurable', () => {
  assert.strictEqual(
    findCollapsed([{ id: 'p1', text: A }, { id: 'p2', text: B }], { threshold: 0 }).length, 1
  );
  assert.ok(DEFAULT_OVERLAP > 0 && DEFAULT_OVERLAP < 1);
});
