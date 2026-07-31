'use strict';
const { makeRecord } = require('../corpus');
const { fetchText } = require('./http');

// arXiv is the only non-JSON source. A hand-rolled Atom entry extractor keeps the
// zero-dependency constraint; it is tested against a stored fixture so fragility surfaces
// as a test failure rather than a silently empty corpus.

const API = 'http://export.arxiv.org/api/query';

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textOf(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : null;
}

function parseFeed(xml) {
  if (typeof xml !== 'string' || !xml.includes('<entry')) return [];
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/g) || [];

  return entries.map(block => {
    const authors = [];
    for (const a of block.match(/<author>[\s\S]*?<\/author>/g) || []) {
      const n = textOf(a, 'name');
      if (n) authors.push(n);
    }

    let pdfUrl = null;
    for (const l of block.match(/<link[^>]*\/>/g) || []) {
      if (/type="application\/pdf"/.test(l)) {
        const href = l.match(/href="([^"]+)"/);
        if (href) pdfUrl = decode(href[1]);
      }
    }

    return {
      id: textOf(block, 'id'),
      title: textOf(block, 'title'),
      summary: textOf(block, 'summary'),
      published: textOf(block, 'published'),
      doi: textOf(block, 'arxiv:doi'),
      authors,
      pdfUrl,
    };
  });
}

function normalize(raw) {
  const idMatch = String(raw.id || '').match(/abs\/(.+)$/);
  const bare = idMatch ? idMatch[1].replace(/v\d+$/, '') : null;
  const year = raw.published ? parseInt(String(raw.published).slice(0, 4), 10) : null;

  return makeRecord({
    kind: 'academic',
    arxiv_id: bare,
    doi: raw.doi || null,
    url: raw.id || null,
    title: raw.title || '',
    authors: raw.authors || [],
    year: Number.isFinite(year) ? year : null,
    venue: { name: 'arXiv', type: 'repository', is_indexed: false },
    abstract: raw.summary || '',
    work_type: 'preprint',
    is_preprint: true,
    oa_pdf_url: raw.pdfUrl || null,
    retrieved_from: ['arxiv'],
  });
}

async function search(query, opts = {}) {
  const url = `${API}?search_query=all:${encodeURIComponent(query)}`
    + `&start=0&max_results=${opts.limit || 25}&sortBy=relevance`;
  return parseFeed(await fetchText(url, { label: 'arxiv' }));
}

module.exports = { parseFeed, normalize, search };
