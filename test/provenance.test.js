'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { orgOf, concentration, detectSingleSource } = require('../lib/provenance');
const { makeRecord } = require('../lib/corpus');

const rec = (f) => makeRecord(f);

test('orgOf reads a web source from its hostname', () => {
  assert.strictEqual(orgOf(rec({ kind: 'web', url: 'https://www.anthropic.com/research/x' })), 'anthropic.com');
  assert.strictEqual(orgOf(rec({ kind: 'web', url: 'https://deepmind.google/research/y' })), 'deepmind.google');
});

test('orgOf falls back to the first author cluster for academic sources', () => {
  assert.strictEqual(orgOf(rec({ authors: ['Olaf Sporns', 'Martijn van den Heuvel'] })), 'author:sporns o');
});

// Provenance inherits the author-key normalisation, so a lab publishing under both retrieval
// name formats is no longer counted as two separate origins.
test('orgOf is insensitive to retrieval name format', () => {
  assert.strictEqual(
    orgOf(rec({ authors: ['Hibbett D'] })),
    orgOf(rec({ authors: ['David S. Hibbett'] }))
  );
});

test('orgOf returns null when there is nothing to attribute', () => {
  assert.strictEqual(orgOf(rec({ authors: [] })), null);
});

test('concentration reports the dominant origin and its share', () => {
  const c = concentration([
    rec({ kind: 'web', url: 'https://www.anthropic.com/a' }),
    rec({ kind: 'web', url: 'https://www.anthropic.com/b' }),
    rec({ kind: 'web', url: 'https://www.anthropic.com/c' }),
    rec({ authors: ['Someone Else'] }),
  ]);
  assert.strictEqual(c.dominant, 'anthropic.com');
  assert.strictEqual(c.share, 0.75);
  assert.strictEqual(c.total, 4);
});

test('concentration on an empty set does not throw', () => {
  const c = concentration([]);
  assert.strictEqual(c.dominant, null);
  assert.strictEqual(c.share, 0);
});

// The evidence trap: searching a vendor-coined term returns only the vendor, and the
// resulting sparsity READS as "under-studied" when it may be "differently named".
test('a term whose sources are dominated by one origin is flagged single-source', () => {
  const sources = [
    rec({ id: 'S1', kind: 'web', url: 'https://www.anthropic.com/research/global-workspace', title: 'J-space in Claude' }),
    rec({ id: 'S2', kind: 'web', url: 'https://www.anthropic.com/research/other', title: 'More on the J-space' }),
    rec({ id: 'S3', kind: 'web', url: 'https://www.anthropic.com/research/third', title: 'J-space follow-up' }),
  ];
  const out = detectSingleSource('J-space', sources);
  assert.strictEqual(out.singleSource, true);
  assert.strictEqual(out.dominant, 'anthropic.com');
  assert.match(out.reason, /anthropic\.com/);
  assert.match(out.reason, /J-space/);
});

test('a term covered by many independent origins is not flagged', () => {
  const sources = [
    rec({ id: 'S1', authors: ['Bernard Baars'] }),
    rec({ id: 'S2', authors: ['Stanislas Dehaene'] }),
    rec({ id: 'S3', authors: ['Olaf Sporns'] }),
    rec({ id: 'S4', authors: ['Giulio Tononi'] }),
  ];
  assert.strictEqual(detectSingleSource('global workspace', sources).singleSource, false);
});

test('a term absent from the corpus is inconclusive, not single-source', () => {
  const out = detectSingleSource('never mentioned anywhere', [rec({ id: 'S1', authors: ['A'], title: 'Something else' })]);
  assert.strictEqual(out.singleSource, false);
  assert.strictEqual(out.inconclusive, true);
  assert.strictEqual(out.matching, 0);
  assert.match(out.reason, /no source/i);
});

// The paradigm case. Requiring a minimum count inverted the signal: ONE source from one
// origin is more concentrated than three, not less — and it is exactly the vendor-coined
// term the stage exists to catch.
test('a term carried by a single origin fires even on one source', () => {
  const sources = [
    rec({ id: 'S1', kind: 'web', url: 'https://www.anthropic.com/a', title: 'The J-space explained' }),
    rec({ id: 'S2', authors: ['Bernard Baars'], title: 'Global workspace dynamics', abstract: 'No mention here.' }),
    rec({ id: 'S3', authors: ['Olaf Sporns'], title: 'Rich club', abstract: 'Nor here.' }),
  ];
  const out = detectSingleSource('J-space', sources);
  assert.strictEqual(out.matching, 1, 'only one source mentions the term');
  assert.strictEqual(out.singleSource, true);
  assert.strictEqual(out.dominant, 'anthropic.com');
  assert.strictEqual(out.lowSample, true, 'flagged as single-source but on a thin sample');
});

test('a few sources across several origins stays inconclusive', () => {
  const sources = [
    rec({ id: 'S1', authors: ['Alpha One'], title: 'On widgets' }),
    rec({ id: 'S2', authors: ['Beta Two'], title: 'More widgets' }),
  ];
  const out = detectSingleSource('widgets', sources);
  assert.strictEqual(out.singleSource, false);
  assert.strictEqual(out.inconclusive, true);
  assert.strictEqual(out.origins, 2);
});

test('term matching is case-insensitive and tolerates hyphen or space', () => {
  const sources = [
    rec({ id: 'S1', kind: 'web', url: 'https://www.anthropic.com/a', title: 'The J space' }),
    rec({ id: 'S2', kind: 'web', url: 'https://www.anthropic.com/b', abstract: 'discussing j-space patterns' }),
    rec({ id: 'S3', kind: 'web', url: 'https://www.anthropic.com/c', title: 'J-SPACE revisited' }),
  ];
  assert.strictEqual(detectSingleSource('J-space', sources).matching, 3);
});
