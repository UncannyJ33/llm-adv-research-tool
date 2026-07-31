'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Ledger, makeClaim, SPAN_ROLES, HARD_FAIL_ROLES } = require('../lib/ledger');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));

test('assigns sequential C-prefixed claim ids', () => {
  const l = new Ledger(tmp());
  assert.strictEqual(l.add(makeClaim({ text: 'a' })), 'C1');
  assert.strictEqual(l.add(makeClaim({ text: 'b' })), 'C2');
});

test('span roles include every role in the spec enum', () => {
  for (const role of ['result', 'method', 'limitation', 'speculation', 'background', 'related-work', 'quoting-others']) {
    assert.ok(SPAN_ROLES.includes(role), `missing role ${role}`);
  }
});

test('limitation, speculation, related-work and quoting-others are hard-fail roles', () => {
  assert.deepStrictEqual(
    [...HARD_FAIL_ROLES].sort(),
    ['limitation', 'quoting-others', 'related-work', 'speculation']
  );
  assert.ok(!HARD_FAIL_ROLES.includes('result'));
});

test('a clean span pass with a result role is supported', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'x', cited_source_ids: ['S1'] }));
  const v = l.recordVerification(id, {
    verdict: 'supported', reason: 'Source states it directly.',
    quoted_span: 'a'.repeat(50), span_check: 'pass', span_role: 'result',
    evidence_basis: 'fulltext',
  });
  assert.strictEqual(v.effective_verdict, 'supported');
});

// THE case where every other check reports green.
test('a span from a related-work section is rejected DESPITE span_check pass', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'x', cited_source_ids: ['S1'] }));
  const v = l.recordVerification(id, {
    verdict: 'supported', reason: 'Text appears in the source.',
    quoted_span: 'a'.repeat(50), span_check: 'pass', span_role: 'related-work',
    evidence_basis: 'fulltext',
  });
  assert.strictEqual(v.effective_verdict, 'unsupported');
  assert.match(v.override_reason, /related-work/i);
  assert.match(v.override_reason, /another work/i);
});

test('a span from a limitations section cannot support an affirmative claim', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'X occurs' }));
  const v = l.recordVerification(id, {
    verdict: 'supported', reason: 'Present in source.',
    quoted_span: 'we cannot rule out that x occurs in some subjects at all'.padEnd(60, '.'),
    span_check: 'pass', span_role: 'limitation', evidence_basis: 'fulltext',
  });
  assert.strictEqual(v.effective_verdict, 'unsupported');
});

test('a failed span check is unsupported regardless of the verifier verdict', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'x' }));
  const v = l.recordVerification(id, {
    verdict: 'supported', reason: 'I am confident.',
    quoted_span: 'not in the source at all, fabricated justification',
    span_check: 'fail_not_found', span_role: 'result', evidence_basis: 'fulltext',
  });
  assert.strictEqual(v.effective_verdict, 'unsupported');
  assert.match(v.override_reason, /span/i);
});

test('a rejection reason that never references the source is flagged low quality', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'x' }));
  const v = l.recordVerification(id, {
    verdict: 'unsupported', reason: 'Nope.', quoted_span: null,
    span_check: 'no_span_offered', span_role: null, evidence_basis: 'abstract_only',
  });
  assert.strictEqual(v.reason_quality, 'low');
});

test('a specific source-grounded reason passes the quality check', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'x' }));
  const v = l.recordVerification(id, {
    verdict: 'unsupported',
    reason: 'The cited 2019 paper reports 100 um resolution in rodent cortex; the claim asserts human infants, which the source does not address.',
    quoted_span: null, span_check: 'no_span_offered', span_role: null, evidence_basis: 'abstract_only',
  });
  assert.strictEqual(v.reason_quality, 'ok');
});

test('dropped claims are retained, never deleted — nothing is deleted, only demoted', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'dropped one' }));
  l.setDisposition(id, 'dropped');
  assert.strictEqual(l.get(id).disposition, 'dropped');
  assert.strictEqual(l.all().length, 1);
  assert.strictEqual(l.rejected().length, 1);
});

test('weakened claims keep both the original and the corrected text', () => {
  const l = new Ledger(tmp());
  const id = l.add(makeClaim({ text: 'strong claim' }));
  l.setDisposition(id, 'weakened', { final_text: 'narrower claim' });
  const c = l.get(id);
  assert.strictEqual(c.original_text, 'strong claim');
  assert.strictEqual(c.final_text, 'narrower claim');
  assert.strictEqual(c.confidence, 'weakened');
});

test('round-trips through JSONL', () => {
  const dir = tmp();
  const l = new Ledger(dir);
  l.add(makeClaim({ text: 'persisted' }));
  l.save();
  const l2 = Ledger.load(dir);
  assert.strictEqual(l2.all()[0].text, 'persisted');
  assert.strictEqual(l2.add(makeClaim({ text: 'next' })), 'C2');
});
