'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fixture = require('./fixtures/crossref-item.json');
const { normalize, isRetracted } = require('../lib/retrieve/crossref');

test('normalizes Crossref fields', () => {
  const r = normalize(fixture);
  assert.strictEqual(r.doi, '10.1038/s41592-019-0611-8');
  assert.strictEqual(r.title, 'Functional ultrasound imaging of the brain');
  assert.strictEqual(r.year, 2019);
  assert.deepStrictEqual(r.authors, ['Mickael Tanter', 'Mathias Fink']);
});

test('strips JATS markup from the abstract', () => {
  assert.strictEqual(
    normalize(fixture).abstract,
    'Functional ultrasound imaging resolves cerebral blood volume.'
  );
});

test('posted type is treated as a preprint', () => {
  assert.strictEqual(normalize({ ...fixture, type: 'posted-content' }).is_preprint, true);
});

test('isRetracted reads the update-to relation and returns the notice DOI', () => {
  assert.deepStrictEqual(isRetracted(fixture), { retracted: false, noticeDoi: null });
  const pulled = { ...fixture, 'update-to': [{ type: 'retraction', DOI: '10.1038/retract-1' }] };
  assert.deepStrictEqual(isRetracted(pulled), { retracted: true, noticeDoi: '10.1038/retract-1' });
});

test('a non-retraction update does not mark the work retracted', () => {
  const corrected = { ...fixture, 'update-to': [{ type: 'correction', DOI: '10.1038/corr-1' }] };
  assert.strictEqual(isRetracted(corrected).retracted, false);
});

test('normalize carries the retraction notice through to the record', () => {
  const pulled = { ...fixture, 'update-to': [{ type: 'retraction', DOI: '10.1038/retract-1' }] };
  const r = normalize(pulled);
  assert.strictEqual(r.retracted, true);
  assert.strictEqual(r.retraction_notice_doi, '10.1038/retract-1');
});
