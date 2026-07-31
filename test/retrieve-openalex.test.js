'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fixture = require('./fixtures/openalex-work.json');
const { normalize, invertAbstract, venueIsIndexed } = require('../lib/retrieve/openalex');

test('normalizes core bibliographic fields', () => {
  const r = normalize(fixture);
  assert.strictEqual(r.doi, '10.1523/jneurosci.3539-11.2011', 'DOI is bare, not a URL');
  assert.strictEqual(r.openalex_id, 'W2012559638');
  assert.strictEqual(r.pmid, '22049421');
  assert.strictEqual(r.year, 2011);
  assert.strictEqual(r.citation_count, 2495);
  assert.deepStrictEqual(r.authors, ['Martijn P. van den Heuvel', 'Olaf Sporns']);
});

test('captures venue indexing, which drives tiering', () => {
  const r = normalize(fixture);
  assert.strictEqual(r.venue.name, 'Journal of Neuroscience');
  assert.strictEqual(r.venue.is_indexed, true);
  assert.strictEqual(r.is_preprint, false);
});

test('reconstructs the abstract from the inverted index', () => {
  assert.strictEqual(
    invertAbstract(fixture.abstract_inverted_index),
    'Functional ultrasound imaging resolves'
  );
  assert.ok(normalize(fixture).abstract.startsWith('Functional ultrasound'));
});

test('invertAbstract handles a missing index', () => {
  assert.strictEqual(invertAbstract(null), '');
  assert.strictEqual(invertAbstract(undefined), '');
});

test('flags preprints from work type', () => {
  const r = normalize({ ...fixture, type: 'preprint' });
  assert.strictEqual(r.is_preprint, true);
  assert.strictEqual(r.work_type, 'preprint');
});

test('carries the retraction flag through', () => {
  assert.strictEqual(normalize({ ...fixture, is_retracted: true }).retracted, true);
});

test('prefers the open-access PDF url when present', () => {
  assert.strictEqual(
    normalize(fixture).oa_pdf_url,
    'https://www.jneurosci.org/content/jneuro/31/44/15775.full.pdf'
  );
});

test('survives a sparse record without throwing', () => {
  const r = normalize({ id: 'https://openalex.org/W1', title: null });
  assert.strictEqual(r.openalex_id, 'W1');
  assert.strictEqual(r.abstract, '');
  assert.deepStrictEqual(r.authors, []);
  assert.strictEqual(r.venue.is_indexed, false);
});

test('tags provenance so degraded-source runs stay auditable', () => {
  assert.deepStrictEqual(normalize(fixture).retrieved_from, ['openalex']);
});

// The fixture above is CAPTURED from the live OpenAlex API, not hand-written. The previous
// hand-written fixture contained `is_indexed_in_scopus`, a field OpenAlex does not return —
// so the test passed while the code read undefined and demoted every real journal.
test('the fixture reflects reality: OpenAlex returns no is_indexed_in_scopus field', () => {
  const src = fixture.primary_location.source;
  assert.ok(!('is_indexed_in_scopus' in src), 'fixture must match the real API shape');
  assert.ok(src.issn_l, 'real responses carry issn_l');
  assert.strictEqual(src.type, 'journal');
});

test('a real journal with an ISSN counts as indexed', () => {
  assert.strictEqual(normalize(fixture).venue.is_indexed, true, 'Journal of Neuroscience is indexed');
  assert.strictEqual(normalize(fixture).venue.name, 'Journal of Neuroscience');
});

test('is_core alone is enough even without an ISSN, given a resolved venue', () => {
  assert.strictEqual(venueIsIndexed({ type: 'journal', display_name: 'A Journal', is_core: true }), true);
});

test('a repository or preprint server is never indexed', () => {
  assert.strictEqual(venueIsIndexed({ type: 'repository', issn_l: null }), false);
  assert.strictEqual(venueIsIndexed({ type: 'preprint', is_core: true }), false);
});

test('a journal with neither ISSN nor core flag is not indexed', () => {
  assert.strictEqual(venueIsIndexed({ type: 'journal' }), false);
});

test('a missing source object does not throw', () => {
  assert.strictEqual(venueIsIndexed({}), false);
});

// An indexing flag with no resolved venue is not evidence of peer review. A platform record
// with a null display_name was tiered peer-reviewed-indexed, giving an unreviewed posting the
// same standing as a Nature journal.
test('a venue with no resolved name is not counted as indexed', () => {
  assert.strictEqual(venueIsIndexed({ type: 'journal', display_name: null, issn_l: '1234-5678' }), false);
  assert.strictEqual(venueIsIndexed({ type: 'journal', display_name: '   ', is_core: true }), false);
  assert.strictEqual(venueIsIndexed({ type: 'journal', display_name: 'Real Journal', issn_l: '1234-5678' }), true);
});

// Twelve chapters of one textbook are one engagement with a source, not twelve.
test('citing works collapse chapters of the same book to one entry', () => {
  const { collapseByContainer } = require('../lib/retrieve/openalex');
  const chapter = n => ({
    id: `https://openalex.org/W${n}`,
    primary_location: { source: { id: 'https://openalex.org/S999', display_name: 'A Textbook', type: 'book' } },
  });
  const paper = n => ({
    id: `https://openalex.org/P${n}`,
    primary_location: { source: { id: `https://openalex.org/J${n}`, display_name: 'A Journal', type: 'journal' } },
  });
  const { works } = collapseByContainer([chapter(1), chapter(2), chapter(3), paper(1), paper(2)]);
  assert.strictEqual(works.length, 3, 'three book chapters collapse to one, two papers stay');
});

test('journals are never collapsed — they legitimately carry many independent papers', () => {
  const { collapseByContainer } = require('../lib/retrieve/openalex');
  const sameJournal = n => ({
    id: `https://openalex.org/W${n}`,
    primary_location: { source: { id: 'https://openalex.org/J1', display_name: 'Nature', type: 'journal' } },
  });
  const { works } = collapseByContainer([sameJournal(1), sameJournal(2), sameJournal(3)]);
  assert.strictEqual(works.length, 3);
});
