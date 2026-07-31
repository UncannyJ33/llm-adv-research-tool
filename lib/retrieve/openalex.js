'use strict';
const { makeRecord } = require('../corpus');

// Reference adapter. Every retrieval module splits into a thin `fetch` layer and a pure
// `normalize()` — tests cover normalize() against stored fixtures, never the network.

const API = 'https://api.openalex.org';
const MAILTO = process.env.RESEARCH_MAILTO || 'research-tool@localhost';
const UA = `llm-adv-research-tool (${MAILTO})`;

function invertAbstract(index) {
  if (!index || typeof index !== 'object') return '';
  const slots = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) slots[p] = word;
  }
  return slots.filter(w => w !== undefined).join(' ');
}

function strip(value, prefix) {
  return typeof value === 'string' ? value.replace(prefix, '') : null;
}

// OpenAlex does NOT return `is_indexed_in_scopus` on /works. Reading it yielded
// Boolean(undefined) === false for every record, which demoted Journal of Neuroscience and
// Frontiers in Psychology to `secondary` — so nothing reached `primary`, every claim came
// back weakened, and the confidence marker degraded into noise.
//
// The fields OpenAlex actually returns are `type`, `issn_l`, `issn`, `is_core`, `is_in_doaj`.
// A journal or conference venue carrying an ISSN, or flagged as an OpenAlex core source, is
// a real indexed venue.
function venueIsIndexed(src) {
  const type = src.type || null;
  if (type !== 'journal' && type !== 'conference') return false;
  const hasIssn = Boolean(src.issn_l || (Array.isArray(src.issn) && src.issn.length));
  return Boolean(src.is_core || hasIssn);
}

function normalize(raw) {
  const loc = raw.primary_location || {};
  const src = loc.source || {};
  const type = raw.type || 'article';
  return makeRecord({
    kind: 'academic',
    openalex_id: strip(raw.id, 'https://openalex.org/'),
    doi: strip(raw.doi, 'https://doi.org/'),
    pmid: strip(raw.ids && raw.ids.pmid, 'https://pubmed.ncbi.nlm.nih.gov/'),
    title: raw.title || raw.display_name || '',
    authors: (raw.authorships || [])
      .map(a => a && a.author && a.author.display_name)
      .filter(Boolean),
    year: raw.publication_year || null,
    venue: {
      name: src.display_name || null,
      type: src.type || null,
      is_indexed: venueIsIndexed(src),
    },
    abstract: invertAbstract(raw.abstract_inverted_index),
    work_type: type,
    is_preprint: type === 'preprint',
    citation_count: raw.cited_by_count || 0,
    oa_pdf_url: (raw.best_oa_location && raw.best_oa_location.pdf_url) || loc.pdf_url || null,
    url: loc.landing_page_url || null,
    retracted: Boolean(raw.is_retracted),
    retrieved_from: ['openalex'],
  });
}

async function search(query, opts = {}) {
  const url = `${API}/works?search=${encodeURIComponent(query)}`
    + `&per-page=${opts.limit || 25}`
    + `&mailto=${encodeURIComponent(MAILTO)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`openalex ${res.status}`);
  const json = await res.json();
  return json.results || [];
}

// Spec §8.7.1 — citation health needs the works that CITE a source. A paper with 400
// citations reading "X reported this, but we did not observe it" is a fundamentally
// different object from one with 400 supportive citations, and no recency scan sees it.
async function citingWorks(openalexId, limit = 25) {
  const url = `${API}/works?filter=cites:${encodeURIComponent(openalexId)}`
    + `&per-page=${limit}`
    + `&sort=publication_date:desc`
    + `&mailto=${encodeURIComponent(MAILTO)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`openalex citing ${res.status}`);
  const json = await res.json();
  return json.results || [];
}

module.exports = { normalize, search, citingWorks, invertAbstract, venueIsIndexed };
