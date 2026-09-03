'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { doctor, probe, AGENT_DRIVEN } = require('../lib/doctor');
const { getTable, listDomains } = require('../lib/domains');

// Every test injects `adapters` — this module must never touch the network. `doctor()`'s
// default falls through to lib/seed.js#defaultAdapters(), which is exactly what makes it
// dangerous to call bare in a test.
//
// `offline` is passed explicitly for the same reason. Left out, it falls through to
// process.env.RESEARCH_OFFLINE, so every probe below would report `skipped` and every
// assertion here would fail for anyone who has that set in their shell — a test whose result
// depends on the environment it runs in is not hermetic.

test('a healthy adapter reports ok, and doctor as a whole reports ok', async () => {
  const adapters = { alpha: async () => [{ id: 1 }, { id: 2 }] };
  const { results, ok } = await doctor({ adapters, offline: false });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'ok');
  assert.match(results[0].detail, /2/);
  assert.strictEqual(ok, true);
});

test('a 429 message is classified rate-limited, not down', async () => {
  const adapters = {
    openalex: async () => { throw new Error('openalex 429 (rate limited after retries)'); },
  };
  const { results } = await doctor({ adapters, offline: false });
  assert.strictEqual(results[0].status, 'rate-limited');
});

test('a non-429 failure is down, with the error message preserved as detail', async () => {
  const adapters = {
    crossref: async () => { throw new Error('getaddrinfo ENOTFOUND api.crossref.org'); },
  };
  const { results } = await doctor({ adapters, offline: false });
  assert.strictEqual(results[0].status, 'down');
  assert.match(results[0].detail, /ENOTFOUND/);
});

test('web is agent-driven and is never actually called', async () => {
  let called = false;
  const adapters = { web: async () => { called = true; return []; } };
  const { results } = await doctor({ adapters, offline: false });
  assert.strictEqual(results[0].status, 'agent-driven');
  assert.strictEqual(called, false);
  assert.ok(AGENT_DRIVEN.has('web'));
});

test('one ok among several failures still leaves the whole probe ok', async () => {
  const adapters = {
    good: async () => [],
    bad1: async () => { throw new Error('down'); },
    bad2: async () => { throw new Error('502'); },
  };
  const { ok } = await doctor({ adapters, offline: false });
  assert.strictEqual(ok, true);
});

test('every probed adapter failing makes the whole probe not ok', async () => {
  const adapters = {
    bad1: async () => { throw new Error('down'); },
    bad2: async () => { throw new Error('502'); },
  };
  const { ok } = await doctor({ adapters, offline: false });
  assert.strictEqual(ok, false);
});

test('offline skips every adapter without calling any of them, and is not a fault', async () => {
  let called = false;
  const adapters = { alpha: async () => { called = true; return []; } };
  const { results, ok } = await doctor({ adapters, offline: true });
  assert.strictEqual(results[0].status, 'skipped');
  assert.strictEqual(called, false);
  assert.strictEqual(ok, true);
});

test('a domain option narrows the probe to that domain\'s retrieval set', async () => {
  // Built from the live table rather than a hardcoded list, since lib/domains.js is being
  // edited concurrently elsewhere on this branch.
  const softwareSet = getTable('software').retrieval;
  const adapters = {};
  for (const name of softwareSet) adapters[name] = async () => [];
  adapters.europepmc = async () => { throw new Error('europepmc is not part of the software retrieval set'); };

  const { results } = await doctor({ adapters, domain: 'software', offline: false });
  assert.deepStrictEqual(results.map(r => r.adapter).sort(), [...softwareSet].sort());
});

test('a domain whose probeable adapters are all agent-driven still yields ok true', async () => {
  const name = listDomains().find(d => getTable(d).retrieval.every(a => AGENT_DRIVEN.has(a)));
  assert.ok(name, 'expected at least one domain routed entirely through the agent layer');

  const adapters = { web: async () => { throw new Error('must not be called'); } };
  const { results, ok } = await doctor({ adapters, domain: name, offline: false });
  assert.ok(results.every(r => r.status === 'agent-driven'));
  assert.strictEqual(ok, true);
});

test('probe() classifies a single adapter without going through doctor()', async () => {
  const row = await probe('x', async () => [1]);
  assert.strictEqual(row.adapter, 'x');
  assert.strictEqual(row.status, 'ok');
});
