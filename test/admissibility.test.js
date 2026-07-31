'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { matchesRule, assignTier, admit } = require('../lib/admissibility');
const { makeRecord } = require('../lib/corpus');

const journal = () => makeRecord({
  id: 'S1', kind: 'academic', work_type: 'article', is_preprint: false,
  venue: { name: 'Nature Methods', type: 'journal', is_indexed: true },
});
const preprint = () => makeRecord({
  id: 'S2', kind: 'academic', work_type: 'preprint', is_preprint: true,
  venue: { name: 'arXiv', type: 'repository', is_indexed: false },
});
const spec = () => makeRecord({ id: 'S3', kind: 'web', work_type: 'page', source_class: 'spec' });
const blogPost = () => makeRecord({ id: 'S4', kind: 'web', work_type: 'page', source_class: 'community' });

test('empty match object is a catch-all', () => {
  assert.strictEqual(matchesRule(journal(), {}), true);
});

test('array constraints mean "is one of"', () => {
  assert.strictEqual(matchesRule(journal(), { workType: ['article', 'review'] }), true);
  assert.strictEqual(matchesRule(journal(), { workType: ['review'] }), false);
});

test('scalar constraints mean equality', () => {
  assert.strictEqual(matchesRule(journal(), { kind: 'academic' }), true);
  assert.strictEqual(matchesRule(journal(), { kind: 'web' }), false);
});

test('minCitations is a threshold, not equality', () => {
  const cited = makeRecord({ ...preprint(), citation_count: 30 });
  assert.strictEqual(matchesRule(cited, { minCitations: 25 }), true);
  assert.strictEqual(matchesRule(preprint(), { minCitations: 25 }), false);
});

test('an unknown rule field throws rather than silently matching', () => {
  assert.throws(() => matchesRule(journal(), { bogusField: 'x' }), /unknown tier-rule field/i);
});

test('THE regression test: a language spec is PRIMARY in software, WEAK in biomedical', () => {
  assert.strictEqual(assignTier(spec(), 'software').tier, 'primary');
  assert.strictEqual(assignTier(spec(), 'biomedical').tier, 'weak');
});

test('and the mirror: an indexed journal is primary in biomedical, secondary in software', () => {
  assert.strictEqual(assignTier(journal(), 'biomedical').tier, 'primary');
  assert.strictEqual(assignTier(journal(), 'software').tier, 'secondary');
});

test('a preprint with traction is primary in physical_cs but not biomedical', () => {
  const cited = makeRecord({ ...preprint(), citation_count: 100 });
  assert.strictEqual(assignTier(cited, 'physical_cs').tier, 'primary');
  assert.strictEqual(assignTier(cited, 'biomedical').tier, 'secondary');
});

test('tier_basis explains WHY, so a mis-route is visible', () => {
  assert.strictEqual(assignTier(spec(), 'software').tier_basis, 'official-source');
  assert.strictEqual(assignTier(journal(), 'biomedical').tier_basis, 'peer-reviewed-indexed');
});

test('a government statistical release is primary in economics_policy', () => {
  const gov = makeRecord({ id: 'S5', kind: 'web', work_type: 'page', source_class: 'gov-statistical' });
  assert.strictEqual(assignTier(gov, 'economics_policy').tier, 'primary');
});

// A health agency, regulator or trial registry IS a primary biomedical source. Before this
// rule existed every non-journal source fell to the catch-all and could never verify a
// claim — the domain-relative failure reintroduced one level down.
test('agency and registry sources are primary in biomedical, not gray literature', () => {
  const cdc = makeRecord({ id: 'S6', kind: 'web', work_type: 'page', source_class: 'gov-statistical' });
  const trial = makeRecord({ id: 'S7', kind: 'web', work_type: 'page', source_class: 'primary-document' });
  assert.strictEqual(assignTier(cdc, 'biomedical').tier, 'primary');
  assert.strictEqual(assignTier(cdc, 'biomedical').tier_basis, 'agency-or-registry');
  assert.strictEqual(assignTier(trial, 'biomedical').tier, 'primary');
});

test('agency and standards sources are primary in physical_cs', () => {
  const nist = makeRecord({ id: 'S8', kind: 'web', work_type: 'page', source_class: 'gov-statistical' });
  const rfc = makeRecord({ id: 'S9', kind: 'web', work_type: 'page', source_class: 'rfc' });
  assert.strictEqual(assignTier(nist, 'physical_cs').tier, 'primary');
  assert.strictEqual(assignTier(rfc, 'physical_cs').tier, 'primary');
});

test('national archives are primary in history_humanities', () => {
  const archive = makeRecord({ id: 'S10', kind: 'web', work_type: 'page', source_class: 'gov-statistical' });
  assert.strictEqual(assignTier(archive, 'history_humanities').tier, 'primary');
});

test('a real CDC url routes to gov-statistical and therefore to primary in biomedical', () => {
  const { classifyWebSource } = require('../lib/domains');
  const cls = classifyWebSource('https://www.cdc.gov/nchs/data/databriefs/db456.pdf');
  assert.strictEqual(cls, 'gov-statistical');
  const rec = makeRecord({ id: 'S11', kind: 'web', work_type: 'page', source_class: cls });
  assert.strictEqual(assignTier(rec, 'biomedical').tier, 'primary');
});

test('community blog is weak in every domain', () => {
  for (const d of ['software', 'biomedical', 'economics_policy', 'current_events']) {
    assert.strictEqual(assignTier(blogPost(), d).tier, 'weak', d);
  }
});

test('retracted sources are excluded outright but retained with a reason', () => {
  const pulled = makeRecord({ id: 'S9', retracted: true, retraction_notice_doi: '10.1/r' });
  const { admitted, excluded } = admit([journal(), pulled], 'biomedical');
  assert.strictEqual(admitted.length, 1);
  assert.strictEqual(excluded.length, 1);
  assert.strictEqual(excluded[0].admissible, false);
  assert.match(excluded[0].exclusion_reason, /retracted/i);
  assert.match(excluded[0].exclusion_reason, /10\.1\/r/);
});

test('a retraction with no notice DOI still excludes, with a plain reason', () => {
  const pulled = makeRecord({ id: 'S9', retracted: true });
  const { excluded } = admit([pulled], 'biomedical');
  assert.match(excluded[0].exclusion_reason, /retracted|withdrawn/i);
});

test('admit stamps tier onto every admitted record', () => {
  const { admitted } = admit([journal()], 'biomedical');
  assert.strictEqual(admitted[0].tier, 'primary');
  assert.strictEqual(admitted[0].tier_basis, 'peer-reviewed-indexed');
  assert.strictEqual(admitted[0].admissible, true);
});
