'use strict';
const { contentTokens } = require('./relevance');

// Perspective diversity cannot be requested in a prompt and trusted. Each perspective gets a
// genuinely different slice of the corpus, decided in code.
//
// A SHARED CORE of the most-cited sources goes to every slice: withholding foundational work
// would cripple a perspective rather than diversify it. Only the remainder is partitioned.

function similarity(a, b) {
  const A = new Set(contentTokens(a));
  const B = new Set(contentTokens(b));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const textOf = r => `${r.title || ''} ${r.abstract || ''}`;

// A slice is named for what makes its seed distinctive relative to the other seeds, so the
// labels describe the axis of difference rather than the shared subject.
function labelFor(seed, otherSeeds) {
  const seedTokens = contentTokens(textOf(seed));
  const common = new Set();
  for (const o of otherSeeds) for (const t of contentTokens(textOf(o))) common.add(t);
  const distinctive = seedTokens.filter(t => !common.has(t));
  return (distinctive.length ? distinctive : seedTokens).slice(0, 3).join('-') || seed.id;
}

function sliceCorpus(records, k, opts = {}) {
  if (!records || !records.length || k < 1) return { shared: [], slices: [] };

  const sharedCount = opts.sharedCount != null
    ? opts.sharedCount
    : Math.min(3, Math.floor(records.length * 0.1));

  // Stable ordering first, so the result does not depend on retrieval order.
  const ordered = [...records].sort((a, b) =>
    (b.citation_count || 0) - (a.citation_count || 0) || String(a.id).localeCompare(String(b.id)));

  const shared = ordered.slice(0, sharedCount).map(r => r.id);
  const rest = ordered.slice(sharedCount);

  if (!rest.length) {
    return { shared, slices: [{ index: 0, label: 'all', seedId: null, sourceIds: [...shared] }] };
  }

  const n = Math.min(k, rest.length);

  // Seeds chosen to be maximally dissimilar: each new seed minimises its GREATEST similarity
  // to the seeds already chosen, which spreads them across the corpus rather than clustering.
  const seeds = [rest[0]];
  while (seeds.length < n) {
    let best = null;
    let bestScore = Infinity;
    for (const cand of rest) {
      if (seeds.includes(cand)) continue;
      const worst = Math.max(...seeds.map(s => similarity(textOf(cand), textOf(s))));
      if (worst < bestScore) { bestScore = worst; best = cand; }
    }
    if (!best) break;
    seeds.push(best);
  }

  const buckets = seeds.map(() => []);
  for (const r of rest) {
    const si = seeds.indexOf(r);
    if (si >= 0) { buckets[si].push(r.id); continue; }
    let bestIdx = 0;
    let bestSim = -1;
    seeds.forEach((s, i) => {
      const sim = similarity(textOf(r), textOf(s));
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    });
    buckets[bestIdx].push(r.id);
  }

  const slices = seeds
    .map((seed, i) => ({
      index: i,
      seedId: seed.id,
      label: labelFor(seed, seeds.filter((_, j) => j !== i)),
      sourceIds: [...shared, ...buckets[i]],
    }))
    .filter(s => s.sourceIds.length > 0);

  return { shared, slices };
}

module.exports = { sliceCorpus, similarity, labelFor };
