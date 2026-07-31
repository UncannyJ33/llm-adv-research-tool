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

// A record with neither abstract nor stored full text cannot be read by a perspective and can
// never support a claim — the quote gate has nothing to check against. Retrieval stores plenty
// of these (a quarter of one real corpus), and distributing them silently starves the
// perspectives that receive them. They stay in the corpus for the bibliography; they are just
// not handed to an agent as if they were readable.
function hasText(rec) {
  return Boolean(String(rec.abstract || '').trim() || rec.fulltext_path);
}

function sliceCorpus(records, k, opts = {}) {
  if (!records || !records.length || k < 1) return { shared: [], slices: [], unreadable: [] };

  const unreadable = records.filter(r => !hasText(r)).map(r => r.id);
  records = records.filter(hasText);
  if (!records.length) return { shared: [], slices: [], unreadable };

  const sharedCount = opts.sharedCount != null
    ? opts.sharedCount
    : Math.min(3, Math.floor(records.length * 0.1));

  // Stable ordering first, so the result does not depend on retrieval order.
  const ordered = [...records].sort((a, b) =>
    (b.citation_count || 0) - (a.citation_count || 0) || String(a.id).localeCompare(String(b.id)));

  const shared = ordered.slice(0, sharedCount).map(r => r.id);
  const rest = ordered.slice(sharedCount);

  if (!rest.length) {
    return {
      shared, unreadable,
      slices: [{ index: 0, label: 'all', seedId: null, sourceIds: [...shared] }],
    };
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

  // Assignment is CAPPED. Pure nearest-seed assignment let one seed absorb everything
  // resembling it — a real corpus produced buckets of 41 and 5, and a perspective starved to
  // five sources is a crippled agent rather than a different viewpoint. Overflow falls to the
  // next-best seed, so every perspective gets workable material.
  //
  // The cap is a balancing TARGET, not an invariant: the collapse pass below must place the
  // members of an undersized slice somewhere, and that can push a bucket over.
  const balance = opts.balance != null ? opts.balance : 1.5;
  const cap = Math.max(1, Math.ceil((rest.length / seeds.length) * balance));

  const buckets = seeds.map(() => []);
  for (const r of rest) {
    const si = seeds.indexOf(r);
    if (si >= 0) { buckets[si].push(r.id); continue; }

    const ranked = seeds
      .map((s, i) => ({ i, sim: similarity(textOf(r), textOf(s)) }))
      .sort((a, b) => b.sim - a.sim || a.i - b.i);

    const target = ranked.find(x => buckets[x.i].length < cap) || ranked[0];
    buckets[target.i].push(r.id);
  }

  // Collapse undersized slices. A perspective holding one source cannot interrogate anything,
  // and forcing k slices onto a corpus that only supports fewer manufactures the appearance of
  // diversity rather than the substance. Returning fewer, workable slices is the honest answer.
  const minSlice = opts.minSlice != null ? opts.minSlice : 2;
  const live = seeds.map((seed, i) => ({ seed, members: buckets[i] }));

  while (live.length > 1) {
    const smallest = live.reduce((a, b) => (b.members.length < a.members.length ? b : a));
    if (smallest.members.length >= minSlice) break;

    live.splice(live.indexOf(smallest), 1);
    for (const id of smallest.members) {
      const r = rest.find(x => x.id === id);
      let bestIdx = 0;
      let bestSim = -1;
      live.forEach((l, i) => {
        const sim = similarity(textOf(r), textOf(l.seed));
        if (sim > bestSim) { bestSim = sim; bestIdx = i; }
      });
      live[bestIdx].members.push(id);
    }
  }

  const slices = live
    .map((l, i) => ({
      index: i,
      seedId: l.seed.id,
      label: labelFor(l.seed, live.filter((_, j) => j !== i).map(x => x.seed)),
      sourceIds: [...shared, ...l.members],
    }))
    .filter(s => s.sourceIds.length > 0);

  return { shared, slices, unreadable };
}

module.exports = { sliceCorpus, similarity, labelFor, hasText };
