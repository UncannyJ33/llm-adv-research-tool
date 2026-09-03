'use strict';

// Retrieval had no rate limiting and no retry. Three subagents searching in parallel
// triggered ten OpenAlex 429s in a single run: the corpus came back thinner than it looked,
// and the only trace was a degradation notice. A transient throttle is not a real coverage
// limit, and treating it as one silently degrades every parallel run.
//
// Two mechanisms, both needed:
//   - a per-host minimum interval, so a burst of concurrent calls self-paces
//   - bounded exponential backoff on 429 and 5xx, honouring Retry-After when the server sends it

const MIN_INTERVAL_MS = { default: 120 };
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

// A per-attempt deadline. `fetch` has none of its own, so a host that accepts the connection
// and then never answers hangs the call forever — and `doctor` runs on the critical path of
// both skills, so one hung probe stalls a run before it has retrieved anything.
const REQUEST_TIMEOUT_MS = 15000;

const lastCallAt = new Map();

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function pace(host) {
  const min = MIN_INTERVAL_MS[host] || MIN_INTERVAL_MS.default;
  const last = lastCallAt.get(host) || 0;
  const wait = last + min - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(host, Date.now());
}

function backoffFor(attempt, retryAfterHeader) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// GitHub signals BOTH its primary and its secondary rate limit with 403, not 429 — and the
// unauthenticated search limit is 10 requests a minute, so this is the common path, not an
// edge case. Left out, a throttled GitHub search was neither retried nor recognised, and
// lib/doctor.js reported the adapter `down`: the exact misdiagnosis the labelled 429 message
// was added to prevent.
//
// Only a 403 that actually carries rate-limit evidence. A plain 403 is a bad credential or a
// forbidden repo — terminal, and retrying it four times is both wrong and slow.
function isRateLimited(res) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  const headers = res.headers;
  if (!headers || typeof headers.get !== 'function') return false;
  const remaining = headers.get('x-ratelimit-remaining');
  if (remaining != null && Number(remaining) === 0) return true;
  return Boolean(headers.get('retry-after'));
}

// AbortSignal.timeout rejects with a bare TimeoutError whose message ("The operation was
// aborted due to timeout") names neither the host nor the deadline. A degradation notice the
// reader cannot act on is the same as no notice, so say what actually happened.
function networkErrorMessage(err) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `timed out after ${REQUEST_TIMEOUT_MS}ms`;
  }
  return err.message;
}

// The 429 message used to name RESEARCH_MAILTO unconditionally. That is the right advice for
// OpenAlex and Crossref and useless everywhere else — a throttled GitHub search told the user
// to set a variable GitHub has never heard of. Keyed on the caller's label, which is the same
// string the degradation notice carries, so the hint a user reads matches the API that
// throttled them.
const QUOTA_HINT = {
  openalex: 'set RESEARCH_MAILTO for a higher quota',
  'openalex citing': 'set RESEARCH_MAILTO for a higher quota',
  crossref: 'set RESEARCH_MAILTO for a higher quota',
  github: 'set GITHUB_TOKEN for a higher quota',
};

function rateLimitHint(label) {
  return QUOTA_HINT[label] || 'retry later';
}

// Returns the Response on success. Throws with a labelled message on terminal failure so the
// caller can record an accurate degradation rather than a generic error.
async function politeFetch(url, opts = {}) {
  const host = hostOf(url);
  const label = opts.label || host;
  let lastStatus = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await pace(host);

    let res;
    try {
      res = await fetch(url, {
        headers: opts.headers || {},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure — a timeout included: retry on the same schedule rather than
      // failing the whole run.
      if (attempt === MAX_ATTEMPTS - 1) throw new Error(`${label}: ${networkErrorMessage(err)}`);
      await sleep(backoffFor(attempt));
      continue;
    }

    if (res.ok) return res;
    lastStatus = res.status;

    // The message has to carry the words lib/doctor.js matches on (/\b429\b|rate limit/i),
    // or a throttle is filed as an outage whatever the status code was.
    const throttled = isRateLimited(res);
    if ((!RETRYABLE.has(res.status) && !throttled) || attempt === MAX_ATTEMPTS - 1) {
      throw new Error(
        `${label} ${res.status}`
        + (throttled ? ` (rate limited after retries — ${rateLimitHint(label)})` : '')
      );
    }
    await sleep(backoffFor(attempt, res.headers.get('retry-after')));
  }

  throw new Error(`${label} ${lastStatus || 'failed'}`);
}

async function fetchJson(url, opts = {}) {
  const res = await politeFetch(url, opts);
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await politeFetch(url, opts);
  return res.text();
}

module.exports = {
  politeFetch, fetchJson, fetchText, backoffFor, hostOf, rateLimitHint,
  isRateLimited, networkErrorMessage,
  MAX_ATTEMPTS, RETRYABLE, MIN_INTERVAL_MS, QUOTA_HINT, REQUEST_TIMEOUT_MS,
};
