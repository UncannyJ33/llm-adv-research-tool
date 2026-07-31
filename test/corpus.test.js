'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Corpus, makeRecord } = require('../lib/corpus');

function tmpRun() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-'));
}

test('assigns sequential S-prefixed ids', () => {
  const c = new Corpus(tmpRun());
  assert.strictEqual(c.add(makeRecord({ title: 'A' })), 'S1');
  assert.strictEqual(c.add(makeRecord({ title: 'B' })), 'S2');
});

test('makeRecord fills the spec §9 shape with safe defaults', () => {
  const r = makeRecord({ title: 'X', doi: '10.1/x' });
  assert.strictEqual(r.kind, 'academic');
  assert.strictEqual(r.retracted, false);
  assert.strictEqual(r.admissible, true);
  assert.strictEqual(r.tier, null);
  assert.deepStrictEqual(r.used_by, []);
  assert.deepStrictEqual(r.dedupe_merged_ids, []);
  assert.strictEqual(r.citation_health.assessed, false);
});

test('round-trips through JSONL', () => {
  const dir = tmpRun();
  const c = new Corpus(dir);
  c.add(makeRecord({ title: 'Round trip', doi: '10.1/rt' }));
  c.save();
  const c2 = Corpus.load(dir);
  assert.strictEqual(c2.all().length, 1);
  assert.strictEqual(c2.all()[0].title, 'Round trip');
  assert.strictEqual(c2.add(makeRecord({ title: 'next' })), 'S2', 'id counter survives reload');
});

test('load on a missing corpus returns an empty corpus rather than throwing', () => {
  const c = Corpus.load(tmpRun());
  assert.deepStrictEqual(c.all(), []);
  assert.strictEqual(c.add(makeRecord({ title: 'first' })), 'S1');
});

test('stores full text and reports evidence basis', () => {
  const dir = tmpRun();
  const c = new Corpus(dir);
  const id = c.add(makeRecord({ title: 'T', abstract: 'the abstract' }));
  assert.deepStrictEqual(c.getText(id), { text: 'the abstract', basis: 'abstract_only' });
  c.putFulltext(id, 'the full body text');
  assert.deepStrictEqual(c.getText(id), { text: 'the full body text', basis: 'fulltext' });
});

test('getText on an unknown id throws rather than returning empty', () => {
  const c = new Corpus(tmpRun());
  assert.throws(() => c.getText('S99'), /unknown source/i);
});

test('putFulltext on an unknown id throws', () => {
  const c = new Corpus(tmpRun());
  assert.throws(() => c.putFulltext('S99', 'x'), /unknown source/i);
});
