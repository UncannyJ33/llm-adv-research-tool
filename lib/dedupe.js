'use strict';

// Canonical-key priority (spec §7.1): DOI -> PMID -> arXiv id -> normalized title+year,
// with title similarity for near-duplicates. Merged ids are retained on the surviving
// record so provenance is never lost.

function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalKey(rec) {
  if (rec.doi) {
    return `doi:${String(rec.doi).replace(/^https?:\/\/doi\.org\//i, '').toLowerCase()}`;
  }
  if (rec.pmid) return `pmid:${rec.pmid}`;
  if (rec.arxiv_id) return `arxiv:${String(rec.arxiv_id).replace(/v\d+$/, '')}`;
  return `title:${normalizeTitle(rec.title)}|${rec.year || ''}`;
}

function tokens(s) {
  return new Set(normalizeTitle(s).split(' ').filter(Boolean));
}

function titleSimilarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Richer record wins, so a sparse Crossref stub never overwrites a full OpenAlex record
// just by arriving first.
function richness(r) {
  let n = 0;
  if (r.abstract) n += 3;
  if (r.oa_pdf_url) n += 2;
  if (r.authors && r.authors.length) n += 1;
  if (r.venue && r.venue.name) n += 1;
  if (r.citation_count) n += 1;
  if (r.doi) n += 1;
  return n;
}

function absorb(winner, loser) {
  winner.dedupe_merged_ids = [...new Set([...(winner.dedupe_merged_ids || []), loser.id])];
  winner.retrieved_from = [...new Set([
    ...(winner.retrieved_from || []),
    ...(loser.retrieved_from || []),
  ])];

  for (const k of ['doi', 'pmid', 'arxiv_id', 'openalex_id', 'oa_pdf_url', 'url', 'abstract', 'year']) {
    if (!winner[k] && loser[k]) winner[k] = loser[k];
  }
  if (!winner.venue.name && loser.venue && loser.venue.name) winner.venue = loser.venue;
  if ((loser.citation_count || 0) > (winner.citation_count || 0)) {
    winner.citation_count = loser.citation_count;
  }
  // A retraction found on ANY duplicate must survive the merge — losing it here would
  // silently readmit a withdrawn paper.
  if (loser.retracted) {
    winner.retracted = true;
    winner.retraction_notice_doi = winner.retraction_notice_doi || loser.retraction_notice_doi;
  }
  return winner;
}

function dedupe(records, opts = {}) {
  const threshold = opts.titleThreshold || 0.9;
  const kept = [];
  const merged = [];

  for (const rec of records) {
    const key = canonicalKey(rec);
    let target = kept.find(k => canonicalKey(k) === key);

    if (!target) {
      target = kept.find(k =>
        k.year && rec.year && k.year === rec.year &&
        titleSimilarity(k.title, rec.title) >= threshold);
    }

    if (!target) {
      kept.push(rec);
      continue;
    }

    const winner = richness(rec) > richness(target) ? rec : target;
    const loser = winner === rec ? target : rec;
    if (winner === rec) kept[kept.indexOf(target)] = rec;
    absorb(winner, loser);
    merged.push(loser.id);
  }

  return { kept, merged };
}

module.exports = { canonicalKey, normalizeTitle, titleSimilarity, dedupe, richness };
