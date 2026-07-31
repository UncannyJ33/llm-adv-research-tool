'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fromResult, htmlToText } = require('../lib/retrieve/web');

test('web records carry kind=web and a source class', () => {
  const r = fromResult({ url: 'https://ziglang.org/documentation/master/', title: 'Zig Docs' });
  assert.strictEqual(r.kind, 'web');
  assert.strictEqual(r.source_class, 'official-docs');
  assert.strictEqual(r.work_type, 'page');
  assert.deepStrictEqual(r.retrieved_from, ['web']);
});

test('an unrecognized host classifies as community, never as primary', () => {
  assert.strictEqual(fromResult({ url: 'https://randomblog.example/post' }).source_class, 'community');
});

test('web records are never marked indexed or preprint', () => {
  const r = fromResult({ url: 'https://github.com/ziglang/zig' });
  assert.strictEqual(r.venue.is_indexed, false);
  assert.strictEqual(r.is_preprint, false);
});

test('page text becomes the abstract so the quote gate has something to check', () => {
  assert.strictEqual(fromResult({ url: 'https://x.dev/a', text: 'Body text here.' }).abstract, 'Body text here.');
});

test('falls back to the snippet when no full text was fetched', () => {
  assert.strictEqual(fromResult({ url: 'https://x.dev/a', snippet: 'just a snippet' }).abstract, 'just a snippet');
});

test('htmlToText drops script, style and tags but keeps readable text', () => {
  const html = '<html><head><style>p{}</style><script>var x=1;</script></head><body><h1>Title</h1><p>Hello  world</p></body></html>';
  const text = htmlToText(html);
  assert.ok(text.includes('Title'));
  assert.ok(text.includes('Hello world'));
  assert.ok(!text.includes('var x'));
  assert.ok(!text.includes('p{}'));
});

test('htmlToText decodes entities', () => {
  assert.strictEqual(htmlToText('<p>A &amp; B &lt;c&gt;</p>'), 'A & B <c>');
});

test('a missing url still produces a usable record', () => {
  const r = fromResult({ title: 'no url' });
  assert.strictEqual(r.source_class, 'community');
  assert.strictEqual(r.url, null);
});

test('a malformed url does not throw', () => {
  assert.doesNotThrow(() => fromResult({ url: 'not a url' }));
  assert.strictEqual(fromResult({ url: 'not a url' }).venue.name, null);
});

test('htmlToText on non-string returns empty', () => {
  assert.strictEqual(htmlToText(null), '');
});
