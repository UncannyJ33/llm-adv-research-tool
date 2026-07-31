'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderHtml, escapeHtml } = require('../lib/render');
const { Corpus, makeRecord } = require('../lib/corpus');
const { Ledger, makeClaim } = require('../lib/ledger');
const { RunState } = require('../lib/state');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));

function fixture(opts = {}) {
  const dir = tmp();
  const state = RunState.create(dir, {
    question: 'functional ultrasound imaging', mode: 'deep',
    domain: 'biomedical', date: '2026-07-30',
    retrievalSets: ['europepmc', 'openalex'],
  });
  const corpus = new Corpus(state.runDir);
  corpus.add(makeRecord({
    title: 'Primary journal work', authors: ['A One'], year: 2019,
    venue: { name: 'Nature Methods', type: 'journal', is_indexed: true },
    doi: '10.1/a', tier: 'primary', tier_basis: 'peer-reviewed-indexed',
  }));
  corpus.add(makeRecord({
    title: 'A community blog', url: 'https://blog.example/x', kind: 'web',
    tier: 'weak', tier_basis: 'gray-literature',
  }));
  const ledger = new Ledger(state.runDir);
  const kept = ledger.add(makeClaim({ text: 'A verified claim.', cited_source_ids: ['S1'] }));
  ledger.setDisposition(kept, 'kept', { confidence: 'verified' });
  if (opts.withRejection !== false) {
    const dropped = ledger.add(makeClaim({ text: 'An overreaching claim.', cited_source_ids: ['S1'] }));
    ledger.recordVerification(dropped, {
      verdict: 'unsupported',
      reason: 'The cited source reports resolution in rodent cortex; the claim asserts human infants, which the source does not address.',
      quoted_span: null, span_check: 'no_span_offered', span_role: null,
      evidence_basis: 'abstract_only',
    });
    ledger.setDisposition(dropped, 'dropped');
  }
  return { state, corpus, ledger, dir: state.runDir };
}

test('escapeHtml neutralizes markup so source titles cannot inject', () => {
  assert.strictEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(escapeHtml('A & B "q"'), 'A &amp; B &quot;q&quot;');
});

test('renders a self-contained document with no external requests', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/<script\s+src=/i.test(html), 'no external scripts');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), 'no external stylesheets');
  assert.ok(!/https?:\/\/(?!blog\.example)/.test(html.replace(/<a [^>]*href="[^"]*"/g, '')), 'no remote asset loads');
});

test('groups the bibliography by tier', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger });
  assert.ok(html.includes('Primary'));
  assert.ok(html.includes('Primary journal work'));
  assert.ok(html.includes('A community blog'));
  assert.ok(html.includes('peer-reviewed-indexed'), 'tier basis is shown so a mis-route is visible');
});

test('renders the rejection ledger with its reason, not just a verdict label', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger });
  assert.ok(html.includes('An overreaching claim.'));
  assert.ok(html.includes('which the source does not address'));
});

test('a run with nothing rejected says so explicitly rather than hiding the section', () => {
  const { state, corpus, ledger } = fixture({ withRejection: false });
  const html = renderHtml({ state, corpus, ledger });
  assert.match(html, /nothing was dropped, weakened or contested/i);
  assert.match(html, /verifier is asleep/i);
});

// Positional numbering aligned with S-ids only while nothing was ever excluded; one
// retracted source dropped at seed would repoint every citation at the wrong paper.
test('the bibliography is keyed on stable source ids, not list position', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger });
  assert.ok(html.includes('<span class="sid">S1</span>'));
  assert.ok(!/<ol class="bib">/.test(html), 'no positional numbering in the bibliography');
});

test('cited and uncited sources are separated so curation is visible', () => {
  const { state, corpus, ledger } = fixture();
  corpus.get('S1').used_by = ['C1'];
  const html = renderHtml({ state, corpus, ledger });
  assert.match(html, /Cited <span class="count">1<\/span>/);
  assert.match(html, /Retrieved but not cited <span class="count">1<\/span>/);
  assert.ok(html.includes('cited by C1'));
});

// A weakened claim SURVIVES into the brief. Listing it under "Rejected" made kept work
// look discarded.
test('dropped and weakened claims render under separate headings', () => {
  const { state, corpus, ledger } = fixture();
  const w = ledger.add(makeClaim({ text: 'A weakened claim.', cited_source_ids: ['S2'] }));
  ledger.setDisposition(w, 'weakened', { final_text: 'A weakened claim.' });
  const html = renderHtml({ state, corpus, ledger });
  assert.match(html, /Dropped &mdash; absent from the brief/);
  assert.match(html, /Weakened &mdash; present in the brief/);
});

// Spec §12 — a degraded run must announce its degradation.
test('a degraded run renders a prominent notice', () => {
  const { state, corpus, ledger } = fixture();
  state.addDegradation('api_error', 'europepmc: 503', 'biomedical coverage reduced');
  const html = renderHtml({ state, corpus, ledger });
  assert.match(html, /degraded/i);
  assert.ok(html.includes('europepmc: 503'));
});

test('a clean run renders no degradation notice', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger });
  assert.ok(!/class="degraded"/.test(html));
});

// "Degraded" (something failed) and "incomplete" (a stage never ran) are different claims
// about a run and must not be conflated.
test('stages that never ran are named, separately from degradation', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger });
  assert.match(html, /class="incomplete"/);
  assert.match(html, /Stages that did not run/);
  assert.match(html, /verification/);
  assert.match(html, /redteam/);
});

test('a fully complete run renders no incomplete notice', () => {
  const { state, corpus, ledger } = fixture();
  for (const s of ['seed', 'perspectives', 'interrogation', 'outline', 'synthesis', 'verification', 'redteam', 'assemble']) {
    state.setStage(s, 'complete');
  }
  const html = renderHtml({ state, corpus, ledger });
  assert.ok(!/class="incomplete"/.test(html));
});

test('discloses the routed domain and authority table', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger });
  assert.ok(html.includes('biomedical'));
});

test('renders without a brief, so the deterministic core is usable before the agent layer', () => {
  const { state, corpus, ledger } = fixture();
  assert.doesNotThrow(() => renderHtml({ state, corpus, ledger, brief: null }));
});

test('renders a brief when one is supplied', () => {
  const { state, corpus, ledger } = fixture();
  const html = renderHtml({ state, corpus, ledger, brief: '## Overview\n\nSome synthesized text.' });
  assert.ok(html.includes('Some synthesized text.'));
});
