'use strict';
const { makeRecord } = require('../corpus');
const { classifyWebSource } = require('../domains');
const { hostnameOf } = require('./web');
const { fetchJson } = require('./http');

const API = 'https://api.github.com/search/issues';

function normalize(raw) {
  const year = /^\d{4}/.test(raw.created_at || '') ? parseInt(raw.created_at.slice(0, 4), 10) : null;
  const url = raw.html_url || null;

  return makeRecord({
    kind: 'web',
    url,
    title: raw.title || '',
    abstract: raw.body || '',
    authors: raw.user && raw.user.login ? [raw.user.login] : [],
    year,
    work_type: 'page',
    is_preprint: false,
    // Must go through the classifier, not a hardcoded 'repo-discussion': an issue-search hit
    // can be an issue, a PR, or (if the URL rules ever change) something else, and the
    // authority table is the one place that decides what a GitHub URL shape counts as.
    source_class: classifyWebSource(url),
    venue: { name: hostnameOf(url), type: 'web', is_indexed: false },
    // Deliberately 0, NOT raw.comments. lib/slice.js ranks by citation_count to pick the
    // shared core every perspective reads, so a 200-comment bug thread outranked every paper
    // with fewer than 200 citations for a seat in it. Comment volume is how much argument a
    // thread attracted; citation count is how much corroboration a work attracted. They are
    // not the same quantity and must not share a field.
    citation_count: 0,
    retrieved_from: ['github'],
  });
}

async function search(query, opts = {}) {
  const url = `${API}?q=${encodeURIComponent(query)}&per_page=${opts.limit || 25}&sort=updated&order=desc`;
  const headers = { 'User-Agent': 'llm-adv-research-tool' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const json = await fetchJson(url, { headers, label: 'github' });
  return json.items || [];
}

module.exports = { normalize, search };
