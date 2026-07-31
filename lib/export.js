'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Spec §11, decoupled. The tool has NO Obsidian dependency: export writes Obsidian-ready
// markdown into a local exports/ directory. `--to <path>` is the only way to target
// anywhere else, and there is no hardcoded vault path in this codebase.

// Hard rule: backticked [[links]] are INERT in Obsidian. A wikilink emitted inside a code
// span silently fails to link, which orphans the note it was meant to connect.
function hasBacktickedLink(text) {
  const fenced = String(text).match(/```[\s\S]*?```/g) || [];
  if (fenced.some(f => /\[\[[^\]]+\]\]/.test(f))) return true;
  return /`[^`\n]*\[\[[^\]]+\]\][^`\n]*`/.test(String(text));
}

// Split on code spans and fenced blocks, transform only the prose segments.
function linkTopics(text, topics) {
  if (!topics || !topics.length) return text;

  const segments = String(text).split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  const linked = new Set();

  const out = segments.map(seg => {
    if (seg.startsWith('```') || (seg.startsWith('`') && seg.endsWith('`'))) return seg;

    let s = seg;
    for (const topic of topics) {
      if (linked.has(topic)) continue;
      // Skip if this topic is already a wikilink anywhere in the document.
      if (new RegExp(`\\[\\[${escapeRe(topic)}\\]\\]`).test(text)) {
        linked.add(topic);
        continue;
      }
      const re = new RegExp(`\\b${escapeRe(topic)}\\b`);
      if (re.test(s)) {
        s = s.replace(re, `[[${topic}]]`);
        linked.add(topic);
      }
    }
    return s;
  }).join('');

  return out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function citationLine(rec) {
  const authors = (rec.authors || []).slice(0, 3).join(', ')
    + ((rec.authors || []).length > 3 ? ' et al.' : '');
  const bits = [authors, rec.year ? `(${rec.year})` : '', rec.title,
    rec.venue && rec.venue.name ? `*${rec.venue.name}*` : ''].filter(Boolean);
  let line = bits.join('. ');
  const link = rec.doi ? `https://doi.org/${rec.doi}` : (rec.oa_pdf_url || rec.url);
  if (link) line += ` — ${link}`;
  if (rec.tier) line += ` \`${rec.tier}\``;
  return line;
}

function toMarkdown({ state, corpus, ledger, brief = null, topics = [] }) {
  const d = state.data;
  const contested = ledger.all().filter(c => c.confidence === 'contested').length;

  const fm = [
    '---',
    `title: ${d.question}`,
    'type: research-brief',
    'generated: true',
    `topic: ${d.question}`,
    `mode: ${d.mode}`,
    `domain: ${d.domain}`,
    `run_id: ${d.run_id}`,
    `date: ${d.run_id.slice(0, 10)}`,
    `source_count: ${corpus.all().length}`,
    `contested_count: ${contested}`,
    'tags: [research-brief, generated]',
    'tool: llm-adv-research-tool',
    '---',
    '',
  ].join('\n');

  let body = `# ${d.question}\n\n`;

  if (state.isDegraded()) {
    body += '> [!warning] This run was degraded\n';
    body += '> It covered less than a clean run would.\n';
    for (const x of d.degradations) {
      body += `> - **${x.kind}** — ${x.detail}${x.impact ? ` (${x.impact})` : ''}\n`;
    }
    for (const p of d.perspectives.filter(p => p.status === 'failed')) {
      body += `> - Perspective **${p.id}** failed${p.error ? `: ${p.error}` : ''}\n`;
    }
    body += '\n';
  }

  const skipped = state.skippedStages ? state.skippedStages() : [];
  if (skipped.length) {
    body += '> [!warning] Stages that did not run\n';
    body += '> These checks were never performed, so their absence is not evidence that '
      + 'nothing was wrong.\n';
    body += `> ${skipped.map(s => `\`${s}\``).join(', ')}\n\n`;
  }

  body += brief ? `${brief}\n\n` : '_Retrieval-only run — no synthesized brief._\n\n';

  // Keyed on the stable corpus id, never on list position — positional numbering silently
  // repoints every citation the moment a source is excluded.
  const recs = corpus.all();
  const cited = recs.filter(r => r.used_by && r.used_by.length);
  const unused = recs.filter(r => !r.used_by || !r.used_by.length);

  body += '## Bibliography\n\n';
  if (!recs.length) {
    body += '_No sources retrieved._\n';
  } else {
    body += `### Cited (${cited.length})\n\n`;
    if (!cited.length) body += '_No source survived into the brief._\n';
    for (const rec of cited) body += `- **${rec.id}** — ${citationLine(rec)}\n`;

    if (unused.length) {
      body += `\n### Retrieved but not cited (${unused.length})\n\n`;
      for (const rec of unused) body += `- **${rec.id}** — ${citationLine(rec)}\n`;
    }
  }

  const section = (title, claims, showAll = false) => {
    if (!claims.length) return '';
    let s = `\n## ${title}\n\n`;
    for (const c of claims) {
      s += `- **${c.original_text || c.text}**\n`;
      if (c.final_text && c.final_text !== c.original_text) s += `  - Kept as: ${c.final_text}\n`;
      if (c.cited_source_ids && c.cited_source_ids.length) {
        s += `  - Sources: ${c.cited_source_ids.join(', ')}\n`;
      }
      if (c.disposition_reason) s += `  - Outcome: ${c.disposition_reason}\n`;
      if (c.secondary_reason) s += `  - Secondary support: ${c.secondary_reason}\n`;

      // Contested means verifiers disagreed; showing one position asserts that without
      // exhibiting it.
      const shown = showAll ? c.verification : [c.verification[c.verification.length - 1]];
      for (const v of shown) {
        if (!v) continue;
        if (showAll) s += `  - Verifier ${v.verifier}: **${v.effective_verdict}**\n`;
        s += `  - Reason: ${v.reason}\n`;
        if (v.override_reason) s += `  - Override: ${v.override_reason}\n`;
        if (v.role_warning) s += `  - Warning: ${v.role_warning}\n`;
      }
    }
    return s;
  };

  // Dropped and weakened are different outcomes; a weakened claim is IN the brief.
  body += section('Dropped claims — absent from the brief', ledger.dropped());
  body += section('Weakened claims — in the brief, held below verified', ledger.weakened());
  body += section('Contested claims — verifiers disagreed', ledger.contested(), true);

  const doc = fm + linkTopics(body, topics);

  // Fail loudly rather than silently shipping inert links.
  if (hasBacktickedLink(doc)) {
    throw new Error('export produced a wikilink inside a code span — those are inert in Obsidian');
  }
  return doc;
}

function exportRun({ state, corpus, ledger, brief = null, topics = [], exportsDir, force = false }) {
  const dir = exportsDir || path.join(process.cwd(), 'exports');
  fs.mkdirSync(dir, { recursive: true });

  const base = state.data.question
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  let file = path.join(dir, `${base}.md`);
  if (fs.existsSync(file) && !force) {
    let n = 2;
    while (fs.existsSync(path.join(dir, `${base}-${n}.md`))) n++;
    file = path.join(dir, `${base}-${n}.md`);
  }

  const md = toMarkdown({ state, corpus, ledger, brief, topics });
  fs.writeFileSync(file, md, 'utf8');
  return { file, markdown: md };
}

module.exports = { toMarkdown, exportRun, linkTopics, hasBacktickedLink, citationLine };
