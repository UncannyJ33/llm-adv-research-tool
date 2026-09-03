'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fixture = require('./fixtures/github-issue.json');
const { normalize } = require('../lib/retrieve/github');

test('normalizes GitHub issue-search fields', () => {
  const r = normalize(fixture);
  assert.strictEqual(r.kind, 'web');
  assert.strictEqual(r.url, 'https://github.com/ziglang/zig/issues/7948');
  assert.strictEqual(r.title, 'zig comptime memoization broken with comptime slices');
  assert.strictEqual(r.year, 2021);
  assert.strictEqual(r.work_type, 'page');
  assert.strictEqual(r.is_preprint, false);
  assert.strictEqual(r.citation_count, 16);
  assert.deepStrictEqual(r.authors, ['marler8997']);
  assert.deepStrictEqual(r.retrieved_from, ['github']);
});

test('classifies an issue URL as repo-discussion, not source-repo', () => {
  assert.strictEqual(normalize(fixture).source_class, 'repo-discussion');
});

test('venue name is the forge hostname', () => {
  const r = normalize(fixture);
  assert.strictEqual(r.venue.name, 'github.com');
  assert.strictEqual(r.venue.type, 'web');
  assert.strictEqual(r.venue.is_indexed, false);
});

test('a null body becomes an empty string, not "null"', () => {
  const r = normalize({ ...fixture, body: null });
  assert.strictEqual(r.abstract, '');
});

test('a missing user yields no authors', () => {
  const { user, ...rest } = fixture;
  assert.deepStrictEqual(normalize(rest).authors, []);
});

test('survives a sparse record', () => {
  const r = normalize({});
  assert.deepStrictEqual(r.authors, []);
  assert.strictEqual(r.abstract, '');
  assert.strictEqual(r.url, null);
  assert.strictEqual(r.year, null);
  assert.strictEqual(r.citation_count, 0);
  assert.strictEqual(r.source_class, 'community');
});
