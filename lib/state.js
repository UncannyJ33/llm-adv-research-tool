'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic } = require('./lock');

// Spec §12. Checkpoint after every stage so a killed run resumes without re-fetching, and
// record every degradation. The hard rule: a degraded run must ANNOUNCE its degradation.
// A run that looks complete but silently covered less is indistinguishable from a good one
// at read time, and that is exactly how a research tool becomes untrustworthy unnoticed.

const STAGES = [
  'seed',
  'perspectives',
  'interrogation',
  'outline',
  'synthesis',
  'verification',
  'redteam',
  'assemble',
];

// Local calendar date, NOT toISOString(). An evening run would otherwise be stamped with
// tomorrow's UTC date, misfiling every run made after ~5pm Pacific.
function todayLocal(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

class RunState {
  constructor(runDir, data) {
    this.runDir = runDir;
    this.data = data;
  }

  static create(runDir, opts) {
    const runId = `${opts.date}-${slugify(opts.slug || opts.question)}`;
    const stages = {};
    for (const s of STAGES) stages[s] = 'pending';

    const data = {
      run_id: runId,
      // The research question as asked, used for titles and the exported note. Distinct from
      // the retrieval string: exporting a keyword soup as the note title produced a poor
      // vault artifact in the first real run.
      question: opts.question,
      query: opts.query || opts.question,
      mode: opts.mode,
      domain: opts.domain,
      domain_confidence: opts.domainConfidence || 'unknown',
      authority_table: opts.domain,
      retrieval_sets: opts.retrievalSets || [],
      ambiguous: Boolean(opts.ambiguous),
      candidate_domains: opts.candidateDomains || [opts.domain],
      started_at: opts.startedAt || new Date().toISOString(),
      stages,
      perspectives: [],
      degradations: [],
      counts: {
        sources: 0, claims_drafted: 0, claims_kept: 0,
        claims_weakened: 0, claims_dropped: 0, contested: 0,
      },
    };

    fs.mkdirSync(runDir, { recursive: true });
    const s = new RunState(runDir, data);
    s.save();
    return s;
  }

  static load(runDir) {
    const file = path.join(runDir, 'run.json');
    if (!fs.existsSync(file)) throw new Error(`no run.json in ${runDir}`);
    return new RunState(runDir, JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  setStage(stage, status) {
    if (!STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
    this.data.stages[stage] = status;
    this.save();
    return this;
  }

  nextStage() {
    for (const s of STAGES) {
      if (this.data.stages[s] !== 'complete') return s;
    }
    return null;
  }

  addPerspective(id) {
    this.data.perspectives.push({ id, status: 'pending', error: null });
    this.save();
    return this;
  }

  setPerspective(id, status, error = null) {
    const p = this.data.perspectives.find(x => x.id === id);
    if (!p) throw new Error(`unknown perspective: ${id}`);
    p.status = status;
    p.error = error;
    this.save();
    return this;
  }

  addDegradation(kind, detail, impact) {
    this.data.degradations.push({ kind, detail, impact });
    this.save();
    return this;
  }

  // A failed perspective counts as degradation even if no API errored — the brief will
  // render with fewer viewpoints and the report must say so.
  isDegraded() {
    return this.data.degradations.length > 0
      || this.data.perspectives.some(p => p.status === 'failed');
  }

  // Stages that never ran. In the first real run, citation health and both red-team lenses
  // were skipped and the report gave no sign of it — the run LOOKED complete. A skipped
  // quality gate is indistinguishable from a passed one unless it is named.
  skippedStages() {
    return STAGES.filter(s => this.data.stages[s] !== 'complete');
  }

  setCounts(patch) {
    Object.assign(this.data.counts, patch);
    this.save();
    return this;
  }

  save() {
    // Atomic: loadRun parses run.json without taking the lock, so a plain write exposes
    // its truncation window to every concurrent reader.
    writeFileAtomic(path.join(this.runDir, 'run.json'), JSON.stringify(this.data, null, 2));
    return this;
  }
}

module.exports = { RunState, slugify, todayLocal, STAGES };
