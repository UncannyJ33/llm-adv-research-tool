'use strict';
const path = require('node:path');
const { route, routeUnion } = require('./domain-route');
const { Corpus } = require('./corpus');
const { RunState } = require('./state');
const { dedupe } = require('./dedupe');
const { admit } = require('./admissibility');
const { screen } = require('./relevance');

// Default adapters. Each takes (query, opts) and returns normalized corpus records.
// Injectable so the orchestrator is testable without touching the network.
function defaultAdapters() {
  const openalex = require('./retrieve/openalex');
  const europepmc = require('./retrieve/europepmc');
  const crossref = require('./retrieve/crossref');
  const arxiv = require('./retrieve/arxiv');
  const github = require('./retrieve/github');

  const wrap = mod => async (query, opts) =>
    (await mod.search(query, opts)).map(mod.normalize);

  return {
    openalex: wrap(openalex),
    europepmc: wrap(europepmc),
    crossref: wrap(crossref),
    arxiv: wrap(arxiv),
    github: wrap(github),
    // Web retrieval is driven by the agent layer (WebSearch/WebFetch), which hands results
    // to lib/retrieve/web.js#fromResult. There is no keyless search API to call here.
    web: async () => [],
  };
}

const LIMITS = { orient: 8, deep: 25 };

async function seed(opts) {
  const {
    runsDir,
    question,
    mode = 'orient',
    date,
    adapters = defaultAdapters(),
  } = opts;

  const routing = opts.domains
    ? routeUnion(opts.domains, { confidence: opts.domainConfidence })
    : route(opts.domain, { confidence: opts.domainConfidence });

  const query = opts.query || question;
  const state = RunState.create(
    path.join(runsDir, `${date}-${require('./state').slugify(question)}`),
    {
      question,
      query,
      mode,
      date,
      domain: routing.domain,
      domainConfidence: routing.domainConfidence,
      retrievalSets: routing.retrievalSets,
      ambiguous: routing.ambiguous,
      candidateDomains: routing.candidateDomains,
      startedAt: opts.startedAt,
    }
  );
  const runDir = state.runDir;

  // Fetch every routed source. A failure degrades the run; it never aborts it, and it is
  // never silent (spec §12).
  const collected = [];

  // Offline mode keeps the test suite hermetic and lets a run proceed without network.
  // It is a real reduction in coverage, so it announces itself like any other degradation.
  const offline = opts.offline !== undefined ? opts.offline : Boolean(process.env.RESEARCH_OFFLINE);
  if (offline) {
    state.addDegradation('offline', 'RESEARCH_OFFLINE set — no retrieval was performed.',
      'corpus contains only sources ingested by hand');
  }

  for (const name of offline ? [] : routing.retrievalSets) {
    const adapter = adapters[name];
    if (!adapter) {
      state.addDegradation('no_adapter', `No adapter registered for "${name}".`,
        `${name} coverage missing`);
      continue;
    }
    try {
      const recs = await adapter(query, { limit: LIMITS[mode] || LIMITS.orient });
      collected.push(...recs);
    } catch (err) {
      state.addDegradation('api_error', `${name}: ${err.message}`,
        `${name} coverage reduced or absent`);
    }
  }

  const { kept } = dedupe(collected);

  // Screen before admission. Keyword retrieval returns paratext and single-token
  // coincidences; letting those into the corpus makes the bibliography something you have to
  // hand-filter, which is the work the tool exists to remove.
  const { kept: relevant, filtered } = screen(kept, query, {
    threshold: opts.relevanceThreshold,
  });

  const { admitted, excluded } = admit(relevant, routing.candidateDomains);

  const corpus = new Corpus(runDir);
  for (const rec of admitted) corpus.add(rec);
  corpus.save();

  state.setCounts({ sources: corpus.all().length, sources_filtered: filtered.length });
  state.setStage('seed', 'complete');

  return { runDir, state, corpus, excluded, filtered, routing };
}

module.exports = { seed, defaultAdapters, LIMITS };
