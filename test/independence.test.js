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

// Europe PMC returns "Hibbett D"; Crossref and OpenAlex return "David S. Hibbett". Treating
// those as different authors made one person count as two independent origins — a silent
// false negative in the check that exists to catch one source wearing several coats.
test('the two retrieval name formats reduce to the same author key', () => {
  const { authorKey } = require('../lib/independence');
  assert.strictEqual(authorKey('Hibbett D'), authorKey('David S. Hibbett'));
  assert.strictEqual(authorKey('Sporns O'), authorKey('Olaf Sporns'));
  assert.strictEqual(authorKey('van den Heuvel MP'), authorKey('Martijn P. van den Heuvel'));
  assert.strictEqual(authorKey('Tanter M'), authorKey('Mickael Tanter'));
});

test('genuine short surnames are not mistaken for trailing initials', () => {
  const { authorKey } = require('../lib/independence');
  assert.strictEqual(authorKey('Wei Wu'), 'wu w');
  assert.strictEqual(authorKey('Wu W'), 'wu w');
  assert.notStrictEqual(authorKey('Wei Wu'), authorKey('Wei Li'));
});

test('different authors with the same surname stay distinct by initial', () => {
  const { authorKey } = require('../lib/independence');
  assert.notStrictEqual(authorKey('Smith A'), authorKey('Smith B'));
});

// The case the red team found in a real run.
test('mixed-format author names collapse two sources to one origin', () => {
  const out = analyze([
    makeRecord({ id: 'S96', authors: ['Hibbett D', 'Other A'] }),
    makeRecord({ id: 'S145', authors: ['David S. Hibbett', 'Someone Else'] }),
  ]);
  assert.strictEqual(out.independent_count, 1, 'same author in two formats must not read as independent');
  assert.match(out.reason, /share/i);
});
