'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { listDomains, getTable, classifyWebSource } = require('../lib/domains');

test('ships the six spec domains', () => {
  const d = listDomains();
  for (const name of ['biomedical', 'physical_cs', 'software', 'economics_policy', 'history_humanities', 'current_events']) {
    assert.ok(d.includes(name), `missing domain ${name}`);
  }
});

test('every table has ordered tier rules ending in a catch-all', () => {
  for (const name of listDomains()) {
    const t = getTable(name);
    assert.ok(t.retrieval.length > 0, `${name} has no retrieval set`);
    assert.ok(t.tiers.length >= 2, `${name} needs at least two tiers`);
    const last = t.tiers[t.tiers.length - 1];
    assert.deepStrictEqual(last.match, {}, `${name} last rule must be a catch-all`);
  }
});

test('software domain treats specs and source repos as primary', () => {
  const t = getTable('software');
  const primary = t.tiers.find(r => r.tier === 'primary');
  assert.ok(primary.match.sourceClass.includes('spec'));
  assert.ok(primary.match.sourceClass.includes('source-repo'));
});

test('classifies authoritative URLs by source class', () => {
  assert.strictEqual(classifyWebSource('https://datatracker.ietf.org/doc/html/rfc9110'), 'rfc');
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig'), 'source-repo');
  assert.strictEqual(classifyWebSource('https://ziglang.org/documentation/master/'), 'official-docs');
  assert.strictEqual(classifyWebSource('https://www.federalreserve.gov/releases/h15/'), 'gov-statistical');
  assert.strictEqual(classifyWebSource('https://someguy.medium.com/my-take'), 'community');
});

test('unknown domain throws rather than silently defaulting', () => {
  assert.throws(() => getTable('astrology'), /unknown domain/i);
});

// A GitHub issue thread matched the bare `github.com` pattern and tiered `primary /
// official-source` under `software` — a stranger's comment carrying the same authority as
// the spec it contradicts. Discussion surfaces must be classified before the repo itself.
test('repo discussion threads are not official sources', () => {
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig/issues/1234'), 'repo-discussion');
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig/issues'), 'repo-discussion');
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig/pull/98#issuecomment-1'), 'repo-discussion');
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig/discussions/7'), 'repo-discussion');
  assert.strictEqual(classifyWebSource('https://gitlab.com/grp/proj/-/merge_requests/12'), 'repo-discussion');
  assert.strictEqual(classifyWebSource('https://codeberg.org/o/r/pulls/3'), 'repo-discussion');
});

test('the repo, its code and its releases stay authoritative', () => {
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig'), 'source-repo');
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig/blob/master/src/main.zig'), 'source-repo');
  assert.strictEqual(classifyWebSource('https://github.com/ziglang/zig/releases/tag/0.13.0'), 'source-repo');
});

// A journal volume at /issues/12 is not a bug tracker. The rule is anchored to the
// forge's owner/repo path shape precisely so it cannot reach across hosts.
test('the discussion rule does not leak onto non-forge urls', () => {
  assert.strictEqual(classifyWebSource('https://example.org/journal/issues/12'), 'community');
  assert.strictEqual(classifyWebSource('https://docs.python.org/3/whatsnew/3.12.html'), 'official-docs');
});
