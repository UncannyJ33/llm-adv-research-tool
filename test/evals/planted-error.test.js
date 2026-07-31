'use strict';
// The test that proves the verification layer has teeth. Direct lesson from the bridge evals
// harness shipping as a false-green factory on its first cut: a gate nobody adversarially
// tested is indistinguishable from no gate at all.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerClaim, verifyClaim, finalize } = require('../../lib/pipeline');
const { Corpus, makeRecord } = require('../../lib/corpus');
const { Ledger } = require('../../lib/ledger');
const { RunState } = require('../../lib/state');

const SOURCE = `Results
Functional ultrasound achieved 100 um resolution in the anesthetized rat cortex.

Limitations
We did not evaluate awake animals or human subjects in this study.

Related Work
Deffieux et al. reported successful imaging through the neonatal fontanelle.`;

function bench() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
  const state = RunState.create(dir, {
    question: 'q', mode: 'orient', domain: 'biomedical', date: '2026-07-30',
  });
  const corpus = new Corpus(state.runDir);
  corpus.add(makeRecord({ title: 'Paper', authors: ['A'], abstract: SOURCE, tier: 'primary' }));
  return { state, corpus, ledger: new Ledger(state.runDir) };
}

// Each planted error is a real failure mode, paired with the span a careless verifier picks.
const PLANTED = [
  {
    name: 'limitation inverted into a finding',
    claim: 'The study evaluated awake animals.',
    span: 'We did not evaluate awake animals or human subjects in this study',
    role: 'limitation',
    caughtBy: 'code',
  },
  {
    name: 'related-work attributed to this paper',
    claim: 'This study imaged through the neonatal fontanelle.',
    span: 'Deffieux et al. reported successful imaging through the neonatal fontanelle',
    role: 'related-work',
    caughtBy: 'code',
  },
  {
    name: 'outright fabrication',
    claim: 'fUS resolves single neurons.',
    span: 'Functional ultrasound resolves individual neurons at cellular resolution',
    role: 'result',
    caughtBy: 'code',
  },
];

for (const p of PLANTED) {
  test(`planted error caught (${p.caughtBy}): ${p.name}`, () => {
    const { corpus, ledger, state } = bench();
    const id = registerClaim(ledger, { text: p.claim, cited_source_ids: ['S1'] });
    verifyClaim({
      corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
      span: p.span, role: p.role,
      reason: 'The source appears to state this in the text.',
    });
    finalize({ corpus, ledger, state });
    assert.notStrictEqual(
      ledger.get(id).disposition, 'kept',
      `"${p.name}" survived verification — the gate is not working`
    );
  });
}

// The honest boundary of what mechanism can do. The span is genuine and the role is honest,
// so span_check passes and no override fires. This is caught ONLY by verifier judgment.
// If it regresses, the fix is the agent definition, not lib/.
test('scope transfer (rat -> human) is NOT caught by code — it rests on verifier judgment', () => {
  const { corpus, ledger, state } = bench();
  const id = registerClaim(ledger, {
    text: 'fUS achieves 100 um resolution in human subjects.', cited_source_ids: ['S1'],
  });
  const r = verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Functional ultrasound achieved 100 um resolution in the anesthetized rat cortex',
    role: 'result', reason: 'The source reports this resolution figure.',
  });
  assert.strictEqual(r.span_check, 'pass');
  assert.strictEqual(r.effective_verdict, 'supported');
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'kept',
    'documents the known limit: a truthful span for a wrong population passes the code gate');
});

test('the same scope transfer IS caught when the verifier does its job', () => {
  const { corpus, ledger, state } = bench();
  const id = registerClaim(ledger, {
    text: 'fUS achieves 100 um resolution in human subjects.', cited_source_ids: ['S1'],
  });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'unsupported',
    span: 'Functional ultrasound achieved 100 um resolution in the anesthetized rat cortex',
    role: 'result',
    reason: 'The source reports 100 um in anesthetized rat cortex; the claim asserts human subjects, which the source explicitly did not evaluate.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'dropped');
});

test('the ledger is non-empty after planted errors — silence would mean no gate ran', () => {
  const { corpus, ledger, state } = bench();
  for (const p of PLANTED) {
    const id = registerClaim(ledger, { text: p.claim, cited_source_ids: ['S1'] });
    verifyClaim({
      corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
      span: p.span, role: p.role, reason: 'The source appears to state this.',
    });
  }
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.rejected().length, PLANTED.length);
});

// A gate that rejects everything is as useless as one that rejects nothing.
test('a legitimate claim still survives — the gate is not just rejecting everything', () => {
  const { corpus, ledger, state } = bench();
  const id = registerClaim(ledger, {
    text: 'fUS achieved 100 um resolution in anesthetized rat cortex.', cited_source_ids: ['S1'],
  });
  verifyClaim({
    corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
    span: 'Functional ultrasound achieved 100 um resolution in the anesthetized rat cortex',
    role: 'result', reason: 'The source reports exactly this in its results section.',
  });
  finalize({ corpus, ledger, state });
  assert.strictEqual(ledger.get(id).disposition, 'kept');
});

test('every rejection carries a reason a human can act on', () => {
  const { corpus, ledger, state } = bench();
  for (const p of PLANTED) {
    const id = registerClaim(ledger, { text: p.claim, cited_source_ids: ['S1'] });
    verifyClaim({
      corpus, ledger, claimId: id, sourceId: 'S1', verdict: 'supported',
      span: p.span, role: p.role, reason: 'The source appears to state this.',
    });
  }
  finalize({ corpus, ledger, state });
  for (const c of ledger.rejected()) {
    const last = c.verification[c.verification.length - 1];
    assert.ok(last.reason || last.override_reason, `${c.claim_id} rejected with no reason`);
  }
});
