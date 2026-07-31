'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { assessScope, subjectTokens, hasAngle } = require('../lib/scope');

test('frame words do not count as subject', () => {
  assert.deepStrictEqual(subjectTokens('tell me about fungi'), ['fungi']);
  assert.deepStrictEqual(subjectTokens('give me a general overview of fungi'), ['fungi']);
});

test('detects a stated angle', () => {
  assert.strictEqual(hasAngle('how did X evolve'), true);
  assert.strictEqual(hasAngle('compare X and Y'), true);
  assert.strictEqual(hasAngle('the relationship between X and Y'), true);
  assert.strictEqual(hasAngle('tell me about fungi'), false);
});

// The case that motivated this gate.
test('"tell me about fungi" is too vague to run', () => {
  const s = assessScope('tell me about fungi');
  assert.strictEqual(s.runnable, false);
  assert.strictEqual(s.verdict, 'too-vague');
  assert.match(s.reasons.join(' '), /single broad noun|one subject term/i);
});

test('a bare topic word is too vague', () => {
  assert.strictEqual(assessScope('AI').runnable, false);
  assert.strictEqual(assessScope('').runnable, false);
  assert.match(assessScope('').reasons.join(' '), /no subject/i);
});

test('two broad terms with no angle is too vague', () => {
  const s = assessScope('tell me about mycorrhizal fungi');
  assert.strictEqual(s.runnable, false);
  assert.match(s.reasons.join(' '), /no stated angle/i);
});

// The real question from a live run — must not be blocked.
test('a specific question with an angle is runnable', () => {
  const s = assessScope(
    'How did the symbiosis between mycorrhizal fungi and trees evolve and how do they interact'
  );
  assert.strictEqual(s.runnable, true);
  assert.strictEqual(s.hasAngle, true);
  assert.strictEqual(s.verdict, 'runnable');
});

test('a specific subject with no angle still runs, flagged as broad', () => {
  const s = assessScope('what is functional ultrasound imaging');
  assert.strictEqual(s.runnable, true);
  assert.strictEqual(s.verdict, 'runnable-but-broad');
  assert.match(s.reasons.join(' '), /descriptive rather than answering/i);
});

test('two terms rescued by an explicit angle', () => {
  const s = assessScope('compare mycorrhizal and saprotrophic fungi');
  assert.strictEqual(s.runnable, true);
});

test('the assessment reports what it saw, so a human can judge the call', () => {
  const s = assessScope('tell me about fungi');
  assert.deepStrictEqual(s.subject, ['fungi']);
  assert.strictEqual(s.subjectCount, 1);
  assert.strictEqual(s.hasAngle, false);
  assert.ok(s.reasons.length > 0);
});

test('a long specific question is runnable even without a question word', () => {
  const s = assessScope('mycorrhizal fungi tree symbiosis nutrient exchange carbon');
  assert.strictEqual(s.runnable, true);
});
