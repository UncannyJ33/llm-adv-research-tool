'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Corpus and ledger writes are read-modify-write against a whole file. Two concurrent
// processes each load the same state, each assigns ids from the same counter, and the second
// save silently overwrites the first — a classic lost update.
//
// Two subagents issuing `search` in parallel observed exactly this: the same id resolved to
// different papers minutes apart. That is the worst failure this tool can have, because a
// claim verified against S139 could end up citing a different paper than the one checked, and
// nothing downstream would notice.
//
// mkdir is atomic on POSIX and on Windows, which makes it a correct mutex primitive without
// a dependency.

const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_MS = 25;
const STALE_MS = 60000;

function lockPath(dir) {
  return path.join(dir, '.lock');
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(dir, timeoutMs) {
  const lp = lockPath(dir);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      fs.mkdirSync(lp);
      fs.writeFileSync(path.join(lp, 'pid'), String(process.pid), 'utf8');
      return lp;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      // A crashed process leaves its lock behind. Reclaim it rather than deadlocking the
      // run forever, but only well after any plausible legitimate hold.
      try {
        const age = Date.now() - fs.statSync(lp).mtimeMs;
        if (age > STALE_MS) {
          fs.rmSync(lp, { recursive: true, force: true });
          continue;
        }
      } catch { /* the holder released it between our check and stat; just retry */ }

      if (Date.now() > deadline) {
        throw new Error(
          `timed out after ${timeoutMs}ms waiting for the run lock at ${lp}. `
          + 'Another research process is writing to this run.'
        );
      }
      sleepSync(RETRY_MS);
    }
  }
}

// Runs fn while holding an exclusive lock on the run directory. fn MUST load the state it
// mutates from disk itself — state read before the lock was taken may already be stale.
function withLock(dir, fn, opts = {}) {
  const lp = acquire(dir, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    fs.rmSync(lp, { recursive: true, force: true });
  }
}

module.exports = { withLock, acquire, lockPath, STALE_MS };
