'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seed } = require('../lib/seed');
const { makeRecord } = require('../lib/corpus');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));

const fakeAdapters = overrides => ({
  openalex: async () => [makeRecord({
    doi: '10.1/a', title: 'Alpha study', year: 2020, authors: ['A One'],
    abstract: 'alpha abstract', venue: { name: 'J', type: 'journal', is_indexed: true },
    retrieved_from: ['openalex'],
  })],
  europepmc: async () => [makeRecord({
    doi: '10.1/A', title: 'Alpha study', year: 2020, authors: ['A One'],
    abstract: 'alpha abstract', venue: { name: 'J', type: 'journal', is_indexed: true },
    retrieved_from: ['europepmc'],
  })],
  crossref: async () => [makeRecord({
    doi: '10.1/b', title: 'Beta study', year: 2021, authors: ['B Two'],
    venue: { name: 'J2', type: 'journal', is_indexed: true }, retrieved_from: ['crossref'],
  })],
  web: async () => [makeRecord({
    kind: 'web', url: 'https://example.org/x', title: 'Web page',
    source_class: 'community', work_type: 'page', retrieved_from: ['web'],
  })],
  ...overrides,
});

test('seeds a run, dedupes across sources, and tiers by domain', async () => {
  const dir = tmp();
  const out = await seed({
    runsDir: dir, question: 'alpha beta', mode: 'orient',
    domain: 'biomedical', date: '2026-07-30', adapters: fakeAdapters(),
  });

  // Alpha appears from both openalex and europepmc with the same DOI -> one record.
  const alpha = out.corpus.all().filter(r => r.title === 'Alpha study');
  assert.strictEqual(alpha.length, 1, 'cross-source duplicate should merge');
  assert.deepStrictEqual(alpha[0].retrieved_from.sort(), ['europepmc', 'openalex']);
  assert.strictEqual(alpha[0].tier, 'primary');
});

test('writes corpus.jsonl and run.json to disk', async () => {
  const dir = tmp();
  const out = await seed({
    runsDir: dir, question: 'q', mode: 'orient',
    domain: 'software', date: '2026-07-30', adapters: fakeAdapters(),
  });
  assert.ok(fs.existsSync(path.join(out.runDir, 'corpus.jsonl')));
  assert.ok(fs.existsSync(path.join(out.runDir, 'run.json')));
  assert.strictEqual(out.state.data.stages.seed, 'complete');
});

test('only queries the retrieval sets for the routed domain', async () => {
  const called = [];
  const adapters = fakeAdapters({
    arxiv: async () => { called.push('arxiv'); return []; },
  });
  for (const k of ['openalex', 'europepmc', 'crossref', 'web']) {
    const orig = adapters[k];
    adapters[k] = async (...a) => { called.push(k); return orig(...a); };
  }

  await seed({
    runsDir: tmp(), question: 'q', mode: 'orient',
    domain: 'software', date: '2026-07-30', adapters,
  });
  // software retrieval set is ['web', 'openalex'] — europepmc must not be touched.
  assert.ok(called.includes('web'));
  assert.ok(called.includes('openalex'));
  assert.ok(!called.includes('europepmc'), 'must not query biomedical sources for a software question');
});

// Spec §12: a source API failing must never silently produce a thinner bibliography.
test('an adapter failure is recorded as a degradation, not swallowed', async () => {
  const adapters = fakeAdapters({
    europepmc: async () => { throw new Error('503'); },
  });
  const out = await seed({
    runsDir: tmp(), question: 'q', mode: 'orient',
    domain: 'biomedical', date: '2026-07-30', adapters,
  });
  assert.strictEqual(out.state.isDegraded(), true);
  const d = out.state.data.degradations[0];
  assert.strictEqual(d.kind, 'api_error');
  assert.match(d.detail, /europepmc/);
  assert.match(d.detail, /503/);
});

test('the run still completes when one adapter fails', async () => {
  const adapters = fakeAdapters({ europepmc: async () => { throw new Error('503'); } });
  const out = await seed({
    runsDir: tmp(), question: 'q', mode: 'orient',
    domain: 'biomedical', date: '2026-07-30', adapters,
  });
  assert.strictEqual(out.state.data.stages.seed, 'complete');
  assert.ok(out.corpus.all().length > 0);
});

test('retracted sources are excluded from the corpus but kept in the excluded list', async () => {
  const adapters = fakeAdapters({
    crossref: async () => [makeRecord({
      doi: '10.1/pulled', title: 'Retracted work', year: 2018,
      retracted: true, retraction_notice_doi: '10.1/notice', retrieved_from: ['crossref'],
    })],
  });
  const out = await seed({
    runsDir: tmp(), question: 'q', mode: 'orient',
    domain: 'biomedical', date: '2026-07-30', adapters,
  });
  assert.ok(!out.corpus.all().some(r => r.title === 'Retracted work'));
  assert.strictEqual(out.excluded.length, 1);
  assert.match(out.excluded[0].exclusion_reason, /10\.1\/notice/);
});

test('ambiguous routing unions retrieval sets and records the ambiguity', async () => {
  const out = await seed({
    runsDir: tmp(), question: 'q', mode: 'orient',
    domains: ['software', 'physical_cs'], date: '2026-07-30', adapters: fakeAdapters(),
  });
  assert.strictEqual(out.state.data.ambiguous, true);
  assert.deepStrictEqual(out.state.data.candidate_domains, ['software', 'physical_cs']);
});

test('offline mode performs no retrieval and announces itself as degraded', async () => {
  const called = [];
  const adapters = fakeAdapters();
  for (const k of Object.keys(adapters)) {
    const orig = adapters[k];
    adapters[k] = async (...a) => { called.push(k); return orig(...a); };
  }
  const out = await seed({
    runsDir: tmp(), question: 'q', mode: 'orient',
    domain: 'biomedical', date: '2026-07-30', adapters, offline: true,
  });
  assert.deepStrictEqual(called, [], 'no adapter may be called in offline mode');
  assert.strictEqual(out.corpus.all().length, 0);
  assert.strictEqual(out.state.isDegraded(), true);
  assert.strictEqual(out.state.data.degradations[0].kind, 'offline');
});

test('an explicit offline:false overrides the environment variable', async () => {
  const prev = process.env.RESEARCH_OFFLINE;
  process.env.RESEARCH_OFFLINE = '1';
  try {
    const out = await seed({
      runsDir: tmp(), question: 'q', mode: 'orient',
      domain: 'biomedical', date: '2026-07-30', adapters: fakeAdapters(), offline: false,
    });
    assert.ok(out.corpus.all().length > 0, 'explicit offline:false must win over the env var');
  } finally {
    if (prev === undefined) delete process.env.RESEARCH_OFFLINE;
    else process.env.RESEARCH_OFFLINE = prev;
  }
});

test('counts are recorded on the run state', async () => {
  const out = await seed({
    runsDir: tmp(), question: 'q', mode: 'orient',
    domain: 'biomedical', date: '2026-07-30', adapters: fakeAdapters(),
  });
  assert.strictEqual(out.state.data.counts.sources, out.corpus.all().length);
});
