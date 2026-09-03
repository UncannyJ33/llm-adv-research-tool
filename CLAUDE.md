# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                          # full suite, no network
node --test test/spancheck.test.js  # one file
node --test test/evals/            # FAILS — Node 25 resolves a bare dir as a module path
node --test test/evals/planted-error.test.js   # use the file path instead
```

There is no build, no lint config, and **no runtime dependencies** — `dependencies` in
`package.json` must stay empty, and dev dependencies are disallowed too (use `node:test`).

`node bin/research.js` with no arguments prints the full CLI reference. Start there rather
than reading `bin/research.js` top to bottom.

## The central architecture idea

**Everything mechanical lives in Node; everything requiring judgment lives in a subagent.**
That line is the whole design, and most bugs in this repo's history came from putting
something on the wrong side of it.

| Deterministic (`lib/`, unit-tested, no LLM) | Generative (`.claude/agents/`) |
|---|---|
| Retrieval, dedup, screening, tiering | Domain classification, perspective discovery |
| **Quote-span checking** (`spancheck.js`) | Claim verification verdicts |
| Section detection, role overrides | Citation-health judgment |
| Independence + provenance analysis | Red-team lenses |
| Corpus/ledger/state, render, export | Synthesis |

The consequence that matters: **a hallucinated citation is caught by `String.includes`, not by
another model's judgment.** A model can be argued into agreeing; string matching cannot.

## Gates are exit codes

Several CLI verbs exit non-zero to stop a pipeline step from proceeding. This is load-bearing —
an agent must not be able to talk its way past a failed check:

| Verb | Exits 1 when |
|---|---|
| `scope` | question too vague to research |
| `checkspan` / `verify` | span not found in stored source text, or effective verdict ≠ supported |
| `provenance` | a term is owned by one origin (evidence trap) |
| `overlap` | two perspectives wrote substantially the same notes |
| `lint-agents` | the agent layer breaks one of its own invariants |
| `doctor` | every probeable retrieval adapter is unreachable |

**`verify` deliberately rejects a `--span-check` flag.** The agent supplies a span; Node decides
whether it matched. Passing the result in is a hard error. Do not add a way to bypass this.

**`lint-agents` checks the constraints this file states in prose.** The verifier's tool
boundary lived in one line of frontmatter and nothing read it — a one-word edit could have
granted it `WebSearch` with the whole suite still green. `lib/agentlint.js` reads that
frontmatter now, and `test/agentlint.test.js` runs the check against this repo's own
`.claude/` on every `npm test`, so the skills do not need to invoke it per run. Its
evidence-bounded list is deliberately one role long: perspectives and red-team lenses are
*supposed* to search, and a boundary rule that fired on all of them would be noise.

## Rules that exist because they were violated

Each of these encodes a real bug. Changing them will reintroduce it.

- **Marker inflation destroys signal.** A warning that always fires teaches the reader to
  ignore it. This failed three times: a tier cap that made every claim "weakened", confidence
  markers capped by evidence basis, and six pipeline stages that had no code path to mark them
  complete so they rendered "did not run" forever. Before adding a caution, check it can ever
  be absent.
- **Authority is domain-relative** (`lib/domains.js`, data not code). A language spec is primary
  for a software question and gray literature for a biomedical one. Ambiguous routing tiers each
  source under whichever candidate table fits it — one table applied to a cross-domain corpus
  capped every ML preprint below verified. The same defect has both signs: a bare
  `github.com` pattern tiered every issue thread `primary / official-source`, so a stranger's
  comment outranked the spec it contradicted, while `raw.githubusercontent.com` matched no
  forge pattern and tiered actual source code `weak`. Classify the *surface*, not the host.
- **Section detection may only weaken a claim, never strengthen it.** A detected `Limitations`
  heading overrides a declared `result`; a detected `Results` heading can never upgrade a span
  the verifier honestly called a limitation.
- **`caveat` is a distinct span role.** A claim restating a hedge *as* a hedge is legitimate
  citation. Without it, the hard-fail on `limitation` silently killed true claims.
- **Screening is fail-open; verification is fail-closed.** `relevance.js` keeps when it cannot
  judge (a thin corpus is worse than a slightly noisy one). `pipeline.js` drops when it cannot
  confirm (a load-bearing claim without its full panel is dropped, not kept at single-verifier
  confidence).
- **Concurrency requires the lock.** Corpus and ledger writes are read-modify-write on whole
  files. Any new mutating CLI verb must wrap `withLock(dir, …)` and **reload state inside the
  lock** — state read before acquiring it is already stale. Two parallel searches once produced
  the same source id resolving to different papers. **Writers take the lock; readers do not** —
  `loadRun` parses `run.json` before acquiring anything — so every whole-file save goes through
  `writeFileAtomic()` (write sibling temp, rename over the target). A plain `writeFileSync` is a
  truncate followed by a write and a concurrent reader parses the gap: 16 truncated reads out of
  250 in the test that guards it.
- **Author names arrive in two formats.** Europe PMC returns `Hibbett D`, Crossref returns
  `David S. Hibbett`. Use `authorKey()` from `lib/independence.js` for any author comparison;
  naive string equality silently counted one person as two independent origins.
- **All network calls go through `lib/retrieve/http.js`.** It provides per-host pacing and
  bounded backoff on 429/5xx. Calling `fetch` directly in an adapter reintroduces the throttling
  that thinned a real corpus.
- **A degraded run must announce it.** API failures, failed perspectives and skipped stages all
  surface in the report. A run that looks complete but covered less is indistinguishable from a
  good one at read time.

## Testing conventions

- Adapters split into a thin `fetch` layer and a pure `normalize()`. Tests cover `normalize()`
  against fixtures in `test/fixtures/` — **never the network**. CLI tests set
  `RESEARCH_OFFLINE=1` to stay hermetic.
- **Fixtures must be captured from the live API, not hand-written.** A hand-written OpenAlex
  fixture once contained `is_indexed_in_scopus`, a field the API does not return: the test
  passed while the code read `undefined` and demoted every real journal.
- **Verify a new gate's test actually fails without the gate.** The concurrency test was checked
  against a disabled lock first (8 concurrent ingests collapse to 1 source without it). A gate
  test that has never failed is not known to have teeth.
- `test/evals/planted-error.test.js` injects known-false claims and asserts they are caught. It
  also documents, as an explicit passing test, the case code *cannot* catch: a genuine span with
  an honest role attached to a claim about the wrong population. If that regresses, the fix is
  `.claude/agents/verifier.md`, not `lib/`.

## Agent layer

`.claude/skills/{orient,deep}-research/SKILL.md` orchestrate; `.claude/agents/*.md` define the
roles. Both skills run `scope` first and **refuse to research a question too vague to answer** —
there is deliberately no fallback that runs it anyway.

**The `verifier` agent must never have web access or a search tool.** Its evidence base is
`research.js source` output alone. A verifier that can search will "confirm" claims from
parametric memory or a stray blog post, which reintroduces the exact failure the tool exists to
prevent. That constraint lives in the agent's `tools:` frontmatter, not in prose.

Red-team lenses are separate dispatches on purpose — one agent asked for four critiques produces
four shallow ones.

## Repository conventions

- `runs/`, `exports/` and `private/` are gitignored and hold research content. **Never commit
  anything from them**, and keep personal references out of code comments and tests — this repo
  is public.
- Skills use relative `node bin/research.js`. Global installs under `~/.claude/skills/` need
  those rewritten absolute (see README) or every command resolves to nothing.
- Commits go directly to `main` for this repo by owner preference; a PreToolUse hook will warn
  about it, which is expected here.
