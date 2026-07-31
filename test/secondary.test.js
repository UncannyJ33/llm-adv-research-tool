'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isSecondary, classifySupport } = require('../lib/secondary');
const { makeRecord } = require('../lib/corpus');

const review = id => makeRecord({ id, work_type: 'review', title: `Review ${id}` });
const primary = id => makeRecord({ id, work_type: 'article', title: `Study ${id}` });

test('a review work type is secondary', () => {
  assert.strictEqual(isSecondary(review('S1')), true);
  assert.strictEqual(isSecondary(primary('S2')), false);
});

test('a tier basis naming review counts as secondary', () => {
  assert.strictEqual(isSecondary(makeRecord({ id: 'S3', tier_basis: 'review-article' })), true);
});

test('a missing record is not secondary', () => {
  assert.strictEqual(isSecondary(null), false);
});

// Reviews restate primary results and often strengthen them in the retelling.
test('support resting only on reviews is flagged', () => {
  const out = classifySupport([review('S1'), review('S2')]);
  assert.strictEqual(out.secondaryOnly, true);
  assert.deepStrictEqual(out.reviewIds, ['S1', 'S2']);
  assert.match(out.reason, /review/i);
  assert.match(out.reason, /primary/i);
});

test('mixed support is not flagged', () => {
  assert.strictEqual(classifySupport([review('S1'), primary('S2')]).secondaryOnly, false);
});

test('primary-only support is not flagged', () => {
  const out = classifySupport([primary('S1')]);
  assert.strictEqual(out.secondaryOnly, false);
  assert.deepStrictEqual(out.primaryIds, ['S1']);
});

test('no cited sources is not a secondary-only finding', () => {
  assert.strictEqual(classifySupport([]).secondaryOnly, false);
  assert.strictEqual(classifySupport(null).secondaryOnly, false);
});
