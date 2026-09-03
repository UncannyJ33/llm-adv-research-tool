'use strict';
// The agent layer had exactly one mechanical check on it: none. CLAUDE.md says the verifier
// "must never have web access or a search tool... that constraint lives in the agent's
// `tools:` frontmatter, not in prose" — but nothing read that frontmatter. A one-word edit
// could hand the verifier WebSearch and every test in this repo would still pass.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lintAgents, parseFrontmatter, EVIDENCE_BOUNDED, EVIDENCE_BOUNDED_TOOLS } = require('../lib/agentlint');

const ROOT = path.resolve(__dirname, '..');

function bench(agents, skills = { 'demo-research': '' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentlint-'));
  const agentsDir = path.join(dir, 'agents');
  const skillsDir = path.join(dir, 'skills');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const [name, body] of Object.entries(agents)) {
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), body);
  }
  for (const [name, body] of Object.entries(skills)) {
    fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, name, 'SKILL.md'), body);
  }
  return { agentsDir, skillsDir };
}

const agent = (name, tools) =>
  `---\nname: ${name}\ndescription: Does a thing.\ntools: ${tools}\n---\n\nBody.\n`;

// A SKILL.md that names every agent it is given, so orphan checks stay out of the way of
// the rule under test.
const mentioning = (...names) => names.map(n => `Dispatch the \`${n}\` subagent.`).join('\n');

test('parses the frontmatter block into keys', () => {
  const fm = parseFrontmatter(agent('verifier', 'Bash, Read'));
  assert.strictEqual(fm.name, 'verifier');
  assert.strictEqual(fm.tools, 'Bash, Read');
  assert.strictEqual(fm.description, 'Does a thing.');
});

test('a file with no frontmatter fence parses to null, not to an empty object', () => {
  assert.strictEqual(parseFrontmatter('# Just a heading\n'), null);
});

// The gate's whole reason for existing. If this test ever passes with the check removed,
// the check is decorative.
test('a verifier granted a web tool is a violation', () => {
  for (const tools of ['Bash, Read, WebSearch', 'Bash, WebFetch', 'Read, Bash, browser_navigate']) {
    const { agentsDir, skillsDir } = bench(
      { verifier: agent('verifier', tools) },
      { r: mentioning('verifier') }
    );
    const { ok, violations } = lintAgents({ agentsDir, skillsDir });
    assert.strictEqual(ok, false, `${tools} should not lint clean`);
    assert.ok(
      violations.some(v => v.rule === 'evidence-boundary' && v.agent === 'verifier'),
      `${tools} should raise evidence-boundary, got ${JSON.stringify(violations)}`
    );
  }
});

// The denylist this replaced matched tool names against /web|search|fetch|browser|crawl|http/,
// so a verifier holding Task — which dispatches a subagent that can search — lint clean, and
// every mcp__* name did too. Verification is fail-closed: not-on-the-allowlist is the
// violation, no matter what the tool is called.
test('a verifier granted any tool outside the allowlist is a violation', () => {
  for (const tools of [
    'Bash, Read, Task',
    'Bash, Read, mcp__playwright__browser_navigate',
    'Bash, Read, Agent',
    'Bash, Read, Skill',
  ]) {
    const { agentsDir, skillsDir } = bench(
      { verifier: agent('verifier', tools) },
      { r: mentioning('verifier') }
    );
    const { ok, violations } = lintAgents({ agentsDir, skillsDir });
    assert.strictEqual(ok, false, `${tools} should not lint clean`);
    const boundary = violations.find(v => v.rule === 'evidence-boundary' && v.agent === 'verifier');
    assert.ok(boundary, `${tools} should raise evidence-boundary, got ${JSON.stringify(violations)}`);
    // The detail has to name the offending tool: "something is wrong with your tools" is a
    // warning nobody can act on.
    assert.match(boundary.detail, new RegExp(tools.split(', ').pop()));
  }
});

test('the verifier keeping Bash and Read lints clean', () => {
  const { agentsDir, skillsDir } = bench(
    { verifier: agent('verifier', 'Bash, Read') },
    { r: mentioning('verifier') }
  );
  assert.deepStrictEqual(lintAgents({ agentsDir, skillsDir }), { ok: true, violations: [] });
});

// The boundary is a property of the role, not of every agent. A rule that fired on all of
// them would be noise: the red-team lenses and perspectives are supposed to search.
test('a searching agent that is not evidence-bounded is fine', () => {
  const { agentsDir, skillsDir } = bench(
    { perspective: agent('perspective', 'Bash, Read, WebSearch, WebFetch') },
    { r: mentioning('perspective') }
  );
  assert.strictEqual(lintAgents({ agentsDir, skillsDir }).ok, true);
});

test('frontmatter name must match the filename a dispatch uses', () => {
  const { agentsDir, skillsDir } = bench(
    { 'redteam-recency': agent('redteam-recencyy', 'Bash, Read, WebSearch') },
    { r: mentioning('redteam-recency') }
  );
  const { ok, violations } = lintAgents({ agentsDir, skillsDir });
  assert.strictEqual(ok, false);
  assert.ok(violations.some(v => v.rule === 'name-mismatch'));
});

test('missing frontmatter keys are violations', () => {
  const { agentsDir, skillsDir } = bench(
    { broken: '---\nname: broken\n---\n\nNo description, no tools.\n' },
    { r: mentioning('broken') }
  );
  const { violations } = lintAgents({ agentsDir, skillsDir });
  const missing = violations.filter(v => v.rule === 'frontmatter').map(v => v.detail).join(' ');
  assert.match(missing, /description/);
  assert.match(missing, /tools/);
});

test('an agent no skill mentions is an orphan', () => {
  const { agentsDir, skillsDir } = bench(
    { verifier: agent('verifier', 'Bash, Read'), ghost: agent('ghost', 'Read') },
    { r: mentioning('verifier') }
  );
  const { ok, violations } = lintAgents({ agentsDir, skillsDir });
  assert.strictEqual(ok, false);
  assert.deepStrictEqual(violations.filter(v => v.rule === 'orphan').map(v => v.agent), ['ghost']);
});

test('a missing agents directory is a violation, not a silent pass', () => {
  const { skillsDir } = bench({}, { r: '' });
  const { ok, violations } = lintAgents({ agentsDir: path.join(os.tmpdir(), 'nope-' + Date.now()), skillsDir });
  assert.strictEqual(ok, false);
  assert.ok(violations.some(v => v.rule === 'missing-dir'));
});

// The regression guard. Everything above proves the gate has teeth on synthetic input;
// this proves the repo it ships in actually passes it.
test('this repo\'s own agent layer lints clean', () => {
  const result = lintAgents({
    agentsDir: path.join(ROOT, '.claude', 'agents'),
    skillsDir: path.join(ROOT, '.claude', 'skills'),
  });
  assert.deepStrictEqual(result.violations, [], 'real agent layer has violations');
  assert.strictEqual(result.ok, true);
});

test('verifier is the evidence-bounded role', () => {
  assert.ok(EVIDENCE_BOUNDED.includes('verifier'));
});

// The allowlist is the gate. Widening it is a deliberate act, and this test is the place it
// has to be argued for: `research.js source` output is read with Bash, and nothing else.
test('the evidence-bounded allowlist is exactly Bash and Read', () => {
  assert.deepStrictEqual([...EVIDENCE_BOUNDED_TOOLS].sort(), ['Bash', 'Read']);
});
