'use strict';

// Spec §8.7.3. Four citations that share authors or trace to one cohort are ONE source
// wearing four coats. It presents as strong corroboration and is the most deceptive form of
// single-source dependency, because the citation stack itself is what makes it look safe.

function normalizeAuthor(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Union-find over shared authors and shared cohort/dataset ids.
function analyze(records) {
  const n = records.length;
  if (n === 0) {
    return { cited_count: 0, independent_count: 0, groups: [], reason: 'No sources cited.' };
  }

  const parent = records.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const byAuthor = new Map();
  const byCohort = new Map();
  const links = [];

  records.forEach((rec, i) => {
    for (const raw of rec.authors || []) {
      const a = normalizeAuthor(raw);
      // Absent authorship is not evidence of SHARED authorship — never merge on empty.
      if (!a) continue;
      if (byAuthor.has(a)) {
        union(byAuthor.get(a), i);
        links.push('authors');
      } else {
        byAuthor.set(a, i);
      }
    }

    const cohort = rec.cohort_id || rec.dataset_id;
    if (cohort) {
      if (byCohort.has(cohort)) {
        union(byCohort.get(cohort), i);
        links.push('a cohort or dataset');
      } else {
        byCohort.set(cohort, i);
      }
    }
  });

  const buckets = new Map();
  records.forEach((rec, i) => {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(rec.id);
  });

  const groups = [...buckets.values()];
  const independent = groups.length;

  let reason;
  if (n === 1) {
    reason = 'Single cited source.';
  } else if (independent === n) {
    reason = `${n} cited sources with no shared authors or cohorts; corroboration is independent.`;
  } else {
    const via = [...new Set(links)].join(' and ') || 'shared provenance';
    reason = `${n} cited sources collapse to ${independent} independent source`
      + `${independent === 1 ? '' : 's'} — they share ${via}.`;
  }

  return { cited_count: n, independent_count: independent, groups, reason };
}

module.exports = { analyze, normalizeAuthor };
