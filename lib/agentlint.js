'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The agent layer's invariants, checked mechanically.
//
// CLAUDE.md states the load-bearing one in prose: the verifier "must never have web access
// or a search tool... That constraint lives in the agent's `tools:` frontmatter, not in
// prose." It did live there — and nothing read it. A verifier that can search will confirm
// claims from parametric memory or a stray blog post, which is the precise failure the tool
// exists to prevent, and it would have shipped green. Prose is not a gate; an exit code is.

// Roles whose entire evidence base is `research.js source` output. Deliberately a short
// list: the perspectives and red-team lenses are *supposed* to search, and a boundary rule
// that fired on every agent would be a warning nobody reads.
const EVIDENCE_BOUNDED = ['verifier'];

// Matches the tool families that can reach outside stored source text. Substring matching
// rather than an allowlist of known tool names, so a tool added to the harness next month
// is caught by default instead of passing until someone remembers to list it.
const REACHES_OUTSIDE = /web|search|fetch|browser|crawl|http/i;

const REQUIRED_KEYS = ['name', 'description', 'tools'];

// Minimal frontmatter reader: the `---` fenced block at the top of the file, `key: value`
// per line, indented lines continuing the previous value. Returns null when there is no
// fence at all, which is itself a finding rather than an empty result.
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].trim();
    } else if (key && /^\s+\S/.test(line)) {
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

function splitTools(value) {
  return String(value || '').split(',').map(t => t.trim()).filter(Boolean);
}

function readSkillText(skillsDir) {
  let all = '';
  let entries = [];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const f = path.join(skillsDir, e.name, 'SKILL.md');
    if (fs.existsSync(f)) all += fs.readFileSync(f, 'utf8') + '\n';
  }
  return all;
}

function lintAgents({ agentsDir, skillsDir } = {}) {
  const violations = [];
  const add = (agent, rule, detail) => violations.push({ agent, rule, detail });

  let files;
  try {
    files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort();
  } catch {
    add(null, 'missing-dir', `no agents directory at ${agentsDir}`);
    return { ok: false, violations };
  }
  if (files.length === 0) add(null, 'missing-dir', `no agent files in ${agentsDir}`);

  const skillText = readSkillText(skillsDir);
  if (skillText === null) add(null, 'missing-dir', `no skills directory at ${skillsDir}`);

  for (const file of files) {
    const name = path.basename(file, '.md');
    const fm = parseFrontmatter(fs.readFileSync(path.join(agentsDir, file), 'utf8'));

    if (!fm) {
      add(name, 'frontmatter', 'no --- frontmatter block');
      continue;
    }
    const missing = REQUIRED_KEYS.filter(k => !fm[k]);
    if (missing.length) add(name, 'frontmatter', `missing ${missing.join(', ')}`);

    if (fm.name && fm.name !== name) {
      add(name, 'name-mismatch', `frontmatter name "${fm.name}" does not match ${file}`);
    }

    if (EVIDENCE_BOUNDED.includes(name)) {
      const reaching = splitTools(fm.tools).filter(t => REACHES_OUTSIDE.test(t));
      if (reaching.length) {
        add(name, 'evidence-boundary',
          `evidence-bounded role declares ${reaching.join(', ')} — its only input is `
          + '`research.js source` output');
      }
    }

    // An agent no skill names is either dead weight or a rename that broke a dispatch.
    // Both are worth a line; neither is guesswork, because the skills name agents verbatim.
    if (skillText !== null && !skillText.includes(`\`${name}\``)) {
      add(name, 'orphan', 'no SKILL.md names this agent');
    }
  }

  return { ok: violations.length === 0, violations };
}

module.exports = { lintAgents, parseFrontmatter, splitTools, EVIDENCE_BOUNDED, REACHES_OUTSIDE };
