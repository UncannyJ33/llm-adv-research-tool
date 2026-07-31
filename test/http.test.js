'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { backoffFor, hostOf, RETRYABLE, MAX_ATTEMPTS } = require('../lib/retrieve/http');

// Three subagents searching in parallel triggered ten OpenAlex 429s in one run. A transient
// throttle is not a real coverage limit, but with no retry it was recorded as one.
test('429 and transient 5xx are retryable; client errors are not', () => {
  for (const s of [429, 500, 502, 503, 504]) assert.ok(RETRYABLE.has(s), String(s));
  for (const s of [400, 401, 403, 404]) assert.ok(!RETRYABLE.has(s), String(s));
});

test('backoff grows exponentially and is capped', () => {
  const a = backoffFor(0);
  const b = backoffFor(1);
  const c = backoffFor(2);
  assert.ok(b > a && c > b, `expected growth, got ${a}/${b}/${c}`);
  assert.ok(backoffFor(20) <= 8000, 'capped');
});

test('a Retry-After header wins over the computed backoff', () => {
  assert.strictEqual(backoffFor(0, '2'), 2000);
  assert.ok(backoffFor(0, 'garbage') > 0, 'falls back when the header is unparseable');
  assert.ok(backoffFor(0, '9999') <= 8000, 'still capped');
});

test('more than one attempt is made', () => {
  assert.ok(MAX_ATTEMPTS > 1);
});

test('hostOf tolerates a malformed url', () => {
  assert.strictEqual(hostOf('https://api.openalex.org/works'), 'api.openalex.org');
  assert.strictEqual(hostOf('not a url'), 'unknown');
});
