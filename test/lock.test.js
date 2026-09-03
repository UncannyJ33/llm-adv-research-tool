'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { withLock, lockPath, writeFileAtomic } = require('../lib/lock');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));

test('withLock returns the callback result and releases the lock', () => {
  const dir = tmp();
  assert.strictEqual(withLock(dir, () => 42), 42);
  assert.ok(!fs.existsSync(lockPath(dir)), 'lock released');
});

test('the lock is released even when the callback throws', () => {
  const dir = tmp();
  assert.throws(() => withLock(dir, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(lockPath(dir)), 'lock released on throw');
});

test('a second acquisition times out while the first is held', () => {
  const dir = tmp();
  withLock(dir, () => {
    assert.throws(
      () => withLock(dir, () => 'inner', { timeoutMs: 60 }),
      /timed out.*run lock/is
    );
  });
});

test('a stale lock from a dead process is reclaimed', () => {
  const dir = tmp();
  const lp = lockPath(dir);
  fs.mkdirSync(lp);
  // Backdate well past the stale threshold.
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(lp, old, old);
  assert.strictEqual(withLock(dir, () => 'reclaimed', { timeoutMs: 500 }), 'reclaimed');
});

// The failure this module exists to prevent: two writers each load the same counter, each
// assign the same ids, and the second save silently discards the first writer's records.
test('concurrent writers do not lose each other updates', () => {
  const dir = tmp();
  const file = path.join(dir, 'counter.json');
  fs.writeFileSync(file, JSON.stringify({ items: [] }), 'utf8');

  const script = `
    const fs=require('node:fs');
    const {withLock}=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'lock.js'))});
    const dir=${JSON.stringify(dir)}, file=${JSON.stringify(file)};
    for (let i=0;i<20;i++) {
      withLock(dir, () => {
        const d=JSON.parse(fs.readFileSync(file,'utf8'));
        d.items.push(process.argv[2]+':'+i);
        fs.writeFileSync(file, JSON.stringify(d), 'utf8');
      });
    }
  `;
  const s = path.join(dir, 'w.js');
  fs.writeFileSync(s, script, 'utf8');

  const a = execFileSync('node', [s, 'A'], { encoding: 'utf8' });
  const b = execFileSync('node', [s, 'B'], { encoding: 'utf8' });
  void a; void b;

  const out = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(out.items.length, 40, 'no update was lost');
  assert.strictEqual(new Set(out.items).size, 40, 'no duplicate entries');
});

test('writeFileAtomic replaces the file and leaves no temp sibling', () => {
  const dir = tmp();
  const file = path.join(dir, 'run.json');
  writeFileAtomic(file, '{"a":1}');
  writeFileAtomic(file, '{"a":2}');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"a":2}');
  assert.deepStrictEqual(fs.readdirSync(dir), ['run.json']);
});

test('a failed write cleans up its temp file instead of stranding it', () => {
  const dir = tmp();
  assert.throws(() => writeFileAtomic(path.join(dir, 'missing', 'run.json'), '{}'));
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

// The test with teeth. Verified against the plain fs.writeFileSync this replaced: the reader
// hits truncated JSON within the first handful of samples. A whole-file save is not atomic,
// and readers do not take the lock.
test('a reader outside the lock never parses a half-written file', async () => {
  const dir = tmp();
  const file = path.join(dir, 'big.json');
  fs.writeFileSync(file, JSON.stringify({ n: -1, pad: 'x'.repeat(400000) }), 'utf8');

  const script = `
    const fs=require('node:fs');
    const {writeFileAtomic}=require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'lock.js'))});
    const file=${JSON.stringify(file)};
    for (let i=0;i<80;i++) writeFileAtomic(file, JSON.stringify({n:i, pad:'x'.repeat(400000)}));
  `;

  let partial = 0;
  let reads = 0;
  await new Promise(resolve => {
    const child = spawn('node', ['-e', script], { stdio: 'ignore' });
    let done = false;
    child.on('exit', () => { done = true; resolve(); });
    const tick = () => {
      if (done) return;
      try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch { partial++; }
      reads++;
      setImmediate(tick);
    };
    tick();
  });

  assert.ok(reads > 20, `reader got only ${reads} samples — too few to mean anything`);
  assert.strictEqual(partial, 0, `reader saw ${partial} truncated reads out of ${reads}`);
});
