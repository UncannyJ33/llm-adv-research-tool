'use strict';
const { defaultAdapters } = require('./seed');
const { getTable } = require('./domains');

// Adapters with no endpoint of their own — retrieval happens through the agent layer
// (WebSearch/WebFetch handing results to lib/retrieve/web.js#fromResult), not an API call
// this preflight could make. Probing `web` would just report a permanent, meaningless 'ok'.
const AGENT_DRIVEN = new Set(['web']);

// One adapter -> one result row. Calls the adapter itself rather than a hand-written URL —
// the adapter map is the only source of truth for how a source is reached, so this exercises
// the real lib/retrieve/http.js pacing and backoff path instead of a second list that would
// drift out of sync with it.
async function probe(name, adapter) {
  if (AGENT_DRIVEN.has(name)) {
    return {
      adapter: name,
      status: 'agent-driven',
      ms: 0,
      detail: 'no endpoint — retrieval happens through the agent layer (WebSearch/WebFetch)',
    };
  }
  const start = Date.now();
  try {
    const recs = await adapter('test', { limit: 1 });
    return {
      adapter: name,
      status: 'ok',
      ms: Date.now() - start,
      detail: `${recs.length} record${recs.length === 1 ? '' : 's'} returned`,
    };
  } catch (err) {
    const ms = Date.now() - start;
    // http.js labels a rate limit with the status code and/or the word "rate limit" (see its
    // 429 message); anything else is a real outage, not a transient throttle a caller might
    // want to wait out.
    if (/\b429\b|rate limit/i.test(err.message)) {
      return { adapter: name, status: 'rate-limited', ms, detail: err.message };
    }
    return { adapter: name, status: 'down', ms, detail: err.message };
  }
}

async function doctor(opts = {}) {
  const adapters = opts.adapters || defaultAdapters();
  const names = opts.names || (opts.domain ? getTable(opts.domain).retrieval : Object.keys(adapters));
  const offline = opts.offline !== undefined ? opts.offline : Boolean(process.env.RESEARCH_OFFLINE);

  const results = await Promise.all(names.map(name => {
    if (offline) {
      return { adapter: name, status: 'skipped', ms: 0, detail: 'RESEARCH_OFFLINE set — not probed' };
    }
    const adapter = adapters[name];
    if (!adapter) {
      // Same gap seed.js calls out as a `no_adapter` degradation: a retrieval set naming an
      // adapter that isn't registered is a real hole in coverage, not something to skip over.
      return { adapter: name, status: 'down', ms: 0, detail: `no adapter registered for "${name}"` };
    }
    return probe(name, adapter);
  }));

  // Red must mean "a run now is pointless", not "one adapter hiccuped" (CLAUDE.md: marker
  // inflation destroys signal). So `ok` is false only when something was actually attempted
  // and every attempt failed — an all-agent-driven or all-offline row set has nothing to
  // report on and stays green by default.
  const attempted = results.filter(r => r.status === 'ok' || r.status === 'rate-limited' || r.status === 'down');
  const ok = attempted.length === 0 || attempted.some(r => r.status === 'ok');

  return { results, ok };
}

module.exports = { probe, doctor, AGENT_DRIVEN };
