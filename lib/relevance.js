'use strict';

// Keyword retrieval matches on bare tokens, which produced two symmetric failures in the
// first real run: an astrophysics instrument named BRAIN, a Metro Manila road network
// matched on "hub", wireless erasure codes matched on "broadcast", and five figure captions
// from a single paper listed as separate sources.
//
// This module screens retrieval output before it reaches the corpus. It is deliberately
// FAIL-OPEN: when it cannot judge, it keeps. A thin corpus is worse than a slightly noisy one,
// and every exclusion is recorded with a reason so over-filtering is visible in the ledger.

const PARATEXT_TITLE = [
  /^\s*(figure|fig\.?|table|chart|scheme|plate)\s*\d*\s*[:.]/i,
  /^\s*(supplement(al|ary)?|supporting information)\b/i,
  /^\s*(references|bibliography|appendix|index|acknowledg(e)?ments)\b/i,
  /^\s*(front|back)\s+matter\b/i,
  /^\s*(table of contents|contents|editorial board|masthead)\b/i,
];

const PARATEXT_WORK_TYPES = new Set([
  'figure', 'table', 'dataset-figure', 'supplementary-materials', 'paratext',
  'erratum', 'editorial', 'letter', 'other', 'peer-review', 'grant',
  'reference-entry', 'component',
]);

function isParatext(rec) {
  const title = String(rec.title || '').trim();
  if (!title) return true;
  if (PARATEXT_WORK_TYPES.has(String(rec.work_type || '').toLowerCase())) return true;
  return PARATEXT_TITLE.some(re => re.test(title));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'has', 'have',
  'its', 'their', 'they', 'not', 'but', 'can', 'may', 'via', 'into', 'onto', 'per', 'our',
  'using', 'used', 'use', 'new', 'novel', 'study', 'studies', 'analysis', 'approach',
  'based', 'toward', 'towards', 'between', 'across', 'within', 'during', 'about',
]);

function contentTokens(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOPWORDS.has(t))
  )];
}

// Morphological near-match, so "connectivity" reaches "connectome" and "connected".
// Exact-token overlap alone drops legitimately synonymous vocabulary across subfields.
const STEM_MIN = 5;
function tokenMatches(a, b) {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= STEM_MIN && longer.startsWith(shorter.slice(0, STEM_MIN));
}

function anyMatch(token, tokenSet) {
  for (const t of tokenSet) if (tokenMatches(token, t)) return true;
  return false;
}

// Returns both a weighted score and the count of DISTINCT query concepts matched. The count
// is the real discriminator: one shared token is coincidence ("hub" carried a Metro Manila
// road network into a neuroscience corpus), two or more is topicality.
function relevanceScore(rec, query) {
  const q = contentTokens(query);
  if (!q.length) return 1;

  const titleTokens = new Set(contentTokens(rec.title));
  const bodyTokens = new Set(contentTokens(rec.abstract));

  let score = 0;
  for (const t of q) {
    if (anyMatch(t, titleTokens)) score += 2;
    else if (anyMatch(t, bodyTokens)) score += 1;
  }
  return score / (q.length * 2);
}

// Structurally generic vocabulary. These describe the SHAPE of a system, not its subject,
// so they are shared by every field that studies networks. A Metro Manila road-network paper
// matched "hub" and "network" against a neuroscience query and passed the two-concept rule —
// generic tokens alone can never establish topicality.
const GENERIC_TOKENS = new Set([
  'network', 'networks', 'hub', 'hubs', 'node', 'nodes', 'graph', 'graphs', 'edge', 'edges',
  'model', 'models', 'modeling', 'modelling', 'system', 'systems', 'architecture',
  'architectures', 'structure', 'structures', 'structural', 'dynamics', 'dynamic',
  'organization', 'organisation', 'topology', 'topological', 'cluster', 'clustering',
  'centrality', 'complex', 'information', 'data', 'method', 'methods', 'framework',
  'theory', 'theories', 'identification', 'performance', 'index',
  'measure', 'measures', 'measurement',
  // NOT generic, deliberately: connectivity / connectome / connected. They read as generic
  // network vocabulary, but in neuroscience they are the subject term, and marking them
  // generic filtered out the rich-club connectome paper — a real source — while doing
  // nothing to exclude the road-network paper, whose abstract contains no "connect*" at all.
]);

function isGeneric(token) {
  return GENERIC_TOKENS.has(token);
}

// Returns matched query tokens split by whether they anchor a subject or merely describe
// a shape.
function matchDetail(rec, query) {
  const q = contentTokens(query);
  const tokens = new Set([...contentTokens(rec.title), ...contentTokens(rec.abstract)]);
  const matched = q.filter(t => anyMatch(t, tokens));
  return {
    matched,
    specific: matched.filter(t => !isGeneric(t)),
    generic: matched.filter(isGeneric),
    querySpecificCount: q.filter(t => !isGeneric(t)).length,
  };
}

function matchedConcepts(rec, query) {
  return matchDetail(rec, query).matched.length;
}

const DEFAULT_THRESHOLD = 0.12;
const MIN_QUERY_TOKENS = 3;
// Below this many query tokens, demanding two distinct matches is too strict to be fair.
const MIN_TOKENS_FOR_CONCEPT_RULE = 4;
const MIN_CONCEPTS = 2;

function screen(records, query, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : DEFAULT_THRESHOLD;
  const protect = new Set(opts.protect || []);
  const qTokens = contentTokens(query);

  const kept = [];
  const filtered = [];

  for (const rec of records) {
    // A human deliberately added this source. Do not second-guess it.
    if (protect.has(rec.id) || rec.kind === 'web') {
      kept.push(rec);
      continue;
    }

    if (isParatext(rec)) {
      rec.admissible = false;
      rec.exclusion_reason = String(rec.title || '').trim()
        ? `Paratext, not a readable source: "${String(rec.title).slice(0, 80)}".`
        : 'Paratext: record has no title, so it cannot be read or judged.';
      filtered.push(rec);
      continue;
    }

    // Fail open: too little query signal to judge relevance at all.
    if (qTokens.length < MIN_QUERY_TOKENS) {
      kept.push(rec);
      continue;
    }

    const score = relevanceScore(rec, query);
    const detail = matchDetail(rec, query);
    const concepts = detail.matched.length;

    // One shared token is coincidence, not topicality.
    if (qTokens.length >= MIN_TOKENS_FOR_CONCEPT_RULE && concepts < MIN_CONCEPTS) {
      rec.admissible = false;
      rec.exclusion_reason = concepts === 0
        ? 'Low relevance: shares no concept with the research question.'
        : 'Low relevance: matches only one query concept, which is coincidental overlap '
          + 'rather than topical match.';
      filtered.push(rec);
      continue;
    }

    // Generic structural vocabulary cannot establish topicality on its own. Only applied
    // when the query HAS subject-anchoring terms to match against.
    if (detail.querySpecificCount > 0 && detail.specific.length === 0) {
      rec.admissible = false;
      rec.exclusion_reason = 'Low relevance: matches only generic structural vocabulary '
        + `(${detail.generic.join(', ')}) and no subject term from the question. `
        + 'Shape words like "network" and "hub" are shared across unrelated fields.';
      filtered.push(rec);
      continue;
    }

    if (score < threshold) {
      rec.admissible = false;
      rec.exclusion_reason = `Low relevance to the query (score ${score.toFixed(2)} < ${threshold}); `
        + 'title and abstract share too little with the research question.';
      filtered.push(rec);
      continue;
    }

    rec.relevance = score;
    rec.matched_concepts = concepts;
    kept.push(rec);
  }

  return { kept, filtered };
}

module.exports = {
  isParatext, contentTokens, relevanceScore, matchedConcepts, matchDetail, isGeneric, tokenMatches, screen,
  PARATEXT_TITLE, PARATEXT_WORK_TYPES, GENERIC_TOKENS, DEFAULT_THRESHOLD,
};
