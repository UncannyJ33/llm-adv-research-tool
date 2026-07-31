'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerClaim, verifyClaim, finalize } = require('../lib/pipeline');
const { Corpus, makeRecord } = require('../lib/corpus');
const { Ledger } = require('../lib/ledger');
const { RunState } = require('../lib/state');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
const ABSTRACT = 'Results\nResolution reached 100 um in the rodent cortex across all trials.\n\nLimitations\nWe cannot rule out motion artifacts in awake animals during the session.';

function fixture() {
  const dir = tmp();
  const state = RunState.create(dir, { question: 'q', mode: 'orient', domain: 'biomedical', date: '2026-07-30' });
  const corpus = new Corpus(state.runDir);
  corpus.add(makeRecord({ title: 'Paper', authors: ['A One'], abstract: ABSTRACT, tier: 'primary' }));
  return { state, corpus, ledger: new Ledger(state.runDir) };
}

test('a real span with a result role is supported', () => {
  const { corpus, ledger } = fixture();
  const id = registerClaim(ledger, { text: 'Resolution reached 100 um in rodents.', cited_source_ids: ['S1'] });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this resolution directly in its results.',
  });
  assert.strictEqual(r.effective_verdict, 'supported');
  assert.strictEqual(r.span_check, 'pass');
});

// The agent does not get to assert the span matched.
test('a fabricated span is unsupported even when the verifier says supported', () => {
  const { corpus, ledger } = fixture();
  const id = registerClaim(ledger, { text: 'Resolution reached 1 um in human infants.', cited_source_ids: ['S1'] });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 1 um in human infants across every cortical layer',
    role: 'result', reason: 'The source states this in its results section clearly.',
  });
  assert.strictEqual(r.effective_verdict, 'unsupported');
  assert.strictEqual(r.span_check, 'fail_not_found');
});

test('a limitations span declared as limitation is overridden', () => {
  const { corpus, ledger } = fixture();
  const id = registerClaim(ledger, { text: 'Motion artifacts occur in awake animals.', cited_source_ids: ['S1'] });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'We cannot rule out motion artifacts in awake animals during the session',
    role: 'limitation', reason: 'The source raises this in its limitations section.',
  });
  assert.strictEqual(r.effective_verdict, 'unsupported');
  assert.match(r.override_reason, /limitations section/i);
});

// A verifier quoting a limitations sentence verbatim and labelling it `result` would
// otherwise land a claim that CONTRADICTS the source, with every mechanical check green.
test('a mis-declared role is overridden by the detected section, not merely warned about', () => {
  const { corpus, ledger } = fixture();
  const id = registerClaim(ledger, { text: 'Motion artifacts occur.', cited_source_ids: ['S1'] });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'We cannot rule out motion artifacts in awake animals during the session',
    role: 'result', reason: 'The source reports this as an observed outcome of the study.',
  });
  assert.strictEqual(r.effective_verdict, 'unsupported', 'the claim must not survive');
  assert.strictEqual(r.declared_role, 'result');
  assert.strictEqual(r.span_role, 'limitation', 'the detected section wins');
  assert.strictEqual(r.detected_section, 'limitation');
  assert.match(r.override_reason, /overridden/i);
  assert.ok(r.role_warning);
});

// Detection may only ever WEAKEN a claim. A false "Results" heading match must never
// upgrade a span the verifier honestly called a limitation.
test('detection never upgrades an honestly-declared hard-fail role', () => {
  const { corpus, ledger } = fixture();
  const doc = 'Results\nWe cannot rule out confounding in this cohort of twelve subjects.';
  corpus.add(makeRecord({ title: 'Odd layout', abstract: doc, tier: 'primary' }));
  const id = registerClaim(ledger, { text: 'Confounding was ruled out.', cited_source_ids: ['S2'] });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S2', verdict: 'supported',
    span: 'We cannot rule out confounding in this cohort of twelve subjects',
    role: 'limitation', reason: 'The source hedges this explicitly rather than reporting it.',
  });
  assert.strictEqual(r.span_role, 'limitation', 'the stricter declared role must survive');
  assert.strictEqual(r.effective_verdict, 'unsupported');
});

// Without the `caveat` role, the hard-fail on `limitation` kills true claims whose entire
// content IS the source's own hedge — often the most important claim in a brief.
test('a claim that restates a caveat AS a caveat survives', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, {
    text: 'The authors state they cannot rule out motion artifacts in awake animals.',
    cited_source_ids: ['S1'],
  });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'We cannot rule out motion artifacts in awake animals during the session',
    role: 'caveat',
    reason: 'The claim reports the source limitation as a limitation, matching the text exactly.',
  });
  assert.strictEqual(r.effective_verdict, 'supported');
  assert.strictEqual(r.span_role, 'caveat', 'caveat must not be overridden to limitation');
  assert.strictEqual(r.role_warning, null, 'caveat is compatible with a limitations section');
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'kept');
});

// The inversion must still die — `caveat` may not become a bypass for affirmative claims.
test('the same span declared as result is still rejected', () => {
  const { corpus, ledger } = fixture();
  const id = registerClaim(ledger, { text: 'Motion artifacts occur.', cited_source_ids: ['S1'] });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'We cannot rule out motion artifacts in awake animals during the session',
    role: 'result', reason: 'The source reports this as an observed outcome of the study.',
  });
  assert.strictEqual(r.effective_verdict, 'unsupported');
});

test('a non-hard-fail detection mismatch warns without overriding', () => {
  const { corpus, ledger } = fixture();
  const doc = 'Methods\nWe imaged twelve rats using a linear array probe at nine megahertz.';
  corpus.add(makeRecord({ title: 'Methods paper', abstract: doc, tier: 'primary' }));
  const id = registerClaim(ledger, { text: 'Twelve rats were imaged.', cited_source_ids: ['S2'] });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S2', verdict: 'supported',
    span: 'We imaged twelve rats using a linear array probe at nine megahertz',
    role: 'result', reason: 'The source states the cohort size in its text.',
  });
  assert.strictEqual(r.effective_verdict, 'supported', 'method is not a hard-fail role');
  assert.ok(r.role_warning, 'but the mismatch is still surfaced');
});

test('an unknown source id throws rather than verifying against nothing', () => {
  const { corpus, ledger } = fixture();
  const id = registerClaim(ledger, { text: 'x', cited_source_ids: ['S9'] });
  assert.throws(() => verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S9', verdict: 'supported',
    span: 'anything at all here long enough to pass the length floor', role: 'result', reason: 'x',
  }), /unknown source/i);
});

test('finalize sets dispositions and counts from verification outcomes', () => {
  const { corpus, ledger, state } = fixture();
  const good = registerClaim(ledger, { text: 'Good claim.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: good, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this directly in its results.',
  });
  const bad = registerClaim(ledger, { text: 'Bad claim.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: bad, sourceId: 'S1', verdict: 'supported',
    span: 'a span that does not appear anywhere in this particular source text',
    role: 'result', reason: 'The source states it plainly in the results section.',
  });

  const counts = finalize({ corpus, ledger, state });
  assert.strictEqual(counts.claims_kept, 1);
  assert.strictEqual(counts.claims_dropped, 1);
  assert.strictEqual(ledger.get(good).disposition, 'kept');
  assert.strictEqual(ledger.get(bad).disposition, 'dropped');
});

test('an unverified claim is dropped, never silently kept', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Never checked.', cited_source_ids: ['S1'] });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'dropped');
});

test('finalize marks a claim verified only against a weak-tier source as weakened', () => {
  const { corpus, ledger, state } = fixture();
  corpus.add(makeRecord({ title: 'Blog', abstract: ABSTRACT, tier: 'weak', kind: 'web' }));
  const id = registerClaim(ledger, { text: 'Weak-sourced claim.', cited_source_ids: ['S2'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S2', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The page states this directly in its results.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).confidence, 'weakened');
});

test('finalize records independence on multi-source claims', () => {
  const { corpus, ledger, state } = fixture();
  corpus.add(makeRecord({ title: 'Second', authors: ['A One'], abstract: ABSTRACT, tier: 'primary' }));
  const id = registerClaim(ledger, { text: 'Two sources, one author.', cited_source_ids: ['S1', 'S2'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this in its results section.',
  });
  finalize({ corpus, ledger, state });
  const c = ledger.get(id);
  assert.strictEqual(c.independent_corroboration.independent_count, 1);
  assert.strictEqual(c.independent_corroboration.cited_count, 2);
});

test('a claim with one supported and one unsupported verdict is contested, not silently kept', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Disputed claim.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this in its results section.',
  });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'a span that is definitely not present in this source document',
    role: 'result', reason: 'A second verifier could not locate supporting text.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'contested');
});

// "Contested" must mean verifiers disagree — not that a source refuted the claim outright.
// Otherwise a flatly-wrong claim gets promoted into the brief's contested section.
test('a single contradicted verdict drops the claim rather than marking it contested', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'The study proved the opposite.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'contradicted',
    span: 'We cannot rule out motion artifacts in awake animals during the session',
    role: 'limitation', reason: 'The source states the opposite of what the claim asserts.',
  });
  const counts = finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'dropped');
  assert.strictEqual(counts.contested, 0);
});

test('contested requires genuine disagreement between verifiers', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Resolution reached 100 um.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this directly in its results section.',
  });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'contradicted',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'A second verifier read the source as reporting a different figure.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'contested');
});

test('a partially-supported verdict alone does not count as support', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Overreaching claim.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'partially-supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source supports a narrower version of what the claim asserts.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'dropped');
});

// Without used_by, a 93-source bibliography gives no signal that four sources carried the
// whole argument — the opposite of the curation the tool exists to provide.
test('finalize marks sources cited by surviving claims as used', () => {
  const { corpus, ledger, state } = fixture();
  corpus.add(makeRecord({ title: 'Unused', abstract: ABSTRACT, tier: 'primary' }));
  const id = registerClaim(ledger, { text: 'Used claim.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this directly in its results section.',
  });
  const counts = finalize({ corpus, ledger, state });
  assert.deepStrictEqual(corpus.get('S1').used_by, [id]);
  assert.deepStrictEqual(corpus.get('S2').used_by, []);
  assert.strictEqual(counts.sources_cited, 1);
});

test('a dropped claim does not mark its source as used', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Dropped claim.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'a span that appears nowhere in this particular source text at all',
    role: 'result', reason: 'The source states it plainly in its results section.',
  });
  finalize({ corpus, ledger, state });
  assert.deepStrictEqual(corpus.get('S1').used_by, []);
});

test('used_by is recomputed, not accumulated, across repeated finalize calls', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Used claim.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this directly in its results section.',
  });
  finalize({ corpus, ledger, state });
  finalize({ corpus, ledger, state });
  assert.deepStrictEqual(corpus.get('S1').used_by, [id], 'no duplicate entries');
});

test('ledger exposes dropped, weakened and contested separately', () => {
  const { corpus, ledger, state } = fixture();
  const kept = registerClaim(ledger, { text: 'Kept.', cited_source_ids: ['S1'] });
  verifyClaim({
    corpus, ledger, claimId: kept, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this directly in its results section.',
  });
  registerClaim(ledger, { text: 'Never verified.', cited_source_ids: ['S1'] });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.kept().length, 1);
  assert.strictEqual(ledger.dropped().length, 1);
  assert.strictEqual(ledger.weakened().length, 0);
  assert.strictEqual(ledger.surviving().length, 1);
});

test('finalize flags a claim supported only by review articles', () => {
  const { corpus, ledger, state } = fixture();
  corpus.add(makeRecord({ title: 'A review', abstract: ABSTRACT, tier: 'primary', work_type: 'review' }));
  const id = registerClaim(ledger, { text: 'Review sourced.', cited_source_ids: ['S2'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S2', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The review states this directly in its summary of results.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).secondary_only, true);
  assert.match(ledger.get(id).secondary_reason, /review/i);
});

test('a claim with any primary support is not flagged secondary-only', () => {
  const { corpus, ledger, state } = fixture();
  corpus.add(makeRecord({ title: 'A review', abstract: ABSTRACT, tier: 'primary', work_type: 'review' }));
  const id = registerClaim(ledger, { text: 'Mixed support.', cited_source_ids: ['S1', 'S2'] });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Resolution reached 100 um in the rodent cortex across all trials',
    role: 'result', reason: 'The source reports this directly in its results section.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).secondary_only, false);
  assert.strictEqual(ledger.get(id).secondary_reason, null);
});

// --- escalation panel (deep mode) -----------------------------------------

const SPAN = 'Resolution reached 100 um in the rodent cortex across all trials';
const REASON = 'The source reports this directly in its results section.';

function verifySupported(corpus, ledger, id, n = 1) {
  for (let i = 0; i < n; i++) {
    verifyClaim({
      corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
      span: SPAN, role: 'result', reason: `Verifier ${i + 1}: ${REASON}`,
    });
  }
}

// Keeping a load-bearing claim at single-verifier confidence while the report implies a
// panel reviewed it is worse than dropping it — the reader cannot tell the difference.
test('deep mode drops a load-bearing claim that did not get its full panel', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Load bearing.', cited_source_ids: ['S1'], load_bearing: true });
  verifySupported(corpus, ledger, id, 1);
  const counts = finalize({ corpus, ledger, state, mode: 'deep' });
  assert.strictEqual(ledger.get(id).disposition, 'dropped');
  assert.strictEqual(ledger.get(id).under_verified, true);
  assert.strictEqual(counts.under_verified, 1);
  assert.match(ledger.get(id).disposition_reason, /panel/i);
});

test('orient mode keeps the same claim on a single verifier', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Load bearing.', cited_source_ids: ['S1'], load_bearing: true });
  verifySupported(corpus, ledger, id, 1);
  finalize({ corpus, ledger, state, mode: 'orient' });
  assert.strictEqual(ledger.get(id).disposition, 'kept');
});

test('deep mode keeps a load-bearing claim with a unanimous panel', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Load bearing.', cited_source_ids: ['S1'], load_bearing: true });
  verifySupported(corpus, ledger, id, 3);
  finalize({ corpus, ledger, state, mode: 'deep' });
  assert.strictEqual(ledger.get(id).disposition, 'kept');
  assert.strictEqual(ledger.get(id).under_verified, false);
});

test('a split panel is contested, never silently resolved', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Load bearing.', cited_source_ids: ['S1'], load_bearing: true });
  verifySupported(corpus, ledger, id, 2);
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'unsupported',
    span: 'a span that is absent from this source document entirely',
    role: 'result', reason: 'A third verifier could not locate supporting text in the source.',
  });
  finalize({ corpus, ledger, state, mode: 'deep' });
  assert.strictEqual(ledger.get(id).disposition, 'contested');
});

// Counting a lone `supported` among hedged verdicts as verified would make a panel WEAKER
// than a single verifier — the majority's reservations would vanish from the output.
test('a panel majority of partial support holds the claim below verified', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Hedged.', cited_source_ids: ['S1'], load_bearing: true });
  verifySupported(corpus, ledger, id, 1);
  for (let i = 0; i < 2; i++) {
    verifyClaim({
      corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'partially-supported',
      span: SPAN, role: 'result', reason: `Verifier ${i}: the source supports a narrower version of this.`,
    });
  }
  finalize({ corpus, ledger, state, mode: 'deep' });
  assert.strictEqual(ledger.get(id).disposition, 'weakened');
  assert.match(ledger.get(id).disposition_reason, /majority did not fully support/i);
});

test('a panel majority of full support keeps the claim', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Solid.', cited_source_ids: ['S1'], load_bearing: true });
  verifySupported(corpus, ledger, id, 2);
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'partially-supported',
    span: SPAN, role: 'result', reason: 'One verifier reads the support as narrower than stated.',
  });
  finalize({ corpus, ledger, state, mode: 'deep' });
  assert.strictEqual(ledger.get(id).disposition, 'kept');
});

test('a single verifier is unaffected by the majority rule', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Single.', cited_source_ids: ['S1'] });
  verifySupported(corpus, ledger, id, 1);
  finalize({ corpus, ledger, state, mode: 'orient' });
  assert.strictEqual(ledger.get(id).disposition, 'kept');
});

test('deep mode does not demand a panel for ordinary claims', () => {
  const { corpus, ledger, state } = fixture();
  const id = registerClaim(ledger, { text: 'Ordinary.', cited_source_ids: ['S1'] });
  verifySupported(corpus, ledger, id, 1);
  finalize({ corpus, ledger, state, mode: 'deep' });
  assert.strictEqual(ledger.get(id).disposition, 'kept');
});

test('mode falls back to the run state when not passed', () => {
  const { corpus, ledger, state } = fixture();
  state.data.mode = 'deep';
  const id = registerClaim(ledger, { text: 'Load bearing.', cited_source_ids: ['S1'], load_bearing: true });
  verifySupported(corpus, ledger, id, 1);
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'dropped');
});

test('finalize persists counts to run state', () => {
  const { corpus, ledger, state } = fixture();
  registerClaim(ledger, { text: 'Unverified.', cited_source_ids: ['S1'] });
  finalize({ corpus, ledger, state });
  assert.strictEqual(state.data.counts.claims_drafted, 1);
});
