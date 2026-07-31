'use strict';
const { makeRecord } = require('../corpus');

const API = 'https://api.crossref.org';
const MAILTO = process.env.RESEARCH_MAILTO || 'research-tool@localhost';

function stripJats(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Spec §8.6: retracted sources are excluded outright, but retained in the rejected-source
// ledger WITH the notice DOI — why a paper was pulled is often the interesting part.
function isRetracted(item) {
  const updates = (item && item['update-to']) || [];
  const r = updates.find(u => String(u && u.type || '').toLowerCase() === 'retraction');
  return { retracted: Boolean(r), noticeDoi: r ? r.DOI || null : null };
}

function normalize(raw) {
  const type = raw.type || 'journal-article';
  const isPreprint = type === 'posted-content';
  const parts = (raw.issued && raw.issued['date-parts'] && raw.issued['date-parts'][0]) || [];
  const { retracted, noticeDoi } = isRetracted(raw);

  return makeRecord({
    kind: 'academic',
    doi: raw.DOI || null,
    title: Array.isArray(raw.title) ? raw.title[0] || '' : raw.title || '',
    authors: (raw.author || [])
      .map(a => [a.given, a.family].filter(Boolean).join(' ').trim())
      .filter(Boolean),
    year: parts[0] || null,
    venue: {
      name: Array.isArray(raw['container-title']) ? raw['container-title'][0] || null : null,
      type: 'journal',
      is_indexed: !isPreprint && Boolean(raw['container-title'] && raw['container-title'][0]),
    },
    abstract: stripJats(raw.abstract),
    work_type: type === 'journal-article' ? 'article' : (isPreprint ? 'preprint' : type),
    is_preprint: isPreprint,
    citation_count: raw['is-referenced-by-count'] || 0,
    retracted,
    retraction_notice_doi: noticeDoi,
    retrieved_from: ['crossref'],
  });
}

async function search(query, opts = {}) {
  const url = `${API}/works?query=${encodeURIComponent(query)}`
    + `&rows=${opts.limit || 25}&mailto=${encodeURIComponent(MAILTO)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': `llm-adv-research-tool (${MAILTO})` },
  });
  if (!res.ok) throw new Error(`crossref ${res.status}`);
  const json = await res.json();
  return (json.message && json.message.items) || [];
}

module.exports = { normalize, search, isRetracted, stripJats };
