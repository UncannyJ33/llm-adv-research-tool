'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The corpus is the ONLY citable set. Ids are assigned by code and validated by code, never
// remembered by a model — which is what makes fabricated identifiers structurally impossible
// (spec §5).

function makeRecord(fields = {}) {
  return {
    id: null,
    kind: 'academic',             // 'academic' | 'web'
    doi: null,
    pmid: null,
    arxiv_id: null,
    openalex_id: null,
    url: null,
    title: '',
    authors: [],
    year: null,
    venue: { name: null, type: null, is_indexed: false },
    abstract: '',
    work_type: 'article',         // 'article' | 'review' | 'preprint' | 'page'
    is_preprint: false,
    source_class: null,           // web sources only
    fulltext_path: null,
    oa_pdf_url: null,
    citation_count: 0,
    tier: null,
    tier_basis: null,
    citation_health: { assessed: false, citing_sampled: 0, verdict: null, note: null },
    retracted: false,
    retraction_notice_doi: null,
    admissible: true,
    exclusion_reason: null,
    retrieved_from: [],
    retrieved_at: null,
    dedupe_merged_ids: [],
    used_by: [],
    ...fields,
  };
}

class Corpus {
  constructor(runDir) {
    this.runDir = runDir;
    this.records = [];
    this.nextId = 1;
    fs.mkdirSync(path.join(runDir, 'fulltext'), { recursive: true });
  }

  static load(runDir) {
    const c = new Corpus(runDir);
    const file = path.join(runDir, 'corpus.jsonl');
    if (!fs.existsSync(file)) return c;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    c.records = lines.map(l => JSON.parse(l));
    const nums = c.records
      .map(r => parseInt(String(r.id).slice(1), 10))
      .filter(Number.isFinite);
    c.nextId = nums.length ? Math.max(...nums) + 1 : 1;
    return c;
  }

  add(rec) {
    const id = `S${this.nextId++}`;
    rec.id = id;
    rec.retrieved_at = rec.retrieved_at || new Date().toISOString();
    this.records.push(rec);
    return id;
  }

  get(id) {
    return this.records.find(r => r.id === id) || null;
  }

  all() {
    return this.records;
  }

  putFulltext(id, text) {
    const rec = this.get(id);
    if (!rec) throw new Error(`unknown source: ${id}`);
    const rel = path.join('fulltext', `${id}.txt`);
    fs.writeFileSync(path.join(this.runDir, rel), text, 'utf8');
    rec.fulltext_path = rel;
    return rel;
  }

  // Spec §8.2: evidence basis is DISCLOSED, never used to silently downgrade a claim.
  // Marker inflation destroys the signal the marker exists to carry.
  getText(id) {
    const rec = this.get(id);
    if (!rec) throw new Error(`unknown source: ${id}`);
    if (rec.fulltext_path) {
      const p = path.join(this.runDir, rec.fulltext_path);
      if (fs.existsSync(p)) {
        return { text: fs.readFileSync(p, 'utf8'), basis: 'fulltext' };
      }
    }
    return { text: rec.abstract || '', basis: 'abstract_only' };
  }

  save() {
    const file = path.join(this.runDir, 'corpus.jsonl');
    const body = this.records.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(file, body + (body ? '\n' : ''), 'utf8');
    return file;
  }
}

module.exports = { Corpus, makeRecord };
