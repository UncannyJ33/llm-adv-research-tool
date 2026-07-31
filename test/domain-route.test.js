'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { route, routeUnion } = require('../lib/domain-route');

test('routes a known domain to its retrieval set', () => {
  const r = route('biomedical', { confidence: 'high' });
  assert.strictEqual(r.domain, 'biomedical');
  assert.strictEqual(r.authorityTable, 'biomedical');
  assert.ok(r.retrievalSets.includes('europepmc'));
  assert.strictEqual(r.ambiguous, false);
});

test('ambiguous routing takes the union of candidate retrieval sets', () => {
  const r = routeUnion(['software', 'physical_cs']);
  assert.strictEqual(r.ambiguous, true);
  assert.ok(r.retrievalSets.includes('web'));
  assert.ok(r.retrievalSets.includes('arxiv'));
  assert.ok(r.retrievalSets.includes('openalex'));
  assert.deepStrictEqual([...r.retrievalSets], [...new Set(r.retrievalSets)], 'no duplicates');
});

test('union preserves both candidate domains for disclosure', () => {
  const r = routeUnion(['software', 'physical_cs']);
  assert.deepStrictEqual(r.candidateDomains, ['software', 'physical_cs']);
});

test('rejects an unknown domain loudly', () => {
  assert.throws(() => route('astrology'), /unknown domain/i);
});

test('routeUnion of a single domain is not ambiguous', () => {
  const r = routeUnion(['software']);
  assert.strictEqual(r.ambiguous, false);
  assert.strictEqual(r.domain, 'software');
});

test('routeUnion with no domains throws', () => {
  assert.throws(() => routeUnion([]), /at least one domain/i);
});
