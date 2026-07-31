'use strict';
const { makeRecord } = require('../corpus');
const { classifyWebSource } = require('../domains');

// Web is a FIRST-CLASS retrieval path (spec §7.1), not a fallback. For software, policy and
// current-events questions the primary sources live here — which is exactly why the domain's
// authority table, not the retrieval channel, decides what counts as primary.

function htmlToText(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostnameOf(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function fromResult({ url = null, title = '', snippet = '', text = '' } = {}) {
  return makeRecord({
    kind: 'web',
    url,
    title: title || '',
    abstract: text || snippet || '',
    work_type: 'page',
    is_preprint: false,
    source_class: classifyWebSource(url),
    venue: { name: hostnameOf(url), type: 'web', is_indexed: false },
    retrieved_from: ['web'],
  });
}

module.exports = { fromResult, htmlToText, hostnameOf };
