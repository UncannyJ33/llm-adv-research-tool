'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isParatext, contentTokens, relevanceScore, screen } = require('../lib/relevance');
const { makeRecord } = require('../lib/corpus');

const rec = f => makeRecord(f);

// Six of 93 entries in the first real run were figures, tables, supplements or a
// "References" section listed as though they were papers.
test('rejects figure, table and supplement entries by title', () => {
  for (const t of [
    'Figure 3: Performance for each model on encoding language identities',
    'Table 3: Results of encoding language identities from each model',
    'Supplemental Information 4: Interaction network rich-club.',
    'References',
    'Appendix B',
  ]) {
    assert.strictEqual(isParatext(rec({ title: t })), true, t);
  }
});

test('rejects paratext work types regardless of title', () => {
  for (const wt of ['figure', 'table', 'supplementary-materials', 'paratext', 'erratum', 'editorial']) {
    assert.strictEqual(isParatext(rec({ title: 'A perfectly normal title', work_type: wt })), true, wt);
  }
});

test('rejects an untitled record — it cannot be read or judged', () => {
  assert.strictEqual(isParatext(rec({ title: '' })), true);
  assert.strictEqual(isParatext(rec({ title: '   ' })), true);
});

test('keeps a real article whose title merely contains the word table', () => {
  assert.strictEqual(
    isParatext(rec({ title: 'Round table consensus on connectome nomenclature', work_type: 'article' })),
    false
  );
});

test('contentTokens drops stopwords and short tokens', () => {
  const t = contentTokens('The global workspace theory of the brain');
  assert.ok(t.includes('global'));
  assert.ok(t.includes('workspace'));
  assert.ok(!t.includes('the'));
  assert.ok(!t.includes('of'));
});

test('relevanceScore rewards multi-token overlap over single-token coincidence', () => {
  const q = 'global workspace theory neuronal broadcast cortical hub connectivity';
  const onTopic = rec({
    title: 'Global Workspace Dynamics: Cortical Binding and Propagation',
    abstract: 'A global workspace is a functional hub of binding and propagation.',
  });
  const coincidence = rec({
    title: 'Precise measurement of CMB polarisation: the BRAIN and CLOVER experiments',
    abstract: 'We describe a bolometric interferometer for cosmic microwave background polarisation.',
  });
  assert.ok(relevanceScore(onTopic, q) > relevanceScore(coincidence, q));
});

// The concrete failures from the first real run.
test('screen removes the astrophysics BRAIN instrument and the Metro Manila road network', () => {
  const q = 'global workspace theory neuronal broadcast cortical hub connectivity';
  const records = [
    rec({ id: 'S1', title: 'Global Workspace Dynamics: Cortical Binding and Propagation Enables Conscious Contents', abstract: 'A global workspace is a functional hub of binding and propagation in loosely coupled signaling elements.' }),
    rec({ id: 'S2', title: 'Rich-Club Organization of the Human Connectome', abstract: 'Highly connected hub regions of the brain network form a rich club.' }),
    rec({ id: 'S3', title: 'Precise measurement of CMB polarisation from Dome-C: the BRAIN and CLOVER experiments', abstract: 'Bolometric interferometry for cosmic microwave background polarisation from Antarctica.' }),
    rec({ id: 'S4', title: 'Hub Identification of the Metro Manila Road Network Using PageRank', abstract: 'We rank road intersections in a transport network by PageRank centrality.' }),
    rec({ id: 'S5', title: 'Figure 9: Layer-wise performance for each model' }),
  ];
  const { kept, filtered } = screen(records, q);
  const keptIds = kept.map(r => r.id);
  assert.ok(keptIds.includes('S1'));
  assert.ok(keptIds.includes('S2'));
  assert.ok(!keptIds.includes('S3'), 'astrophysics BRAIN must be filtered');
  assert.ok(!keptIds.includes('S4'), 'road network hub must be filtered');
  assert.ok(!keptIds.includes('S5'), 'figure caption must be filtered');
  assert.strictEqual(filtered.length, 3);
});

test('every filtered record carries a machine-readable reason', () => {
  const q = 'global workspace theory cortical hub';
  const { filtered } = screen([
    rec({ id: 'S1', title: 'Figure 2: something' }),
    rec({ id: 'S2', title: 'Quantum field theory variational approach', abstract: 'Gaussian approximation in QFT.' }),
  ], q);
  for (const f of filtered) {
    assert.ok(f.exclusion_reason, `${f.id} filtered with no reason`);
    assert.strictEqual(f.admissible, false);
  }
  assert.match(filtered.find(f => f.id === 'S1').exclusion_reason, /paratext|figure/i);
  assert.match(filtered.find(f => f.id === 'S2').exclusion_reason, /relevance/i);
});

// The road-network paper passed the two-concept rule on "hub" + "network" alone. Shape
// words are shared by every field that studies networks and cannot establish topicality.
test('generic structural vocabulary alone does not qualify a source', () => {
  const q = 'rich club connectome hub architecture brain network';
  const manila = rec({
    id: 'S1',
    title: 'Hub Identification of the Metro Manila Road Network Using PageRank',
    abstract: 'We identify node hubs of a road network using PageRank centrality.',
  });
  const { kept, filtered } = screen([manila], q);
  assert.strictEqual(kept.length, 0);
  assert.match(filtered[0].exclusion_reason, /generic structural vocabulary/i);
  assert.match(filtered[0].exclusion_reason, /hub|network/);
});

// Over-correcting here filtered out a real source, so both directions are pinned.
test('connectivity and connectome count as subject terms, not generic ones', () => {
  const q = 'global workspace theory neuronal broadcast cortical hub connectivity';
  const richClub = rec({
    id: 'S1',
    title: 'Rich-Club Organization of the Human Connectome',
    abstract: 'Highly connected hub regions of the brain network form a rich club.',
  });
  const { kept } = screen([richClub], q);
  assert.strictEqual(kept.length, 1, 'connectome must bridge to a connectivity query');
});

// Fail-open: a thin corpus is worse than a slightly noisy one.
test('screen keeps everything when the query has too few content tokens to judge', () => {
  const records = [rec({ id: 'S1', title: 'Anything at all here', abstract: 'text' })];
  const { kept } = screen(records, 'a of the');
  assert.strictEqual(kept.length, 1);
});

test('screen never filters a record the caller pinned as protected', () => {
  const q = 'global workspace cortical hub connectivity';
  const anthropic = rec({ id: 'S9', title: 'A global workspace in Claude', abstract: 'J-space patterns.', kind: 'web' });
  const { kept } = screen([anthropic], q, { protect: ['S9'] });
  assert.strictEqual(kept.length, 1);
});

test('a hand-ingested web source is protected by default', () => {
  const q = 'completely unrelated query tokens entirely';
  const web = rec({ id: 'S1', kind: 'web', title: 'Something a human deliberately added', abstract: 'body' });
  const { kept } = screen([web], q);
  assert.strictEqual(kept.length, 1, 'a human chose this source; do not second-guess it');
});
