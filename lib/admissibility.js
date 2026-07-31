'use strict';
const { getTable } = require('./domains');

// The ONE mapping between tier-rule vocabulary (camelCase, in lib/domains.js) and corpus
// record fields (snake_case, in lib/corpus.js). Keeping it in a single place is what stops
// the two vocabularies from leaking into each other.
const FIELD = {
  kind: r => r.kind,
  isPreprint: r => Boolean(r.is_preprint),
  venueIndexed: r => Boolean(r.venue && r.venue.is_indexed),
  workType: r => r.work_type,
  sourceClass: r => r.source_class,
};

function matchesRule(rec, match) {
  for (const [key, want] of Object.entries(match || {})) {
    if (key === 'minCitations') {
      if ((rec.citation_count || 0) < want) return false;
      continue;
    }
    const getter = FIELD[key];
    if (!getter) throw new Error(`unknown tier-rule field: ${key}`);
    const have = getter(rec);
    if (Array.isArray(want)) {
      if (!want.includes(have)) return false;
    } else if (have !== want) {
      return false;
    }
  }
  return true;
}

// Spec §8.6 — authority is domain-relative. The same record is primary in one domain and
// weak in another, and that is correct: a language specification IS the primary source for a
// software question and gray literature for a biomedical one.
function assignTier(rec, domain) {
  const table = getTable(domain);
  for (const rule of table.tiers) {
    if (matchesRule(rec, rule.match)) {
      return { tier: rule.tier, tier_basis: rule.basis };
    }
  }
  // Unreachable — every table is validated to end in a catch-all.
  return { tier: 'weak', tier_basis: 'unclassified' };
}

const TIER_RANK = { primary: 3, secondary: 2, weak: 1 };

// A genuinely cross-domain question has sources belonging to DIFFERENT authority tables. A
// run spanning neuroscience and machine learning applied one table to everything, so
// well-cited arXiv ML preprints were tiered as biomedical preprints — secondary — and every
// claim resting on them was capped below verified.
//
// When routing is ambiguous, each source is tiered under whichever candidate table fits it
// best. The scope is bounded to the domains the router actually chose, and the winning table
// is recorded in tier_basis so the decision stays auditable.
function assignTierMulti(rec, domains) {
  const list = Array.isArray(domains) ? domains : [domains];
  let best = null;
  for (const d of list) {
    const t = assignTier(rec, d);
    if (!best || TIER_RANK[t.tier] > TIER_RANK[best.tier]) {
      best = { ...t, authority_domain: d };
    }
  }
  return list.length > 1
    ? { ...best, tier_basis: `${best.authority_domain}:${best.tier_basis}` }
    : best;
}

function admit(records, domains) {
  const admitted = [];
  const excluded = [];

  for (const rec of records) {
    if (rec.retracted) {
      rec.admissible = false;
      rec.exclusion_reason = rec.retraction_notice_doi
        ? `Retracted; retraction notice ${rec.retraction_notice_doi}.`
        : 'Retracted or formally withdrawn.';
      excluded.push(rec);
      continue;
    }
    const { tier, tier_basis, authority_domain } = assignTierMulti(rec, domains);
    rec.tier = tier;
    rec.tier_basis = tier_basis;
    rec.authority_domain = authority_domain;
    rec.admissible = true;
    admitted.push(rec);
  }

  return { admitted, excluded };
}

module.exports = { matchesRule, assignTier, assignTierMulti, admit, FIELD, TIER_RANK };
