#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const { seed, defaultAdapters } = require('../lib/seed');
const { Corpus } = require('../lib/corpus');
const { Ledger } = require('../lib/ledger');
const { RunState, todayLocal, STAGES } = require('../lib/state');
const { checkSpan } = require('../lib/spancheck');
const { renderHtml } = require('../lib/render');
const { exportRun } = require('../lib/export');
const { listDomains } = require('../lib/domains');
const { analyze } = require('../lib/independence');
const { fromResult } = require('../lib/retrieve/web');
const { admit } = require('../lib/admissibility');
const { dedupe } = require('../lib/dedupe');
const { screen } = require('../lib/relevance');
const { detectSingleSource } = require('../lib/provenance');
const { sliceCorpus, hasText } = require('../lib/slice');
const { findCollapsed } = require('../lib/overlap');
const { registerClaim, verifyClaim, finalize } = require('../lib/pipeline');
const openalex = require('../lib/retrieve/openalex');

const ROOT = path.resolve(__dirname, '..');
const RUNS = process.env.RESEARCH_RUNS_DIR || path.join(ROOT, 'runs');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function resolveRun(idOrPath) {
  if (!idOrPath) fail('a run id is required');
  const direct = path.resolve(idOrPath);
  if (fs.existsSync(path.join(direct, 'run.json'))) return direct;
  const inRuns = path.join(RUNS, idOrPath);
  if (fs.existsSync(path.join(inRuns, 'run.json'))) return inRuns;
  fail(`no run found: ${idOrPath}`);
}

function loadRun(idOrPath) {
  const dir = resolveRun(idOrPath);
  return {
    dir,
    state: RunState.load(dir),
    corpus: Corpus.load(dir),
    ledger: Ledger.load(dir),
  };
}

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

const USAGE = `research — adversarially-verified research tool

  seed "<question>" --domain <d> [--mode orient|deep] [--domains a,b] [--offline]
                              Route, retrieve, dedupe, tier, write the corpus
  source <run> <sourceId> [--fulltext]
                              Print stored source text (a verifier's ONLY input)
  checkspan <run> <sourceId> --span "<verbatim text>"
                              Run the quote gate; exits 1 if the span is not found
  search <run> "<query>" [--limit N] [--sources a,b]
                              Targeted retrieval into an existing run (deduped)
  independence <run> <S1,S2,...>
                              Collapse correlated citations to independent sources
  provenance <run> "<term>" [--threshold 0.7]
                              Is a term owned by one origin? Exits 1 if single-source.
  stage <run> <name> [--status complete|skipped|failed]
                              Record that a pipeline stage ran, was skipped, or failed
  slice <run> --perspectives N [--shared N]
                              Partition the corpus into shared core + disjoint slices
  overlap <run> [--threshold 0.45]
                              Compare notes/*.md. Exits 1 if perspectives collapsed.

  ingest-web <run> --url <u> --title <t> [--text <body>] [--snippet <s>]
                              Add an agent-fetched web source to the corpus
  ingest-fulltext <run> <sourceId> --file <path>
                              Attach full text to an existing source
  claim <run> --text <t> --sources S1,S2 [--by <agent>] [--load-bearing]
                              Register a drafted claim
  claims <run>                List claims with disposition
  verify <run> <C-id> --source S1 --verdict <v> --span "<verbatim>" --role <r> --reason <why>
                              Run the quote gate. Exits non-zero unless supported.
  citing <run> <sourceId> [--limit N]
                              Fetch citing works for the citation-health judgment
  health <run> <sourceId> --verdict <accepted|disputed|mixed|unclear> --note <n>
                              Record the citation-health assessment
  brief <run> --file <path>   Install the synthesized brief
  assemble <run>              Finalize dispositions, counts, and report.html

  status <run>                Stage state, counts, degradations
  render <run>                Write report.html into the run directory
  export <run> [--to <dir>] [--force]
                              Obsidian-ready markdown (default: ./exports)
  list                        List runs
  domains                     List routable domains

Runs live in ${RUNS}
`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];

  if (!cmd || flags.help || cmd === 'help') {
    process.stdout.write(USAGE);
    return;
  }

  if (cmd === 'domains') {
    process.stdout.write(listDomains().join('\n') + '\n');
    return;
  }

  if (cmd === 'list') {
    if (!fs.existsSync(RUNS)) { process.stdout.write('no runs yet\n'); return; }
    const runs = fs.readdirSync(RUNS)
      .filter(d => fs.existsSync(path.join(RUNS, d, 'run.json')));
    process.stdout.write(runs.length ? runs.join('\n') + '\n' : 'no runs yet\n');
    return;
  }

  if (cmd === 'seed') {
    const question = positional[1];
    if (!question) fail('seed requires a question');
    const domains = flags.domains ? String(flags.domains).split(',').map(s => s.trim()) : null;
    if (!domains && !flags.domain) fail('seed requires --domain <d> (or --domains a,b)');

    const out = await seed({
      runsDir: RUNS,
      question,
      // Retrieval string, when the keywords that search well differ from the question asked.
      query: flags.query && flags.query !== true ? String(flags.query) : undefined,
      mode: flags.mode || 'orient',
      date: flags.date || todayLocal(),
      domain: flags.domain,
      domains,
      domainConfidence: flags.confidence || 'unknown',
      offline: flags.offline ? true : undefined,
    });

    process.stdout.write(`run:      ${out.state.data.run_id}\n`);
    process.stdout.write(`dir:      ${out.runDir}\n`);
    process.stdout.write(`domain:   ${out.routing.domain}`
      + `${out.routing.ambiguous ? ` (ambiguous: ${out.routing.candidateDomains.join(', ')})` : ''}\n`);
    process.stdout.write(`sources:  ${out.corpus.all().length}\n`);
    if (out.filtered && out.filtered.length) {
      process.stdout.write(`screened: ${out.filtered.length} (paratext or off-topic)\n`);
    }
    if (out.excluded.length) {
      process.stdout.write(`excluded: ${out.excluded.length} (retracted)\n`);
      for (const e of out.excluded) {
        process.stdout.write(`  - ${e.title} — ${e.exclusion_reason}\n`);
      }
    }
    if (out.state.isDegraded()) {
      process.stdout.write('\nDEGRADED — this run covered less than a clean run:\n');
      for (const d of out.state.data.degradations) {
        process.stdout.write(`  - ${d.kind}: ${d.detail} (${d.impact})\n`);
      }
    }
    return;
  }

  if (cmd === 'source') {
    const { corpus } = loadRun(positional[1]);
    const id = positional[2];
    if (!id) fail('source requires a source id');
    const rec = corpus.get(id);
    if (!rec) fail(`unknown source: ${id}`);
    const { text, basis } = corpus.getText(id);
    process.stdout.write(JSON.stringify({
      id: rec.id, title: rec.title, authors: rec.authors, year: rec.year,
      venue: rec.venue.name, doi: rec.doi, tier: rec.tier, tier_basis: rec.tier_basis,
      evidence_basis: basis, text,
    }, null, 2) + '\n');
    return;
  }

  if (cmd === 'checkspan') {
    const { corpus } = loadRun(positional[1]);
    const id = positional[2];
    if (!id) fail('checkspan requires a source id');
    if (!flags.span || flags.span === true) fail('checkspan requires --span "<text>"');
    if (!corpus.get(id)) fail(`unknown source: ${id}`);

    const { text, basis } = corpus.getText(id);
    const result = checkSpan(String(flags.span), text);
    process.stdout.write(JSON.stringify({ ...result, evidence_basis: basis }, null, 2) + '\n');
    // Non-zero exit on anything but a pass, so callers cannot ignore a failed gate.
    process.exit(result.result === 'pass' ? 0 : 1);
  }

  if (cmd === 'independence') {
    const { corpus } = loadRun(positional[1]);
    const ids = String(positional[2] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) fail('independence requires a comma-separated list of source ids');
    const recs = ids.map(id => {
      const r = corpus.get(id);
      if (!r) fail(`unknown source: ${id}`);
      return r;
    });
    process.stdout.write(JSON.stringify(analyze(recs), null, 2) + '\n');
    return;
  }

  if (cmd === 'search') {
    const { state, corpus } = loadRun(positional[1]);
    const query = positional[2];
    if (!query) fail('search requires a query');

    const adapters = defaultAdapters();
    const sets = flags.sources && flags.sources !== true
      ? String(flags.sources).split(',').map(s => s.trim())
      : state.data.retrieval_sets;

    const collected = [];
    for (const name of sets) {
      const adapter = adapters[name];
      if (!adapter) continue;
      try {
        collected.push(...await adapter(query, { limit: Number(flags.limit) || 10 }));
      } catch (err) {
        state.addDegradation('api_error', `${name} (search "${query}"): ${err.message}`,
          `${name} coverage reduced for this query`);
      }
    }

    // Dedupe against what the run already holds so a follow-up query cannot re-add a source
    // under a second id and manufacture false corroboration.
    const { kept } = dedupe([...corpus.all(), ...collected]);
    const fresh = kept.filter(r => !r.id);
    const { kept: relevant, filtered } = screen(fresh, query);
    const { admitted, excluded } = admit(relevant, state.data.candidate_domains || state.data.authority_table);

    const added = [];
    for (const rec of admitted) added.push(corpus.add(rec));
    corpus.save();
    state.setCounts({ sources: corpus.all().length });

    process.stdout.write(`added ${added.length}${added.length ? `: ${added.join(', ')}` : ''}`
      + `${filtered.length ? ` · screened out ${filtered.length}` : ''}`
      + `${excluded.length ? ` · excluded ${excluded.length} (retracted)` : ''}\n`);
    for (const id of added) {
      const r = corpus.get(id);
      process.stdout.write(`  ${id} [${r.tier}] ${(r.title || '').slice(0, 70)}\n`);
    }
    return;
  }

  if (cmd === 'stage') {
    const { state } = loadRun(positional[1]);
    const name = positional[2];
    if (!name) fail(`stage requires a stage name — one of: ${STAGES.join(', ')}`);
    const status = flags.status && flags.status !== true ? String(flags.status) : 'complete';
    if (!['complete', 'skipped', 'failed', 'pending'].includes(status)) {
      fail(`unknown status: ${status} (complete|skipped|failed|pending)`);
    }
    state.setStage(name, status);
    process.stdout.write(`${name}: ${status}\n`);
    return;
  }

  if (cmd === 'slice') {
    const { corpus } = loadRun(positional[1]);
    const k = Number(flags.perspectives) || 4;
    const out = sliceCorpus(corpus.all(), k, {
      sharedCount: flags.shared != null && flags.shared !== true ? Number(flags.shared) : undefined,
    });
    if (out.unreadable.length) {
      process.stdout.write(`unreadable: ${out.unreadable.length} sources have no abstract or `
        + 'full text and were withheld from every slice (they stay in the bibliography)\n');
    }
    process.stdout.write(`shared core: ${out.shared.join(', ') || 'none'}\n\n`);
    for (const s of out.slices) {
      process.stdout.write(`[${s.index}] ${s.label}  (seed ${s.seedId}, ${s.sourceIds.length} sources)\n`);
      process.stdout.write(`    ${s.sourceIds.join(', ')}\n`);
    }
    return;
  }

  if (cmd === 'overlap') {
    const { dir } = loadRun(positional[1]);
    const notesDir = path.join(dir, 'notes');
    if (!fs.existsSync(notesDir)) fail(`no notes/ directory in the run — nothing to compare`);
    const notes = fs.readdirSync(notesDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ id: f.replace(/\.md$/, ''), text: fs.readFileSync(path.join(notesDir, f), 'utf8') }));

    if (notes.length < 2) {
      process.stdout.write(`only ${notes.length} perspective note(s) — nothing to compare\n`);
      return;
    }

    const pairs = findCollapsed(notes, {
      threshold: flags.threshold ? Number(flags.threshold) : undefined,
    });
    if (!pairs.length) {
      process.stdout.write(`${notes.length} perspectives, no collapse detected\n`);
      return;
    }
    process.stdout.write('COLLAPSED perspectives — these wrote substantially the same notes:\n');
    for (const p of pairs) {
      process.stdout.write(`  ${p.a} <-> ${p.b}   similarity ${p.score.toFixed(2)}\n`);
    }
    process.stdout.write('\nRe-run the worse of each pair with the taken framings excluded.\n');
    // Non-zero so the orchestrator cannot proceed past a failed diversity check.
    process.exit(1);
  }

  if (cmd === 'provenance') {
    const { corpus } = loadRun(positional[1]);
    const term = positional[2];
    if (!term) fail('provenance requires a term, e.g. provenance <run> "Zero Trust"');
    const out = detectSingleSource(term, corpus.all(), {
      threshold: flags.threshold ? Number(flags.threshold) : undefined,
    });
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    // Non-zero when the term is owned by one origin, so a skill step cannot skip past it.
    process.exit(out.singleSource ? 1 : 0);
  }

  if (cmd === 'ingest-web') {
    const { dir, state, corpus } = loadRun(positional[1]);
    if (!flags.url || flags.url === true) fail('ingest-web requires --url');
    const rec = fromResult({
      url: String(flags.url),
      title: flags.title === true ? '' : String(flags.title || ''),
      text: flags.text === true ? '' : String(flags.text || ''),
      snippet: flags.snippet === true ? '' : String(flags.snippet || ''),
    });
    const { admitted, excluded } = admit([rec], state.data.candidate_domains || state.data.authority_table);
    if (!admitted.length) {
      process.stdout.write(`excluded: ${excluded[0].exclusion_reason}\n`);
      process.exit(1);
    }
    const id = corpus.add(admitted[0]);
    corpus.save();
    state.setCounts({ sources: corpus.all().length });
    process.stdout.write(`${id}  [${admitted[0].tier}/${admitted[0].tier_basis}]  `
      + `${admitted[0].source_class}\n`);
    return;
  }

  if (cmd === 'ingest-fulltext') {
    const { corpus } = loadRun(positional[1]);
    const id = positional[2];
    if (!id) fail('ingest-fulltext requires a source id');
    if (!flags.file || flags.file === true) fail('ingest-fulltext requires --file <path>');
    if (!corpus.get(id)) fail(`unknown source: ${id}`);
    corpus.putFulltext(id, fs.readFileSync(String(flags.file), 'utf8'));
    corpus.save();
    process.stdout.write(`${id} fulltext attached\n`);
    return;
  }

  if (cmd === 'claim') {
    const { ledger } = loadRun(positional[1]);
    if (!flags.text || flags.text === true) fail('claim requires --text');
    const sources = flags.sources && flags.sources !== true
      ? String(flags.sources).split(',').map(s => s.trim()).filter(Boolean)
      : [];
    if (!sources.length) fail('claim requires --sources S1[,S2] — write nothing you cannot cite');
    const id = registerClaim(ledger, {
      text: String(flags.text),
      cited_source_ids: sources,
      drafted_by: flags.by === true ? null : (flags.by || null),
      load_bearing: Boolean(flags['load-bearing']),
    });
    ledger.save();
    process.stdout.write(`${id}\n`);
    return;
  }

  if (cmd === 'claims') {
    const { ledger } = loadRun(positional[1]);
    const all = ledger.all();
    if (!all.length) { process.stdout.write('no claims\n'); return; }
    for (const c of all) {
      process.stdout.write(`${c.claim_id}  ${c.disposition.padEnd(10)}`
        + `${(c.confidence || '-').padEnd(10)}[${c.cited_source_ids.join(',')}]  ${c.text}\n`);
    }
    return;
  }

  if (cmd === 'verify') {
    const { corpus, ledger } = loadRun(positional[1]);
    const claimId = positional[2];
    if (!claimId) fail('verify requires a claim id');

    // The span check is COMPUTED here, never accepted from the caller. Rejecting the flag
    // outright stops an agent from asserting its own gate result.
    for (const forbidden of ['span-check', 'spancheck', 'effective-verdict']) {
      if (forbidden in flags) {
        fail(`--${forbidden} is not accepted: the span check is computed from stored source text, not supplied`);
      }
    }
    if (!flags.source || flags.source === true) fail('verify requires --source <sourceId>');
    if (!flags.verdict || flags.verdict === true) fail('verify requires --verdict');
    if (!flags.reason || flags.reason === true) fail('verify requires --reason (a reason, not a label)');

    const record = verifyClaim({
      corpus, ledger, claimId,
      sourceId: String(flags.source),
      verdict: String(flags.verdict),
      span: flags.span === true ? null : (flags.span || null),
      role: flags.role === true ? null : (flags.role || null),
      reason: String(flags.reason),
    });
    ledger.save();

    process.stdout.write(`verdict:   ${record.verdict}\n`);
    process.stdout.write(`effective: ${record.effective_verdict}\n`);
    process.stdout.write(`span:      ${record.span_check}`
      + `${record.span_role ? ` / declared ${record.span_role}` : ''}`
      + `${record.detected_section !== 'unknown' ? ` / detected ${record.detected_section}` : ''}\n`);
    if (record.override_reason) process.stdout.write(`OVERRIDE:  ${record.override_reason}\n`);
    if (record.role_warning) process.stdout.write(`WARNING:   ${record.role_warning}\n`);
    if (record.reason_quality === 'low') {
      process.stdout.write('WARNING:   rejection rationale does not reference source content\n');
    }
    process.exit(record.effective_verdict === 'supported' ? 0 : 1);
  }

  if (cmd === 'citing') {
    const { corpus } = loadRun(positional[1]);
    const id = positional[2];
    if (!id) fail('citing requires a source id');
    const rec = corpus.get(id);
    if (!rec) fail(`unknown source: ${id}`);
    if (!rec.openalex_id) fail(`${id} has no OpenAlex id — citation health is unavailable for it`);
    const works = await openalex.citingWorks(rec.openalex_id, Number(flags.limit) || 25);
    process.stdout.write(JSON.stringify(works.map(w => {
      const n = openalex.normalize(w);
      return { title: n.title, year: n.year, abstract: n.abstract.slice(0, 600) };
    }), null, 2) + '\n');
    return;
  }

  if (cmd === 'health') {
    const { corpus } = loadRun(positional[1]);
    const id = positional[2];
    if (!id) fail('health requires a source id');
    const rec = corpus.get(id);
    if (!rec) fail(`unknown source: ${id}`);
    if (!flags.verdict || flags.verdict === true) fail('health requires --verdict');
    rec.citation_health = {
      assessed: true,
      citing_sampled: Number(flags.sampled) || 0,
      verdict: String(flags.verdict),
      note: flags.note === true ? null : (flags.note || null),
    };
    corpus.save();
    process.stdout.write(`${id} citation health: ${rec.citation_health.verdict}\n`);
    return;
  }

  if (cmd === 'brief') {
    const { dir } = loadRun(positional[1]);
    if (!flags.file || flags.file === true) fail('brief requires --file <path>');
    fs.copyFileSync(String(flags.file), path.join(dir, 'brief.md'));
    process.stdout.write(path.join(dir, 'brief.md') + '\n');
    return;
  }

  if (cmd === 'assemble') {
    const { dir, state, corpus, ledger } = loadRun(positional[1]);
    const counts = finalize({ corpus, ledger, state });
    corpus.save();
    // Infer the stages that leave CHECKABLE evidence behind, rather than leaving them
    // permanently "did not run". Six stages had no code path that could ever mark them
    // complete, so the disclosure fired on every run and taught the reader to ignore it.
    // Only inferred from facts on disk — never assumed.
    if (ledger.all().length) state.setStage('synthesis', 'complete');
    if (ledger.all().some(c => c.verification.length)) {
      state.setStage('verification', 'complete');
    }
    const notesDir = path.join(dir, 'notes');
    if (fs.existsSync(notesDir) && fs.readdirSync(notesDir).some(f => f.endsWith('.md'))) {
      state.setStage('perspectives', 'complete');
      state.setStage('interrogation', 'complete');
    }
    state.setStage('assemble', 'complete');

    const briefPath = path.join(dir, 'brief.md');
    const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, 'utf8') : null;
    const out = path.join(dir, 'report.html');
    fs.writeFileSync(out, renderHtml({ state, corpus, ledger, brief }), 'utf8');

    process.stdout.write(`kept ${counts.claims_kept} · weakened ${counts.claims_weakened}`
      + ` · dropped ${counts.claims_dropped} · contested ${counts.contested}`
      + ` (of ${counts.claims_drafted})\n`);
    if (counts.claims_drafted > 0 && ledger.rejected().length === 0) {
      process.stdout.write('NOTE: nothing was rejected — worth a second look at the verifier.\n');
    }
    if (state.isDegraded()) process.stdout.write('DEGRADED: see the report for what was missed.\n');
    process.stdout.write(out + '\n');
    return;
  }

  if (cmd === 'status') {
    const { state, corpus, ledger } = loadRun(positional[1]);
    const d = state.data;
    process.stdout.write(`${d.run_id}\n`);
    process.stdout.write(`question: ${d.question}\n`);
    process.stdout.write(`mode:     ${d.mode}   domain: ${d.domain} (${d.domain_confidence})\n`);
    const unreadable = corpus.all().filter(r => !hasText(r)).length;
    process.stdout.write(`sources:  ${corpus.all().length}   claims: ${ledger.all().length}`
      + `   rejected: ${ledger.rejected().length}\n`);
    if (unreadable) {
      process.stdout.write(`unreadable: ${unreadable} of ${corpus.all().length} sources have `
        + 'no text — they cannot support a claim\n');
    }
    process.stdout.write(`next:     ${state.nextStage() || 'complete'}\n`);
    process.stdout.write('stages:\n');
    for (const [k, v] of Object.entries(d.stages)) {
      process.stdout.write(`  ${v === 'complete' ? 'x' : ' '} ${k}\n`);
    }
    if (state.isDegraded()) {
      process.stdout.write('\nDEGRADED:\n');
      for (const x of d.degradations) process.stdout.write(`  - ${x.kind}: ${x.detail}\n`);
      for (const p of d.perspectives.filter(p => p.status === 'failed')) {
        process.stdout.write(`  - perspective ${p.id} failed: ${p.error}\n`);
      }
    }
    return;
  }

  if (cmd === 'render') {
    const { dir, state, corpus, ledger } = loadRun(positional[1]);
    const briefPath = path.join(dir, 'brief.md');
    const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, 'utf8') : null;
    const html = renderHtml({ state, corpus, ledger, brief });
    const out = path.join(dir, 'report.html');
    fs.writeFileSync(out, html, 'utf8');
    process.stdout.write(out + '\n');
    return;
  }

  if (cmd === 'export') {
    const { dir, state, corpus, ledger } = loadRun(positional[1]);
    const briefPath = path.join(dir, 'brief.md');
    const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, 'utf8') : null;
    const topics = flags.topics && flags.topics !== true
      ? String(flags.topics).split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const out = exportRun({
      state, corpus, ledger, brief, topics,
      exportsDir: flags.to && flags.to !== true ? String(flags.to) : path.join(ROOT, 'exports'),
      force: Boolean(flags.force),
    });
    process.stdout.write(out.file + '\n');
    return;
  }

  fail(`unknown command: ${cmd}\n\n${USAGE}`);
}

main().catch(err => fail(err.stack || err.message));
