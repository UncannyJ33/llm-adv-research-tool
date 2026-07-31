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
