'use strict';
const { contentTokens } = require('./relevance');

// Slicing makes divergence possible; this measures whether it actually happened.
//
// Two perspectives given different sources can still write the same notes, which makes a run
// LOOK multi-perspective while being single-perspective repeated. That failure is invisible
// in the output — the brief simply reads as well-corroborated when it is not.
//
// Bigrams rather than single tokens: notes within one field share most of their vocabulary,
// so unigram overlap reads high even for genuinely different arguments.

const DEFAULT_OVERLAP = 0.45;

function bigrams(text) {
  const t = contentTokens(text);
  if (t.length < 2) return new Set(t);
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(`${t[i]} ${t[i + 1]}`);
  return out;
}

function noteSimilarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function findCollapsed(notes, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : DEFAULT_OVERLAP;
  const pairs = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const score = noteSimilarity(notes[i].text, notes[j].text);
      if (score >= threshold) pairs.push({ a: notes[i].id, b: notes[j].id, score });
    }
  }
  // Worst offender first, so an orchestrator re-running one perspective picks the right one.
  return pairs.sort((x, y) => y.score - x.score);
}

module.exports = { noteSimilarity, findCollapsed, bigrams, DEFAULT_OVERLAP };
