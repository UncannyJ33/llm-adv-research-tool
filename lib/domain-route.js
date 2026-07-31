'use strict';
const { getTable } = require('./domains');

function route(domain, opts = {}) {
  const table = getTable(domain);
  return {
    domain,
    candidateDomains: [domain],
    domainConfidence: opts.confidence || 'unknown',
    authorityTable: domain,
    retrievalSets: [...table.retrieval],
    ambiguous: false,
  };
}

// Spec §7.1: if domain classification is ambiguous or the question spans domains, use the
// union of the candidate retrieval sets. Guessing one domain silently is worse than
// searching broadly.
function routeUnion(domains, opts = {}) {
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error('routeUnion requires at least one domain');
  }
  if (domains.length === 1) return route(domains[0], opts);

  const sets = [];
  for (const d of domains) {
    for (const r of getTable(d).retrieval) if (!sets.includes(r)) sets.push(r);
  }
  return {
    domain: domains[0],
    candidateDomains: [...domains],
    domainConfidence: opts.confidence || 'low',
    authorityTable: domains[0],
    retrievalSets: sets,
    ambiguous: true,
  };
}

module.exports = { route, routeUnion };
