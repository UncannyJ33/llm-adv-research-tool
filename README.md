# llm-adv-research-tool

**Adversarially-verified research.** You ask a question; you get a synthesized brief **plus a
curated list of real primary sources** — and every claim in the brief has been checked, by
code, against the verbatim text of the source it cites.

The point is not that an agent wrote you a summary. It's that you can audit any sentence in
about two seconds, and that claims which don't survive checking are *shown to you with the
reason*, not silently dropped.

Zero runtime dependencies. Node + Markdown. Built for [Claude
Code](https://claude.com/claude-code), portable to any agent that can run a shell command.

---

## Why this exists

Most "research agents" track citations. Citation tracking tells you *which source a claim came
from*. It does not tell you *whether the source says that*. The gap between those two is where
research tools fail quietly — a real paper, a real link, and a sentence the paper never
supported.

This tool closes that gap mechanically:

- **Quote-or-drop.** A claim survives only if the verifier produces a *verbatim span* from the
  stored source text. Node normalizes and greps it. Not found → unsupported, whatever the
  model concluded. **A hallucinated justification is caught by `String.includes`, not by
  another model's judgment.** A model can be argued into agreeing; string matching cannot.
- **Span role matters as much as span presence.** A quote from a *limitations* section
  ("we cannot rule out X") does not support "X occurs". A quote from a *related-work* section
  describes someone else's finding, so citing it attributes the claim to the wrong paper.
  Both are rejected in code even on a clean text match.
- **Nothing is deleted, only demoted.** Every rejected claim keeps its text, its sources, and
  a specific source-grounded reason. So does every excluded source.

That last one has a second payoff worth more than the first: **the ledger is where you find
out the *tool* is wrong**, not just where the sources are. A claim you know to be true showing
up as dropped means the verifier is too aggressive or your corpus is thin. A tool that
discards silently gives you no way to learn it's discarding badly.

---

## Quickstart

Requires **Node ≥ 20**. Nothing to install.

```bash
git clone https://github.com/UncannyJ33/llm-adv-research-tool.git
cd llm-adv-research-tool
npm test          # 337 tests, no network
```

Then, in Claude Code from this directory:

```
/orient-research  How does synaptic pruning relate to critical periods in development?
/deep-research    Did the symbiosis between mycorrhizal fungi and trees evolve once or many times?
```

**Two skills, two jobs.**

| | `orient-research` | `deep-research` |
|---|---|---|
| For | "what is this", getting your bearings | contested questions, decisions resting on the answer |
| Perspectives | 2, hand-picked | 4–6, corpus-sliced with an anti-collapse gate |
| Verification | one verifier per claim | three-verifier panel on load-bearing claims |
| Red team | 2 lenses | 4 lenses |
| Cost | minutes, ~5 subagents | tens of minutes, 15–25 subagents |

**The verification floor is identical in both.** `orient` trades breadth for speed, never the
quote gate.

### Both refuse to start on a vague question

```bash
node bin/research.js scope "tell me about fungi"   # exits 1
```

A vague request does not produce a vague brief — it produces a *confident* brief answering a
question nobody asked, assembled from a corpus about everything. The verification machinery
makes that more persuasive, not less, which is precisely why the gate sits before it.

On a failed check the skills dispatch one cheap `scope-scout` agent, which does two or three
searches and returns three or four concrete directions grounded in what the field is actually
organised around. Then it **stops and waits** — there is deliberately no fallback that runs the
research anyway, because the run is not worth doing yet.

The check is mechanical (subject specificity plus whether an angle is stated) and therefore a
first-pass signal, not the final word. The orchestrator can override it, but has to say why.

To drive the pipeline yourself:

```bash
node bin/research.js domains                      # list routable domains
node bin/research.js doctor --domain biomedical   # are the channels up? exits 1 if none are
node bin/research.js seed "<question>" --domain biomedical --mode orient
node bin/research.js status  <run-id>
node bin/research.js assemble <run-id>            # -> runs/<run-id>/report.html
node bin/research.js export  <run-id>             # -> exports/<title>.md
node bin/research.js lint-agents                  # agent-layer invariants; exits 1 on violation
```

Set `RESEARCH_MAILTO` to your email for better OpenAlex/Crossref rate limits, and
`GITHUB_TOKEN` to raise GitHub's 10 req/min unauthenticated search limit — both optional.
`--offline` skips retrieval entirely and marks the run degraded.

### Installing the skills globally

By default the skills only work from inside the repo. To use them from any directory, copy
them into your user-level Claude Code config and **rewrite the relative tool path to an
absolute one** — a globally-installed skill is invoked from arbitrary directories, where
`node bin/research.js` resolves to nothing:

```bash
TOOL="$PWD"
mkdir -p ~/.claude/skills ~/.claude/agents
for s in orient-research deep-research; do
  mkdir -p ~/.claude/skills/$s
  sed "s|node bin/research.js|node $TOOL/bin/research.js|g" \
    .claude/skills/$s/SKILL.md > ~/.claude/skills/$s/SKILL.md
done
cp .claude/agents/*.md ~/.claude/agents/
```

Runs and exports are always written under the tool directory, not your current one, so your
research artifacts stay in a single place. If you move the repo, re-run the snippet above.

### Using it without Claude Code

Nothing here is Claude-specific except the files in `.claude/`. The tool is a CLI plus a set
of Markdown agent instructions, so any coding agent that can run shell commands can drive it —
port `.claude/skills/*/SKILL.md` into whatever prompt format your tool uses, and give the
verifier role the instructions in `.claude/agents/verifier.md`.

**One rule if you port it:** the verifier must have **no web access and no search tool**. Its
entire evidence base is `research.js source`. A verifier that can search will "confirm" claims
from parametric memory or a stray blog post, which reintroduces the exact failure the tool
exists to prevent. That constraint is enforced by the agent's *tool list*, not by asking nicely
in a prompt.

---

## Your research stays yours

`runs/`, `exports/` and `private/` are gitignored. Corpora, briefs, rendered reports and
exported notes never enter version control. Fork this, run your own questions, and nothing you
research is committed unless you deliberately move it somewhere tracked.

---

## The verify contract

The agent supplies a span. **Node decides whether it matched.**

```bash
node bin/research.js verify <run> C1 --source S3 \
  --verdict supported \
  --span "verbatim text copied from the source" \
  --role result \
  --reason "specific, source-grounded reason"
```

There is deliberately **no `--span-check` flag** — passing one is a hard error, so an agent
cannot assert its own gate result. `verify` exits non-zero unless the effective verdict is
`supported`, so a pipeline step cannot silently proceed past a failed gate.

Section detection is **asymmetric: it can only make a claim weaker, never stronger.** If a
verifier quotes a limitations sentence and labels it `result`, the document structure wins and
the claim is rejected. The reverse never happens — a detected `Results` heading cannot upgrade
a span the verifier honestly called a limitation. A false heading match therefore costs at most
one true claim, which lands visibly in the ledger with its reason.

`role` values: `result` · `method` · `limitation` · `speculation` · `background` ·
`related-work` · `quoting-others` · `caveat`.

`caveat` exists because a claim that *restates a hedge as a hedge* is legitimate citation.
Without it, the hard-fail on `limitation` silently killed true claims whose entire content was
the source's own caveat — often the most important claim in a brief.

---

## Authority is domain-relative

A language specification is the **primary** source for a software question and gray literature
for a biomedical one. A fixed academic hierarchy gets this backwards: it demotes specs,
statistical releases, court opinions and source code to "gray literature" while promoting weak
indexed papers — and on questions with no academic literature at all, *nothing* reaches
verified, every claim renders as a warning, and you learn to ignore the confidence markers
entirely.

| Domain | Primary sources |
|---|---|
| `biomedical` | Peer-reviewed indexed journals; health-agency data, regulatory filings, trial registries |
| `physical_cs` | Peer-reviewed venues, arXiv with citation traction, agency datasets and standards |
| `software` | Official docs, specifications, RFCs, source repositories, changelogs |
| `economics_policy` | Statistical agencies, primary legislation, institutional research |
| `history_humanities` | Primary documents, national archives, scholarly monographs |
| `current_events` | Primary documents, filings, datasets, named-source reporting |

Tables live in `lib/domains.js` as **data**. Adding a domain is an edit, not a build.

---

## Retrieval screening

Keyword retrieval returns junk. `lib/relevance.js` screens before admission — on one real run
it cut a corpus from 93 sources to 56 with zero paratext remaining:

- **Paratext** — figure and table captions, supplements, "References" sections, untitled records
- **Single-concept coincidence** — one shared token is coincidence; two is topicality
- **Generic-vocabulary-only** — `network`, `hub`, `architecture` describe a system's *shape*
  and are shared by every field that studies networks. A road-network paper matched "hub" +
  "network" against a neuroscience query and passed the two-concept rule until this was added.

It is **fail-open**: when it can't judge, it keeps, and every exclusion records a reason so
over-filtering is visible rather than silent. Hand-ingested web sources are never screened — a
human chose them deliberately.

**Known limit:** stem matching bridges `connectome` → `connected`, so an occasional off-topic
paper survives. That is the floor of lexical screening; tightening further started filtering
out genuinely relevant sources. Survivors land in "retrieved but not cited", not the main
bibliography.

---

## Single-source terms

When one organization coins a term, searching that term returns only that organization. The
thin corpus *reads* as "under-studied phenomenon" when it may be "well-studied phenomenon under
a different name" — the corpus confirms a sparsity the terminology itself created.

```bash
node bin/research.js provenance <run> "Zero Trust"   # exits 1 if one origin dominates
```

**One source from one origin counts as single-source** — it is more concentrated than three,
not less. On exit 1, the `concept-expansion` agent works from the term's *functional
definition* rather than its name and answers three questions: does the phenomenon appear
independently under another name, are there competing definitions, and **does the concept
predate the term?** That last one is unreachable by any amount of searching the term itself.

---

## Degradation is always disclosed

A run that looks complete but silently covered less is indistinguishable from a good one at
read time. That is how a research tool becomes untrustworthy without anyone noticing. So:

- A source API that failed is named in the report.
- A perspective that failed is named; the brief renders with fewer.
- **Stages that never ran are listed explicitly** — a skipped quality gate is
  indistinguishable from a passed one unless you say so.

---

## Layout

```
lib/
  domains.js        authority tables (data) + URL -> source-class rules
  domain-route.js   domain -> retrieval set, union on ambiguity
  relevance.js      paratext + coincidence screening
  spancheck.js      the quote gate
  spanrole.js       section detection, cross-checks a declared span role
  corpus.js         corpus store, ids, full-text vs abstract evidence basis
  retrieve/         openalex, europepmc, crossref, arxiv, github, web
  doctor.js         retrieval preflight — probes each adapter before a run
  agentlint.js      agent-layer invariants (the verifier's tool boundary)
  dedupe.js         DOI -> PMID -> arXiv -> title+year, richness-wins merge
  admissibility.js  retraction exclusion + domain-relative tiering
  independence.js   union-find over shared authors/cohorts
  provenance.js     single-source term detection
  ledger.js         claims, verifications, role overrides, rejections
  pipeline.js       claim lifecycle, dispositions, used/unused
  state.js          run.json checkpointing + degradation disclosure
  render.js         self-contained HTML report
  export.js         Obsidian-compatible markdown (frontmatter + wikilinks)
bin/research.js     CLI
.claude/            skill + agent definitions
```

## Testing

```bash
npm test
```

Adapters are tested against stored fixtures, never the network. Two suites carry most of the
weight: `spancheck` normalization (a false negative silently drops true claims; a false
positive defeats the whole mechanism) and `test/evals/planted-error.test.js`, which injects
known-false claims and asserts the gate catches them.

That eval also **documents what the code cannot catch**: a verifier can quote a real sentence,
label its role honestly, and still attach it to a claim about the wrong population — "100 µm in
rat cortex" cited for a claim about humans. The span is genuine, so no gate fires. That case
rests on verifier judgment, and the test records it as a known pass rather than pretending
otherwise.

## Deep mode

`deep` adds four things `orient` doesn't have, all enforced in code rather than requested in a
prompt:

**Perspective slicing.** `slice` partitions the corpus into a shared core (the most-cited
sources, which every perspective needs) plus disjoint remainders. Assignment is capped and
undersized slices collapse into their neighbours — on a real corpus, uncapped nearest-seed
assignment produced buckets of 41 and 5, and a perspective holding five sources is a crippled
agent rather than a different viewpoint. If a corpus only supports three clusters, you get
three slices, not five tiny ones.

**Anti-collapse gate.** `overlap` compares the perspectives' notes and **exits non-zero** if two
wrote substantially the same thing. Slicing makes divergence possible; this checks whether it
happened. A run whose perspectives collapsed reads as well-corroborated while being one
perspective repeated — invisible in the finished brief, which is exactly why it needs a gate.

**Escalation panel.** Load-bearing claims need three independent verifiers. A shortfall **fails
closed**: the claim is dropped rather than kept at single-verifier confidence, because a reader
cannot distinguish "one verifier agreed" from "a panel agreed" once it's in the brief. A split
panel is contested and never resolved for you.

**Contested synthesis.** Contested claims render *every* verifier's position. Showing only the
final verdict asserts that verifiers disagreed without exhibiting the disagreement.

Plus two further red-team lenses — `redteam-counter-evidence` (attacks the thesis, hunts
disconfirming literature) and `redteam-skeptic` (argues the hostile domain expert's case) — and
review-only support detection, since reviews restate primary results and often strengthen them
in the retelling.

```bash
node bin/research.js slice   <run> --perspectives 5
node bin/research.js overlap <run>                    # exits 1 on collapse
```

## Status

Both `orient` and `deep` are complete. Deferred: citation-health *tracing* to the primary work
(review-only support is flagged, not traced), cross-run corpus reuse, and mid-run interactive
steering.

## License

MIT — see [LICENSE](LICENSE).
