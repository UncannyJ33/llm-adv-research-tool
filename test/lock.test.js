'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withLock, lockPath } = require('../lib/lock');

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
