'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalize, checkSpan, MIN_SPAN_CHARS } = require('../lib/spancheck');

const SOURCE = `Functional ultrasound imaging achieved a spatial resolution of ap-
proximately 100 µm in the rodent cortex.  We did not evaluate  human infants.
The technique’s sensitivity — measured across trials — exceeded ﬁve percent.`;

test('exact span matches', () => {
  const r = checkSpan('in the rodent cortex. We did not evaluate human infants.', SOURCE);
  assert.strictEqual(r.result, 'pass', r.reason);
});

test('span broken by PDF line-break hyphenation still matches', () => {
  const r = checkSpan('a spatial resolution of approximately 100 µm in the rodent cortex', SOURCE);
  assert.strictEqual(r.result, 'pass', r.reason);
});

test('smart quotes and em dashes normalize to plain forms', () => {
  const r = checkSpan("The technique's sensitivity - measured across trials - exceeded five percent", SOURCE);
  assert.strictEqual(r.result, 'pass', r.reason);
});

test('ligatures normalize', () => {
  assert.ok(normalize('ﬁve').includes('five'));
});

test('collapses runs of whitespace', () => {
  assert.strictEqual(normalize('a   b\n\tc'), 'a b c');
});

test('a span absent from the source fails — this is the anti-fabrication guarantee', () => {
  const r = checkSpan('resolution of approximately 100 µm in human infants brains', SOURCE);
  assert.strictEqual(r.result, 'fail_not_found');
});

test('a span too short to be evidence is rejected, not passed', () => {
  const r = checkSpan('the', SOURCE);
  assert.strictEqual(r.result, 'too_short');
});

test('an empty or missing span is no_span_offered', () => {
  assert.strictEqual(checkSpan('', SOURCE).result, 'no_span_offered');
  assert.strictEqual(checkSpan(null, SOURCE).result, 'no_span_offered');
  assert.strictEqual(checkSpan(undefined, SOURCE).result, 'no_span_offered');
});

test('missing source text fails closed rather than passing', () => {
  const r = checkSpan('a'.repeat(MIN_SPAN_CHARS + 5), '');
  assert.strictEqual(r.result, 'fail_not_found');
});

test('normalize is idempotent', () => {
  const once = normalize(SOURCE);
  assert.strictEqual(normalize(once), once);
});

test('non-string input normalizes to empty rather than throwing', () => {
  assert.strictEqual(normalize(null), '');
  assert.strictEqual(normalize(42), '');
});
