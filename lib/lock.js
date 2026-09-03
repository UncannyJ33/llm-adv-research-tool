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

// The other half of the same invariant. The lock serialises *writers*, but a whole-file save
// is a truncate followed by a write, and every reader outside the lock can observe the gap:
// `loadRun` in bin/research.js parses run.json before it acquires anything. A parallel ingest
// test failed exactly this way — "Unexpected end of JSON input" out of RunState.load, from a
// file that was perfectly valid a millisecond later.
//
// rename(2) is atomic within a filesystem, so a reader sees either the whole old file or the
// whole new one. Never a prefix.
function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    // Leaving a stray .tmp- sibling behind would make `list` and any future directory scan
    // ambiguous about what a run contains.
    try { fs.rmSync(tmp, { force: true }); } catch { /* already gone */ }
    throw err;
  }
}

module.exports = { withLock, acquire, lockPath, writeFileAtomic, STALE_MS };
