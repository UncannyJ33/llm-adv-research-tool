'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { analyze, normalizeAuthor } = require('../lib/independence');
const { makeRecord } = require('../lib/corpus');

const r = (id, authors, extra = {}) => makeRecord({ id, authors, ...extra });

test('normalizeAuthor is case- and punctuation-insensitive', () => {
  assert.strictEqual(normalizeAuthor('Tanter, M.'), normalizeAuthor('tanter m'));
});

test('fully disjoint author sets are independent', () => {
  const out = analyze([r('S1', ['A One']), r('S2', ['B Two']), r('S3', ['C Three'])]);
  assert.strictEqual(out.cited_count, 3);
  assert.strictEqual(out.independent_count, 3);
});

test('THE headline case: four works sharing authors collapse to one', () => {
  const out = analyze([
    r('S1', ['Mickael Tanter', 'Alpha']),
    r('S2', ['Mickael Tanter', 'Beta']),
    r('S3', ['Beta', 'Gamma']),
    r('S4', ['Gamma', 'Delta']),
  ]);
  assert.strictEqual(out.cited_count, 4);
  assert.strictEqual(out.independent_count, 1, 'transitive author overlap chains them together');
  assert.match(out.reason, /share/i);
});

test('shared cohort merges works with no shared authors', () => {
  const out = analyze([
    r('S1', ['A'], { cohort_id: 'UKB-2019' }),
    r('S2', ['B'], { cohort_id: 'UKB-2019' }),
  ]);
  assert.strictEqual(out.independent_count, 1);
  assert.match(out.reason, /cohort|dataset/i);
});

test('two clusters report as two independent sources', () => {
  const out = analyze([
    r('S1', ['A', 'B']), r('S2', ['B', 'C']),
    r('S3', ['X', 'Y']), r('S4', ['Y', 'Z']),
  ]);
  assert.strictEqual(out.independent_count, 2);
  assert.strictEqual(out.groups.length, 2);
});

test('groups list the member ids so the ledger can show the collapse', () => {
  const out = analyze([r('S1', ['A']), r('S2', ['A'])]);
  assert.deepStrictEqual(out.groups[0].sort(), ['S1', 'S2']);
});

test('records with no authors are treated as independent, not merged together', () => {
  const out = analyze([r('S1', []), r('S2', [])]);
  assert.strictEqual(out.independent_count, 2, 'absent authorship is not evidence of shared authorship');
});

test('a single citation is trivially one independent source', () => {
  const out = analyze([r('S1', ['A'])]);
  assert.strictEqual(out.independent_count, 1);
  assert.match(out.reason, /single/i);
});

test('an empty set reports zero without throwing', () => {
  const out = analyze([]);
  assert.strictEqual(out.cited_count, 0);
  assert.strictEqual(out.independent_count, 0);
});

test('fully independent sources say so explicitly in the reason', () => {
  const out = analyze([r('S1', ['A']), r('S2', ['B'])]);
  assert.match(out.reason, /independent/i);
});
