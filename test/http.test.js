'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  politeFetch, backoffFor, hostOf, rateLimitHint, isRateLimited, networkErrorMessage,
  RETRYABLE, MAX_ATTEMPTS, REQUEST_TIMEOUT_MS,
} = require('../lib/retrieve/http');

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

// The 429 hint named RESEARCH_MAILTO for every host. A throttled GitHub search told the user
// to set a variable GitHub has never heard of.
test('the rate-limit hint names the API that actually throttled', () => {
  assert.match(rateLimitHint('openalex'), /RESEARCH_MAILTO/);
  assert.match(rateLimitHint('crossref'), /RESEARCH_MAILTO/);
  assert.match(rateLimitHint('github'), /GITHUB_TOKEN/);
  assert.doesNotMatch(rateLimitHint('github'), /RESEARCH_MAILTO/);
  assert.strictEqual(rateLimitHint('europepmc'), 'retry later');
});

// GitHub rate-limits with 403, not 429, and its unauthenticated search limit is 10 req/min —
// so this is the common path. Recognising it is what keeps lib/doctor.js from filing a
// throttle as an outage. But only a 403 carrying rate-limit evidence: a plain one is a bad
// credential or a forbidden repo, and retrying that is wrong.
const fakeRes = (status, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: k => (k.toLowerCase() in headers ? headers[k.toLowerCase()] : null) },
});

test('a 403 counts as a rate limit only when it carries rate-limit evidence', () => {
  assert.strictEqual(isRateLimited(fakeRes(403, { 'x-ratelimit-remaining': '0' })), true);
  assert.strictEqual(isRateLimited(fakeRes(403, { 'retry-after': '60' })), true);
  assert.strictEqual(isRateLimited(fakeRes(403)), false, 'bad credentials must stay terminal');
  assert.strictEqual(isRateLimited(fakeRes(403, { 'x-ratelimit-remaining': '4999' })), false);
  assert.strictEqual(isRateLimited(fakeRes(429)), true, '429 needs no header to qualify');
  assert.strictEqual(isRateLimited(fakeRes(503)), false, 'retryable, but not a rate limit');
});

test('a rate-limited 403 is retried and reported in doctor\'s own vocabulary', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  // retry-after in fractional seconds keeps the four attempts hermetic and fast; the header
  // is what backoffFor honours either way.
  globalThis.fetch = async () => {
    calls++;
    return fakeRes(403, { 'x-ratelimit-remaining': '0', 'retry-after': '0.001' });
  };
  try {
    await assert.rejects(
      politeFetch('https://api.github.com/search/issues?q=x', { label: 'github' }),
      err => {
        // lib/doctor.js classifies on exactly this regex.
        assert.match(err.message, /\b429\b|rate limit/i);
        assert.match(err.message, /403/);
        assert.match(err.message, /GITHUB_TOKEN/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.strictEqual(calls, MAX_ATTEMPTS, 'a throttle must be retried, not failed on sight');
});

test('a plain 403 fails on the first attempt instead of being retried', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return fakeRes(403); };
  try {
    await assert.rejects(
      politeFetch('https://api.example-forbidden.test/x', { label: 'github' }),
      /github 403$/
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.strictEqual(calls, 1, 'a permission error is terminal');
});

// fetch has no deadline of its own, so a host that accepts the connection and never answers
// hung the call. `doctor` is on the critical path of both skills — one hung probe stalled the
// whole run.
test('a request timeout names the deadline instead of surfacing a bare AbortError', () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.match(networkErrorMessage(timeout), /timed out after 15000ms/);
  assert.match(networkErrorMessage(Object.assign(new Error('x'), { name: 'AbortError' })), /timed out/);
  assert.strictEqual(networkErrorMessage(new Error('getaddrinfo ENOTFOUND')), 'getaddrinfo ENOTFOUND');
  assert.strictEqual(REQUEST_TIMEOUT_MS, 15000);
});

test('a timed-out attempt is retried like any other network failure', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    return { ok: true, status: 200, headers: { get: () => null } };
  };
  try {
    const res = await politeFetch('https://api.slow.test/x', { label: 'slow' });
    assert.strictEqual(res.ok, true);
  } finally {
    globalThis.fetch = original;
  }
  assert.strictEqual(calls, 2, 'a timeout must not fail the whole run on the first attempt');
});
