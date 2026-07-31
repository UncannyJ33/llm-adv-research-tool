'use strict';
const { makeRecord } = require('../corpus');
const { fetchJson } = require('./http');

const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

function splitAuthors(s) {
  if (!s || typeof s !== 'string') return [];
  return s.replace(/\.$/, '').split(',').map(a => a.trim()).filter(Boolean);
}

function normalize(raw) {
  const pubType = String(raw.pubType || '').toLowerCase();
  const isPreprint = raw.source === 'PPR' || pubType.includes('preprint');
  const workType = pubType.includes('review')
    ? 'review'
    : (isPreprint ? 'preprint' : 'article');
  const urls = (raw.fullTextUrlList && raw.fullTextUrlList.fullTextUrl) || [];
  const pdf = urls.find(u => u && u.documentStyle === 'pdf');

  return makeRecord({
    kind: 'academic',
    pmid: raw.pmid || null,
    doi: raw.doi || null,
    title: raw.title || '',
    authors: splitAuthors(raw.authorString),
    year: raw.pubYear ? parseInt(raw.pubYear, 10) : null,
    venue: {
      name: raw.journalTitle || null,
      type: 'journal',
      is_indexed: raw.source === 'MED',
    },
    abstract: raw.abstractText || '',
    work_type: workType,
    is_preprint: isPreprint,
    citation_count: raw.citedByCount || 0,
    oa_pdf_url: pdf ? pdf.url : null,
    retrieved_from: ['europepmc'],
  });
}

async function search(query, opts = {}) {
  const url = `${API}/search?query=${encodeURIComponent(query)}`
    + `&format=json&pageSize=${opts.limit || 25}&resultType=core`;
  const json = await fetchJson(url, { label: 'europepmc' });
  return (json.resultList && json.resultList.result) || [];
}

module.exports = { normalize, search, splitAuthors };
