'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toMarkdown, linkTopics, hasBacktickedLink, exportRun } = require('../lib/export');
const { Corpus, makeRecord } = require('../lib/corpus');
const { Ledger, makeClaim } = require('../lib/ledger');
const { RunState } = require('../lib/state');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));

function fixture() {
  const dir = tmp();
  const state = RunState.create(dir, {
    question: 'functional ultrasound imaging', mode: 'deep',
    domain: 'biomedical', date: '2026-07-30',
  });
  const corpus = new Corpus(state.runDir);
  corpus.add(makeRecord({
    title: 'Primary work', authors: ['A One'], year: 2019, doi: '10.1/a',
    venue: { name: 'Nature Methods', type: 'journal', is_indexed: true },
    tier: 'primary', tier_basis: 'peer-reviewed-indexed',
  }));
  const ledger = new Ledger(state.runDir);
  const id = ledger.add(makeClaim({ text: 'A claim.' }));
  ledger.setDisposition(id, 'kept', { confidence: 'verified' });
  return { state, corpus, ledger };
}

test('emits frontmatter marking the note as generated', () => {
  const { state, corpus, ledger } = fixture();
  const md = toMarkdown({ state, corpus, ledger, brief: '## Overview\n\nText.' });
  assert.match(md, /^---\n/);
  assert.match(md, /type: research-brief/);
  assert.match(md, /generated: true/);
  assert.match(md, /tags: \[research-brief, generated\]/);
  assert.match(md, /run_id: 2026-07-30-functional-ultrasound-imaging/);
});

test('includes source and contested counts in frontmatter', () => {
  const { state, corpus, ledger } = fixture();
  const md = toMarkdown({ state, corpus, ledger });
  assert.match(md, /source_count: 1/);
  assert.match(md, /contested_count: 0/);
});

test('renders a numbered bibliography', () => {
  const { state, corpus, ledger } = fixture();
  const md = toMarkdown({ state, corpus, ledger });
  assert.match(md, /## Bibliography/);
  assert.ok(md.includes('Primary work'));
  assert.ok(md.includes('https://doi.org/10.1/a'));
});

// Backticked [[links]] are INERT in Obsidian — a wikilink emitted inside a code span
// silently fails to link, orphaning the note it was meant to connect.
test('hasBacktickedLink detects a wikilink inside a code span', () => {
  assert.strictEqual(hasBacktickedLink('see `[[Some Note]]` here'), true);
  assert.strictEqual(hasBacktickedLink('see [[Some Note]] here'), false);
  assert.strictEqual(hasBacktickedLink('```\n[[Fenced Note]]\n```'), true);
});

test('linkTopics never emits a wikilink inside a code span', () => {
  const out = linkTopics('Use `Computational Biology` in code and Computational Biology in prose.',
    ['Computational Biology']);
  assert.strictEqual(hasBacktickedLink(out), false, 'a linked topic must never land inside backticks');
  assert.ok(out.includes('[[Computational Biology]]'), 'the prose mention should still link');
  assert.ok(out.includes('`Computational Biology`'), 'the code span stays untouched');
});

test('linkTopics links only the first mention of a topic', () => {
  const out = linkTopics('Mycelial networks are neat. Mycelial networks again.', ['Mycelial networks']);
  assert.strictEqual((out.match(/\[\[Mycelial networks\]\]/g) || []).length, 1);
});

test('linkTopics leaves an already-linked topic alone', () => {
  const out = linkTopics('See [[Mycelial networks]] here.', ['Mycelial networks']);
  assert.strictEqual((out.match(/\[\[/g) || []).length, 1);
});

test('exportRun writes to exports/ by default and never to a vault path', () => {
  const { state, corpus, ledger } = fixture();
  const root = tmp();
  const out = exportRun({ state, corpus, ledger, brief: '# X', exportsDir: path.join(root, 'exports') });
  assert.ok(fs.existsSync(out.file));
  assert.ok(out.file.includes('exports'));
  assert.ok(!/ObsidianVault/i.test(out.file), 'no hardcoded vault path anywhere');
});

test('exportRun refuses to overwrite without force, and versions instead', () => {
  const { state, corpus, ledger } = fixture();
  const dir = path.join(tmp(), 'exports');
  const a = exportRun({ state, corpus, ledger, exportsDir: dir });
  const b = exportRun({ state, corpus, ledger, exportsDir: dir });
  assert.notStrictEqual(a.file, b.file, 'second export must version rather than clobber');
  assert.match(path.basename(b.file), /-2\.md$/);
});

test('exportRun honors an explicit --to destination', () => {
  const { state, corpus, ledger } = fixture();
  const dest = path.join(tmp(), 'somewhere-else');
  const out = exportRun({ state, corpus, ledger, exportsDir: dest });
  assert.ok(out.file.startsWith(dest));
});

test('a degraded run carries the warning into the exported note', () => {
  const { state, corpus, ledger } = fixture();
  state.addDegradation('api_error', 'europepmc: 503', 'coverage reduced');
  const md = toMarkdown({ state, corpus, ledger });
  assert.match(md, /degraded/i);
  assert.ok(md.includes('europepmc: 503'));
});
