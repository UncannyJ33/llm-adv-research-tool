'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RunState, slugify, todayLocal, STAGES } = require('../lib/state');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'state-'));

// toISOString() is UTC. An 7pm Pacific run would be stamped with tomorrow's date,
// misfiling the run and the exported note.
test('todayLocal uses the local calendar date, not UTC', () => {
  const evening = new Date(2026, 6, 30, 19, 30, 0); // 2026-07-30 19:30 local
  assert.strictEqual(todayLocal(evening), '2026-07-30');
});

test('todayLocal zero-pads month and day', () => {
  assert.strictEqual(todayLocal(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
});

test('slugify makes a filesystem-safe run id', () => {
  assert.strictEqual(slugify('Functional ultrasound imaging for the brain!'), 'functional-ultrasound-imaging-for-the-brain');
  assert.strictEqual(slugify('  multiple   spaces  '), 'multiple-spaces');
});

test('creates a run with every stage pending', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'orient', domain: 'software', date: '2026-07-30' });
  for (const stage of STAGES) assert.strictEqual(s.data.stages[stage], 'pending', stage);
  assert.strictEqual(s.data.mode, 'orient');
  assert.strictEqual(s.data.domain, 'software');
});

test('run id combines date and question slug', () => {
  const s = RunState.create(tmp(), { question: 'Zig comptime', mode: 'orient', domain: 'software', date: '2026-07-30' });
  assert.strictEqual(s.data.run_id, '2026-07-30-zig-comptime');
});

test('checkpointing persists and reloads', () => {
  const dir = tmp();
  const s = RunState.create(dir, { question: 'q', mode: 'deep', domain: 'biomedical', date: '2026-07-30' });
  s.setStage('seed', 'complete');
  const s2 = RunState.load(dir);
  assert.strictEqual(s2.data.stages.seed, 'complete');
});

test('resume reports the first incomplete stage', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'deep', domain: 'biomedical', date: '2026-07-30' });
  s.setStage('seed', 'complete');
  s.setStage('perspectives', 'complete');
  assert.strictEqual(s.nextStage(), 'interrogation');
});

test('nextStage is null when everything is complete', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'deep', domain: 'biomedical', date: '2026-07-30' });
  for (const stage of STAGES) s.setStage(stage, 'complete');
  assert.strictEqual(s.nextStage(), null);
});

test('an unknown stage throws rather than being silently recorded', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'deep', domain: 'biomedical', date: '2026-07-30' });
  assert.throws(() => s.setStage('bogus', 'complete'), /unknown stage/i);
});

test('a failed perspective is recorded without killing the run', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'deep', domain: 'biomedical', date: '2026-07-30' });
  s.addPerspective('clinical');
  s.addPerspective('hardware');
  s.setPerspective('hardware', 'failed', 'fetch timeout');
  assert.strictEqual(s.data.perspectives.find(p => p.id === 'hardware').status, 'failed');
  assert.strictEqual(s.data.perspectives.find(p => p.id === 'clinical').status, 'pending');
});

// Spec §12: the worst possible outcome is a run that LOOKS complete but silently covered less.
test('degradations are recorded and surface as a disclosure flag', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'deep', domain: 'biomedical', date: '2026-07-30' });
  assert.strictEqual(s.isDegraded(), false);
  s.addDegradation('api_down', 'europepmc 503 during seed', 'biomedical coverage reduced');
  assert.strictEqual(s.isDegraded(), true);
  assert.strictEqual(s.data.degradations.length, 1);
  assert.strictEqual(s.data.degradations[0].kind, 'api_down');
});

test('a failed perspective alone marks the run degraded', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'deep', domain: 'biomedical', date: '2026-07-30' });
  s.addPerspective('hardware');
  s.setPerspective('hardware', 'failed', 'boom');
  assert.strictEqual(s.isDegraded(), true);
});

// In the first real run, citation health and both red-team lenses never ran and the report
// gave no sign of it. A skipped quality gate is indistinguishable from a passed one.
test('skippedStages names every stage that did not complete', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'orient', domain: 'software', date: '2026-07-30' });
  s.setStage('seed', 'complete');
  const skipped = s.skippedStages();
  assert.ok(!skipped.includes('seed'));
  assert.ok(skipped.includes('verification'));
  assert.ok(skipped.includes('redteam'));
});

test('a fully complete run reports no skipped stages', () => {
  const s = RunState.create(tmp(), { question: 'q', mode: 'orient', domain: 'software', date: '2026-07-30' });
  for (const stage of STAGES) s.setStage(stage, 'complete');
  assert.deepStrictEqual(s.skippedStages(), []);
});

// Exporting the keyword soup as the note title produced a poor vault artifact.
test('the research question is stored separately from the retrieval query', () => {
  const s = RunState.create(tmp(), {
    question: 'How does the J-space relate to global workspace theory?',
    query: 'global workspace neuronal broadcast cortical hub',
    mode: 'orient', domain: 'biomedical', date: '2026-07-30',
  });
  assert.strictEqual(s.data.question, 'How does the J-space relate to global workspace theory?');
  assert.strictEqual(s.data.query, 'global workspace neuronal broadcast cortical hub');
});

test('query defaults to the question when not supplied', () => {
  const s = RunState.create(tmp(), { question: 'plain question', mode: 'orient', domain: 'software', date: '2026-07-30' });
  assert.strictEqual(s.data.query, 'plain question');
});

test('counts update and persist', () => {
  const dir = tmp();
  const s = RunState.create(dir, { question: 'q', mode: 'orient', domain: 'software', date: '2026-07-30' });
  s.setCounts({ sources: 12, claims_drafted: 30 });
  assert.strictEqual(RunState.load(dir).data.counts.sources, 12);
});

test('routing disclosure is stored so a mis-route is visible after the fact', () => {
  const s = RunState.create(tmp(), {
    question: 'q', mode: 'orient', domain: 'software', date: '2026-07-30',
    domainConfidence: 'low', retrievalSets: ['web', 'openalex'], ambiguous: true,
  });
  assert.strictEqual(s.data.domain_confidence, 'low');
  assert.strictEqual(s.data.ambiguous, true);
  assert.deepStrictEqual(s.data.retrieval_sets, ['web', 'openalex']);
});
