'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseFeed, normalize } = require('../lib/retrieve/arxiv');

const XML = fs.readFileSync(path.join(__dirname, 'fixtures/arxiv-feed.xml'), 'utf8');

test('parses every entry in the feed', () => {
  assert.strictEqual(parseFeed(XML).length, 2);
});

test('collapses whitespace inside multi-line titles', () => {
  assert.strictEqual(parseFeed(XML)[0].title, 'Attention Is All You Need Again');
});

test('extracts all authors, not just the first', () => {
  assert.deepStrictEqual(parseFeed(XML)[0].authors, ['Ada Lovelace', 'Alan Turing']);
});

test('strips the version suffix from the arxiv id', () => {
  assert.strictEqual(normalize(parseFeed(XML)[0]).arxiv_id, '2401.01234');
});

test('arxiv records are preprints and never indexed', () => {
  const r = normalize(parseFeed(XML)[0]);
  assert.strictEqual(r.is_preprint, true);
  assert.strictEqual(r.work_type, 'preprint');
  assert.strictEqual(r.venue.is_indexed, false);
});

test('captures the pdf link and published year', () => {
  const r = normalize(parseFeed(XML)[0]);
  assert.strictEqual(r.oa_pdf_url, 'http://arxiv.org/pdf/2401.01234v2');
  assert.strictEqual(r.year, 2024);
});

test('picks up a cross-listed DOI when arXiv carries one', () => {
  assert.strictEqual(normalize(parseFeed(XML)[0]).doi, '10.1000/xyz');
  assert.strictEqual(normalize(parseFeed(XML)[1]).doi, null);
});

test('an empty or malformed feed yields no entries rather than throwing', () => {
  assert.deepStrictEqual(parseFeed(''), []);
  assert.deepStrictEqual(parseFeed('<feed></feed>'), []);
  assert.deepStrictEqual(parseFeed(null), []);
});

test('the abstract survives into the record for the quote gate to check', () => {
  assert.strictEqual(
    normalize(parseFeed(XML)[0]).abstract,
    'We revisit the transformer architecture.'
  );
});
