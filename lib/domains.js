'use strict';

// Authority is domain-relative (spec §8.6). A fixed academic hierarchy would demote real
// primary sources — language specs, statistical releases, court opinions, source code — to
// "gray literature" while promoting weak indexed papers, and on domains with no academic
// literature nothing could reach `verified`, which trains the confidence layer to be ignored.
//
// These tables are DATA. Adding a domain is an edit, not a build (spec §14).

// URL pattern -> source class. Ordered; first match wins.
const WEB_CLASS_RULES = [
  { class: 'rfc', patterns: [/datatracker\.ietf\.org/i, /rfc-editor\.org/i, /w3\.org\/TR\//i] },
  { class: 'spec', patterns: [/spec\.whatwg\.org/i, /ecma-international\.org/i, /iso\.org/i, /pubs\.opengroup\.org/i] },
  // MUST precede source-repo. A bare `github.com` match tiered every issue thread
  // `primary / official-source` under `software`, so a stranger's comment carried the same
  // authority as the spec it was arguing with. The repo is an official source; the argument
  // happening inside it is not. Anchored to the forge's owner/repo path shape so a journal
  // volume at /issues/12 cannot match.
  { class: 'repo-discussion', patterns: [/(?:github|gitlab|codeberg)\.[a-z.]+\/[^/]+\/[^/]+\/(?:-\/)?(?:issues|pull|pulls|merge_requests|discussions)(?:[/?#]|$)/i] },
  // raw.githubusercontent.com carries the source file itself — the most primary evidence a
  // software question has — and matched none of the forge patterns, so it fell to the
  // catch-all and tiered `weak / community`. Authority deflation is the same defect as
  // inflation, pointed the other way.
  { class: 'source-repo', patterns: [/github\.com/i, /githubusercontent\.com/i, /gitlab\.com/i, /codeberg\.org/i, /git\.kernel\.org/i] },
  { class: 'gov-statistical', patterns: [/federalreserve\.gov/i, /bls\.gov/i, /census\.gov/i, /ecb\.europa\.eu/i, /bankofengland\.co\.uk/i, /imf\.org/i, /worldbank\.org/i, /oecd\.org/i, /\.gov(\/|$)/i] },
  { class: 'primary-document', patterns: [/supremecourt\.gov/i, /courtlistener\.com/i, /sec\.gov\/Archives/i, /congress\.gov/i, /eur-lex\.europa\.eu/i] },
  { class: 'official-docs', patterns: [/\/documentation\//i, /readthedocs\.io/i, /developer\.mozilla\.org/i, /docs\.[a-z0-9-]+\.(org|com|io|dev)/i, /\/docs?\//i] },
  { class: 'changelog', patterns: [/CHANGELOG/i, /\/releases?\//i, /release-notes/i] },
  { class: 'institutional-research', patterns: [/nber\.org/i, /brookings\.edu/i, /rand\.org/i, /bis\.org/i] },
  { class: 'maintainer-blog', patterns: [/blog\.[a-z0-9-]+\.(org|dev)/i] },
  { class: 'news-sourced', patterns: [/reuters\.com/i, /apnews\.com/i, /bloomberg\.com/i, /ft\.com/i, /wsj\.com/i, /nytimes\.com/i] },
];

function classifyWebSource(url) {
  if (!url) return 'community';
  for (const rule of WEB_CLASS_RULES) {
    if (rule.patterns.some(p => p.test(url))) return rule.class;
  }
  return 'community';
}

const DOMAINS = {
  biomedical: {
    label: 'Biomedical / life sciences',
    retrieval: ['europepmc', 'openalex', 'crossref', 'web'],
    tiers: [
      // Health-agency data, regulatory filings and trial registries are PRIMARY biomedical
      // sources, not gray literature. Without this rule every non-journal source — a CDC
      // surveillance report, an FDA label, a ClinicalTrials.gov registration — falls to the
      // catch-all and can never verify a claim.
      { tier: 'primary', basis: 'agency-or-registry', match: { sourceClass: ['gov-statistical', 'primary-document'] } },
      { tier: 'primary', basis: 'peer-reviewed-indexed', match: { kind: 'academic', isPreprint: false, venueIndexed: true, workType: ['article'] } },
      { tier: 'secondary', basis: 'review-article', match: { kind: 'academic', workType: ['review'] } },
      { tier: 'secondary', basis: 'preprint', match: { kind: 'academic', isPreprint: true } },
      { tier: 'secondary', basis: 'academic-unindexed', match: { kind: 'academic' } },
      { tier: 'weak', basis: 'gray-literature', match: {} },
    ],
  },
  physical_cs: {
    label: 'Physical sciences / CS research',
    retrieval: ['arxiv', 'openalex', 'crossref', 'web'],
    tiers: [
      // NIST/NASA/national-lab datasets and standards are primary here for the same reason.
      { tier: 'primary', basis: 'agency-or-standard', match: { sourceClass: ['gov-statistical', 'primary-document', 'spec', 'rfc'] } },
      { tier: 'primary', basis: 'peer-reviewed-venue', match: { kind: 'academic', isPreprint: false, venueIndexed: true } },
      { tier: 'primary', basis: 'preprint-with-traction', match: { kind: 'academic', isPreprint: true, minCitations: 25 } },
      { tier: 'secondary', basis: 'preprint', match: { kind: 'academic', isPreprint: true } },
      { tier: 'secondary', basis: 'academic-other', match: { kind: 'academic' } },
      { tier: 'weak', basis: 'gray-literature', match: {} },
    ],
  },
  software: {
    label: 'Software / engineering',
    retrieval: ['web', 'openalex', 'github'],
    tiers: [
      { tier: 'primary', basis: 'official-source', match: { sourceClass: ['spec', 'rfc', 'official-docs', 'source-repo', 'changelog'] } },
      { tier: 'secondary', basis: 'maintainer', match: { sourceClass: ['maintainer-blog', 'conference-talk'] } },
      { tier: 'secondary', basis: 'peer-reviewed', match: { kind: 'academic', isPreprint: false } },
      { tier: 'weak', basis: 'community', match: {} },
    ],
  },
  economics_policy: {
    label: 'Economics / policy',
    retrieval: ['web', 'openalex', 'crossref'],
    tiers: [
      { tier: 'primary', basis: 'official-statistics', match: { sourceClass: ['gov-statistical', 'primary-document'] } },
      { tier: 'secondary', basis: 'institutional', match: { sourceClass: ['institutional-research'] } },
      { tier: 'secondary', basis: 'peer-reviewed', match: { kind: 'academic', isPreprint: false } },
      { tier: 'weak', basis: 'commentary', match: {} },
    ],
  },
  history_humanities: {
    label: 'History / humanities',
    retrieval: ['openalex', 'crossref', 'web'],
    tiers: [
      // National archives and government record offices resolve to gov-statistical by URL,
      // so they must be named here or the archival primary sources score weak.
      { tier: 'primary', basis: 'primary-document', match: { sourceClass: ['primary-document', 'gov-statistical'] } },
      { tier: 'primary', basis: 'scholarly', match: { kind: 'academic', isPreprint: false, venueIndexed: true } },
      { tier: 'secondary', basis: 'secondary-synthesis', match: { kind: 'academic' } },
      { tier: 'weak', basis: 'popular', match: {} },
    ],
  },
  current_events: {
    label: 'Current events',
    retrieval: ['web'],
    tiers: [
      { tier: 'primary', basis: 'primary-document', match: { sourceClass: ['primary-document', 'gov-statistical', 'spec'] } },
      { tier: 'secondary', basis: 'named-sourcing', match: { sourceClass: ['news-sourced'] } },
      { tier: 'weak', basis: 'commentary', match: {} },
    ],
  },
};

function listDomains() {
  return Object.keys(DOMAINS);
}

function getTable(domain) {
  const t = DOMAINS[domain];
  if (!t) throw new Error(`unknown domain: ${domain}`);
  return t;
}

module.exports = { DOMAINS, listDomains, getTable, classifyWebSource, WEB_CLASS_RULES };
