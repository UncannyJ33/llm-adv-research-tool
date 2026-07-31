'use strict';

// Single-source term detection.
//
// The tool searches the question's WORDS, not its CONCEPT. That fails in two directions:
// too broad (an astrophysics instrument named BRAIN), and too narrow — a term coined by one
// organization only ever returns that organization.
//
// The second is the dangerous one, because it looks like a finding. "Sparse literature,
// mostly one lab" reads as "under-studied phenomenon" when it may be "well-studied phenomenon
// under a different name". The corpus confirms a sparsity the terminology itself created.
//
// This module detects that mechanically, reusing the same shape as the independence check
// (§8.7.3) but at organization level rather than author level.

const { normalizeAuthor } = require('./independence');

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Attributes a source to an origin: a hostname for web sources, an author cluster for
// academic ones. Author-level is a proxy for lab/group, which is the unit that coins terms.
function orgOf(rec) {
  if (rec.kind === 'web' && rec.url) return hostOf(rec.url);
  const first = (rec.authors || []).map(normalizeAuthor).filter(Boolean)[0];
  return first ? `author:${first}` : null;
}

function concentration(records) {
  const counts = new Map();
  let attributed = 0;

  for (const rec of records) {
    const org = orgOf(rec);
    if (!org) continue;
    counts.set(org, (counts.get(org) || 0) + 1);
    attributed++;
  }

  let dominant = null;
  let max = 0;
  for (const [org, n] of counts) {
    if (n > max) { max = n; dominant = org; }
  }

  return {
    dominant,
    share: attributed ? max / attributed : 0,
    total: records.length,
    attributed,
    origins: counts.size,
  };
}

// A term written with a hyphen in one source and a space in another is the same term.
function mentionsTerm(rec, term) {
  const norm = s => String(s || '').toLowerCase().replace(/[-\s]+/g, ' ');
  const haystack = `${norm(rec.title)} ${norm(rec.abstract)}`;
  return haystack.includes(norm(term));
}

const DOMINANCE_THRESHOLD = 0.7;
const MIN_MATCHING = 3;

function detectSingleSource(term, records, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : DOMINANCE_THRESHOLD;
  const matching = records.filter(r => mentionsTerm(r, term));

  // Nothing to judge: the term is absent from the corpus entirely.
  if (matching.length === 0) {
    return {
      term,
      singleSource: false,
      inconclusive: true,
      matching: 0,
      dominant: null,
      share: 0,
      reason: `No source in the corpus mentions "${term}", so its provenance cannot be `
        + 'assessed. If the term is central to the question, retrieval missed it.',
    };
  }

  const c = concentration(matching);

  // A term carried by ONE origin is single-source regardless of how few sources mention it.
  // Requiring a minimum count here inverted the signal: one source from one origin is more
  // concentrated than three, not less, and that is precisely the vendor-coined case.
  if (c.origins === 1 && c.attributed > 0) {
    return {
      term,
      singleSource: true,
      inconclusive: false,
      matching: matching.length,
      dominant: c.dominant,
      share: 1,
      origins: 1,
      lowSample: matching.length < MIN_MATCHING,
      sourceIds: matching.map(r => r.id),
      reason: `Every source mentioning "${term}" (${matching.length}) originates from `
        + `${c.dominant}. The term appears to be owned by one party, so its apparent sparsity `
        + 'may be an artifact of naming rather than of the phenomenon. Search the concept\'s '
        + 'other names before concluding the literature is thin.',
    };
  }

  // Multiple origins but too few sources to read a distribution.
  if (matching.length < MIN_MATCHING) {
    return {
      term,
      singleSource: false,
      inconclusive: true,
      matching: matching.length,
      dominant: c.dominant,
      share: c.share,
      origins: c.origins,
      reason: `Only ${matching.length} sources mention "${term}", across ${c.origins} origins `
        + '— too few to judge concentration either way.',
    };
  }

  const singleSource = c.share >= threshold;

  return {
    term,
    singleSource,
    inconclusive: false,
    matching: matching.length,
    dominant: c.dominant,
    share: c.share,
    origins: c.origins,
    sourceIds: matching.map(r => r.id),
    reason: singleSource
      ? `${Math.round(c.share * 100)}% of the ${matching.length} sources mentioning "${term}" `
        + `originate from ${c.dominant}. The term may be owned by one party, so its apparent `
        + 'sparsity could be an artifact of naming rather than of the phenomenon. Search the '
        + "concept's other names before concluding the literature is thin."
      : `Sources mentioning "${term}" span ${c.origins} origins; no single origin dominates.`,
  };
}

module.exports = {
  orgOf, hostOf, concentration, mentionsTerm, detectSingleSource,
  DOMINANCE_THRESHOLD, MIN_MATCHING,
};
