'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fixture = require('./fixtures/europepmc-result.json');
const { normalize } = require('../lib/retrieve/europepmc');

test('normalizes Europe PMC fields', () => {
  const r = normalize(fixture);
  assert.strictEqual(r.pmid, '31740820');
  assert.strictEqual(r.doi, '10.1038/s41592-019-0611-8');
  assert.strictEqual(r.year, 2019);
  assert.strictEqual(r.citation_count, 412);
  assert.strictEqual(r.venue.name, 'Nature Methods');
  assert.deepStrictEqual(r.retrieved_from, ['europepmc']);
});

test('splits the flat author string', () => {
  assert.deepStrictEqual(normalize(fixture).authors, ['Tanter M', 'Fink M']);
});

test('MED source counts as indexed; PPR (preprint) does not', () => {
  assert.strictEqual(normalize(fixture).venue.is_indexed, true);
  const pre = normalize({ ...fixture, source: 'PPR', pubType: 'preprint' });
  assert.strictEqual(pre.is_preprint, true);
  assert.strictEqual(pre.venue.is_indexed, false);
});

test('captures the open-access pdf url', () => {
  assert.strictEqual(normalize(fixture).oa_pdf_url, 'https://example.org/oa/fus.pdf');
});

test('detects review articles, which are secondary sources', () => {
  assert.strictEqual(normalize({ ...fixture, pubType: 'review' }).work_type, 'review');
});

test('survives a sparse record', () => {
  const r = normalize({ id: '1' });
  assert.deepStrictEqual(r.authors, []);
  assert.strictEqual(r.abstract, '');
  assert.strictEqual(r.oa_pdf_url, null);
});
