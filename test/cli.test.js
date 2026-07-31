'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'research.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));

function run(args, env = {}) {
  return execFileSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// RESEARCH_OFFLINE keeps these hermetic — a CLI test must not depend on OpenAlex being up,
// and a live seed would shift the ingested source's id out from under the assertions.
function seeded() {
  const env = { RESEARCH_RUNS_DIR: tmp(), RESEARCH_OFFLINE: '1' };
  run(['seed', 'test question', '--domain', 'software', '--date', '2026-07-30'], env);
  const runId = '2026-07-30-test-question';
  const id = run(['ingest-web', runId,
    '--url', 'https://ziglang.org/documentation/master/',
    '--title', 'Zig Docs',
    '--text', 'Results\nComptime evaluates expressions at compile time in the Zig language.',
  ], env).trim().split(/\s+/)[0];
  return { env, runId, id };
}

test('an offline seed declares itself degraded rather than looking clean', () => {
  const env = { RESEARCH_RUNS_DIR: tmp(), RESEARCH_OFFLINE: '1' };
  const out = run(['seed', 'q', '--domain', 'software', '--date', '2026-07-30'], env);
  assert.match(out, /DEGRADED/);
  assert.match(out, /offline/i);
});

test('ingest-web adds a web source and tiers it by the run domain', () => {
  const { env, runId, id } = seeded();
  assert.strictEqual(id, 'S1', 'offline seed leaves the corpus empty');
  const rec = JSON.parse(run(['source', runId, id], env));
  assert.strictEqual(rec.tier, 'primary', 'official docs are primary in the software domain');
});

test('verify exits 0 on a real span', () => {
  const { env, runId } = seeded();
  run(['claim', runId, '--text', 'Comptime runs at compile time.', '--sources', 'S1'], env);
  const out = run(['verify', runId, 'C1', '--source', 'S1', '--verdict', 'supported',
    '--span', 'Comptime evaluates expressions at compile time in the Zig language',
    '--role', 'result', '--reason', 'The documentation states this directly in its text.'], env);
  assert.match(out, /effective: supported/);
});

test('verify exits NON-ZERO on a fabricated span', () => {
  const { env, runId } = seeded();
  run(['claim', runId, '--text', 'Comptime runs on the GPU.', '--sources', 'S1'], env);
  assert.throws(() => run(['verify', runId, 'C1', '--source', 'S1', '--verdict', 'supported',
    '--span', 'Comptime evaluates expressions on the graphics processing unit at runtime',
    '--role', 'result', '--reason', 'The documentation states this in its results.'], env));
});

// An agent must not be able to assert its own gate result.
test('verify refuses --span-check outright', () => {
  const { env, runId } = seeded();
  run(['claim', runId, '--text', 'x', '--sources', 'S1'], env);
  assert.throws(
    () => run(['verify', runId, 'C1', '--source', 'S1', '--verdict', 'supported',
      '--span-check', 'pass', '--span', 'anything', '--role', 'result', '--reason', 'y'], env),
    /span-check is not accepted|computed from stored source/i
  );
});

test('claim refuses to register an uncited claim', () => {
  const { env, runId } = seeded();
  assert.throws(() => run(['claim', runId, '--text', 'Uncited assertion.'], env),
    /requires --sources|cannot cite/i);
});

test('claims lists registered claims with disposition', () => {
  const { env, runId } = seeded();
  run(['claim', runId, '--text', 'A claim.', '--sources', 'S1'], env);
  assert.match(run(['claims', runId], env), /C1/);
});

test('assemble finalizes counts and writes report.html', () => {
  const { env, runId } = seeded();
  const briefFile = path.join(tmp(), 'b.md');
  fs.writeFileSync(briefFile, '## Overview\n\nZig comptime runs at compile time.');
  run(['claim', runId, '--text', 'Comptime runs at compile time.', '--sources', 'S1'], env);
  run(['verify', runId, 'C1', '--source', 'S1', '--verdict', 'supported',
    '--span', 'Comptime evaluates expressions at compile time in the Zig language',
    '--role', 'result', '--reason', 'The documentation states this directly in its text.'], env);
  run(['brief', runId, '--file', briefFile], env);
  const out = run(['assemble', runId], env);
  assert.match(out, /kept 1/);
  assert.match(out, /report\.html/);
});

test('assemble warns when a run with claims rejected nothing', () => {
  const { env, runId } = seeded();
  run(['claim', runId, '--text', 'Comptime runs at compile time.', '--sources', 'S1'], env);
  run(['verify', runId, 'C1', '--source', 'S1', '--verdict', 'supported',
    '--span', 'Comptime evaluates expressions at compile time in the Zig language',
    '--role', 'result', '--reason', 'The documentation states this directly in its text.'], env);
  assert.match(run(['assemble', runId], env), /nothing was rejected/i);
});

test('an unverified claim is dropped by assemble', () => {
  const { env, runId } = seeded();
  run(['claim', runId, '--text', 'Never checked.', '--sources', 'S1'], env);
  assert.match(run(['assemble', runId], env), /dropped 1/);
});

test('ingest-fulltext attaches text and shifts the evidence basis', () => {
  const { env, runId } = seeded();
  const f = path.join(tmp(), 'full.txt');
  fs.writeFileSync(f, 'Full body text of the documentation page goes here.');
  run(['ingest-fulltext', runId, 'S1', '--file', f], env);
  const rec = JSON.parse(run(['source', runId, 'S1'], env));
  assert.strictEqual(rec.evidence_basis, 'fulltext');
});
