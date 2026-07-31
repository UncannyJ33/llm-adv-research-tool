'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { canonicalKey, normalizeTitle, titleSimilarity, dedupe } = require('../lib/dedupe');
const { makeRecord } = require('../lib/corpus');

const rec = f => makeRecord({ id: f.id || 'S1', ...f });

test('canonical key prefers DOI, then PMID, then arXiv id, then title+year', () => {
  assert.strictEqual(canonicalKey(rec({ doi: '10.1/X', pmid: '99' })), 'doi:10.1/x');
  assert.strictEqual(canonicalKey(rec({ pmid: '99', arxiv_id: '2401.1' })), 'pmid:99');
  assert.strictEqual(canonicalKey(rec({ arxiv_id: '2401.01234v3' })), 'arxiv:2401.01234');
  assert.strictEqual(canonicalKey(rec({ title: 'A Study!', year: 2020 })), 'title:a study|2020');
});

test('DOI keys are case-insensitive and url-stripped', () => {
  assert.strictEqual(
    canonicalKey(rec({ doi: 'https://doi.org/10.1/ABC' })),
    canonicalKey(rec({ doi: '10.1/abc' }))
  );
});

test('normalizeTitle strips punctuation and collapses space', () => {
  assert.strictEqual(normalizeTitle('  The  "Big" Study: Part-One!  '), 'the big study partone');
});

test('titleSimilarity is 1 for identical and low for unrelated', () => {
  assert.strictEqual(titleSimilarity('deep brain imaging', 'deep brain imaging'), 1);
  assert.ok(titleSimilarity('deep brain imaging', 'fungal network growth') < 0.2);
});

test('merges exact-key duplicates and records provenance', () => {
  const out = dedupe([
    rec({ id: 'S1', doi: '10.1/x', title: 'A', retrieved_from: ['openalex'] }),
    rec({ id: 'S2', doi: '10.1/X', title: 'A', retrieved_from: ['crossref'] }),
  ]);
  assert.strictEqual(out.kept.length, 1);
  assert.deepStrictEqual(out.kept[0].dedupe_merged_ids, ['S2']);
  assert.deepStrictEqual(out.kept[0].retrieved_from.sort(), ['crossref', 'openalex']);
});

test('the survivor keeps the richest metadata, not merely the first seen', () => {
  const out = dedupe([
    rec({ id: 'S1', doi: '10.1/x', title: 'A', abstract: '' }),
    rec({ id: 'S2', doi: '10.1/x', title: 'A', abstract: 'full abstract', oa_pdf_url: 'u' }),
  ]);
  assert.strictEqual(out.kept[0].abstract, 'full abstract');
  assert.strictEqual(out.kept[0].oa_pdf_url, 'u');
});

test('near-duplicate titles in the same year merge', () => {
  const out = dedupe([
    rec({ id: 'S1', title: 'Functional ultrasound imaging of the brain', year: 2019 }),
    rec({ id: 'S2', title: 'Functional ultrasound imaging of the brain.', year: 2019 }),
  ]);
  assert.strictEqual(out.kept.length, 1);
});

test('same title in different years does NOT merge', () => {
  const out = dedupe([
    rec({ id: 'S1', title: 'Annual Review of Imaging', year: 2019 }),
    rec({ id: 'S2', title: 'Annual Review of Imaging', year: 2023 }),
  ]);
  assert.strictEqual(out.kept.length, 2);
});

test('a retraction discovered on any duplicate propagates to the survivor', () => {
  const out = dedupe([
    rec({ id: 'S1', doi: '10.1/x', abstract: 'rich abstract here' }),
    rec({ id: 'S2', doi: '10.1/x', retracted: true, retraction_notice_doi: '10.1/r' }),
  ]);
  assert.strictEqual(out.kept[0].retracted, true, 'a retraction must never be lost in a merge');
  assert.strictEqual(out.kept[0].retraction_notice_doi, '10.1/r');
});

test('distinct works are all kept', () => {
  const out = dedupe([
    rec({ id: 'S1', doi: '10.1/a', title: 'A' }),
    rec({ id: 'S2', doi: '10.1/b', title: 'B' }),
  ]);
  assert.strictEqual(out.kept.length, 2);
  assert.strictEqual(out.merged.length, 0);
});
