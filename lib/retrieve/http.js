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
      res = await fetch(url, { headers: opts.headers || {} });
    } catch (err) {
      // Network-level failure: retry on the same schedule rather than failing the whole run.
      if (attempt === MAX_ATTEMPTS - 1) throw new Error(`${label}: ${err.message}`);
      await sleep(backoffFor(attempt));
      continue;
    }

    if (res.ok) return res;
    lastStatus = res.status;

    if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
      throw new Error(
        `${label} ${res.status}`
        + (res.status === 429 ? ' (rate limited after retries — set RESEARCH_MAILTO for a higher quota)' : '')
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
  politeFetch, fetchJson, fetchText, backoffFor, hostOf,
  MAX_ATTEMPTS, RETRYABLE, MIN_INTERVAL_MS,
};
