---
name: deep-research
description: Full adversarial deep dive — sliced perspectives with an anti-collapse gate, a three-verifier panel on load-bearing claims, and four red-team lenses. Use when a question is contested, when a decision rests on the answer, or when the user asks for depth. For a fast pass, use orient-research instead.
---

# deep-research

Produce a synthesized brief **plus a curated source list**, where every claim has been checked
against the text of the source it cites — and where the perspectives, the verifiers and the
red team are all set against each other rather than working in the same direction.

**This is the expensive mode.** 4–6 perspective subagents, up to three verifiers per
load-bearing claim, four red-team lenses: 15–25 subagent dispatches. For a fast orientation
pass, use `orient-research`.

All state lives in `runs/<run-id>/`. **Never edit `corpus.jsonl`, `ledger.jsonl` or `run.json`
by hand** — always go through `bin/research.js`. The CLI enforces gates that cannot be enforced
by good intentions, and hand-editing silently removes them.

This procedure is explicit on purpose. A skill that says "verify the claims" produces a
verification-shaped performance rather than verification.

---

## 0. Is the question runnable? — do this before anything else

```bash
node bin/research.js scope "<the user's request>"
```

**Exit 1 means the request is too vague to research.** Do not seed. Do not route a domain. Do
not dispatch a perspective.

This matters more here than in `orient-research`, because a deep run costs 15–25 subagent
dispatches. Spending that on an unclear question produces a confident, well-verified brief
answering a question nobody asked — and the verification machinery makes it *more* persuasive,
not less.

**On exit 1:** dispatch one `scope-scout` subagent. It does two or three quick searches and
returns three or four concrete directions. Present them and **stop**.

> Before I spend a deep run on this — "<request>" is broad enough that it would come back
> shallow despite the cost. A few ways to take it:
>
> 1. …
> 2. …
> 3. …
>
> Or tell me the angle you care about and I'll work from that.

**Then wait.** If the user has nothing further to add, say you need a narrower question and
stop. **Do not fall back to running it anyway**, and do not silently downgrade to
`orient-research` — if the question is not clear enough for a deep run, it is not clear enough
for a fast one either.

The check is a first-pass signal, not the final word. If the user's intent is obvious from
context you may proceed and **say why you overrode it**. A `runnable-but-broad` verdict is
worth surfacing before committing to the expense.

## 1. Route the domain

List options with `node bin/research.js domains`. Pick by what the question *is*, not by where
you expect to search:

| Question shape | Domain |
|---|---|
| Biology, medicine, health, neuroscience | `biomedical` |
| Physics, chemistry, ML/CS research | `physical_cs` |
| A language, framework, protocol, tool | `software` |
| Markets, policy, regulation, economics | `economics_policy` |
| Historical events, texts, interpretation | `history_humanities` |
| Something unfolding now | `current_events` |

If the question genuinely spans domains, pass `--domains a,b` rather than guessing one — the
union of retrieval sets is used and the ambiguity is recorded. Tell the user which domain you
routed to; a mis-route distorts every tier in the run, and saying it out loud is how it gets
caught early.

## 2. Seed

```bash
node bin/research.js seed "<question>" --domain <d> --mode deep
```

If the retrieval keywords differ from the question as asked, pass `--query "<keywords>"` so the
exported note keeps the real question as its title.

**Confirm with the user before starting** if they did not explicitly ask for depth — this mode
costs substantially more than `orient-research` and takes considerably longer.

## 3. Web retrieval — required for web-heavy domains

For `software`, `current_events`, and partly `economics_policy`, the seed corpus will be thin
or empty: those domains' primary sources live on the web and there is no keyless search API,
so **you** are the retrieval layer.

Run WebSearch, WebFetch the most authoritative 3–8 results, and ingest each:

```bash
node bin/research.js ingest-web <run> --url "<url>" --title "<title>" --text "<page text>"
```

Prefer official documentation, specifications, RFCs, source repositories, filings, and primary
datasets over tutorials and commentary. The tier the tool assigns depends on the URL, so
fetching the real spec rather than a blog post *about* the spec directly changes what can be
verified.

## 3b. Concept expansion — check for vendor-owned terminology

If the question contains a term that might be coined by one organization, test it:

```bash
node bin/research.js provenance <run> "<term>"
```

**Exit 1 means the term is single-source** — one origin supplies most of the literature
mentioning it. That is an evidence trap, not a finding: searching a coined term returns only
its coiner, and the resulting thin corpus *reads* as "under-studied" when it may be
"differently named".

On exit 1, dispatch the `concept-expansion` subagent. It works from the term's **functional
definition** rather than its name, searches other literatures for the same structure, and
answers whether the phenomenon appears independently, whether competing definitions exist, and
whether the concept predates the term.

Do not skip this because the corpus "looks thin". Thin is the symptom it exists to diagnose.

## 4. Perspectives — 4 to 6

Read the corpus first. Choose perspectives grounded in **what the sources actually contain**,
not from your own knowledge of the topic.

Partition the corpus rather than eyeballing it:

```bash
node bin/research.js slice <run> --perspectives 5
```

Each slice gets the shared core plus a disjoint remainder. Dispatch one `perspective` subagent
per slice, passing **only that slice's source ids**.

### 4b. Overlap gate

After interrogation, before drafting claims:

```bash
node bin/research.js overlap <run>
```

**Exit 1 means two perspectives wrote substantially the same notes.** Re-run the worse of each
flagged pair with the taken framings explicitly excluded, then re-check.

Do not proceed past a failed overlap check. A run whose perspectives collapsed *looks*
multi-perspective and reads as well-corroborated while actually being one perspective repeated
— which is the failure this gate exists to catch, and it is invisible in the finished brief.

## 5. Draft claims

Every substantive sentence becomes a registered claim:

```bash
node bin/research.js claim <run> --text "<claim>" --sources S1,S4 --by perspective:<id>
```

**Write nothing you cannot cite.** If you want to assert something the corpus does not support,
either retrieve a source for it or drop it. `claim` refuses uncited text.

## 6. Verify — one `verifier` subagent per claim

The verifier gets the claim and `research.js source` output. Nothing else. Record what it
returns:

```bash
node bin/research.js verify <run> <C-id> --source S1 \
  --verdict supported --span "<verbatim text from the source>" \
  --role result --reason "<specific, source-grounded reason>"
```

A non-zero exit means the claim did not survive.

**Do not retry with a different span to make it pass.** Take the failure and move on — that is
the ledger doing its job, and gaming it converts the whole apparatus into theater. If a
`WARNING` about a mis-declared span role appears, surface it; do not quietly proceed.

### Panel escalation

Mark a claim `--load-bearing` when it sits in the lead, in the summary, or supports two or more
sections. Those claims need **three independent verifier subagents**, each dispatched fresh so
it forms its own view.

`assemble` **drops** a load-bearing claim that received fewer than three verifications. That is
deliberate: keeping it at single-verifier confidence while the report implies a panel reviewed
it is worse than losing it, because the reader cannot tell the difference. A split panel is
recorded as contested and never resolved for the reader.

## 7. Red team — all four lenses

Always: `redteam-source-quality` and `redteam-recency`. For the top sources, have the recency
lens run `research.js citing` and record its judgment with `research.js health`.

Then `redteam-counter-evidence` (attacks the thesis, hunts for disconfirming literature) and
`redteam-skeptic` (argues the case a hostile domain expert would make). Each is a **separate
dispatch** — one agent asked for four critiques produces four shallow ones.

Do not skip these to save time. On a real run the source-quality lens found a false negative
in the tool's own independence check; the counter-evidence lens found that the brief's central
premise was untested by any lane.

## 8. Assemble

```bash
node bin/research.js brief <run> --file <path-to-brief.md>
node bin/research.js assemble <run>
```

`assemble` finalizes dispositions, applies tier caps, computes independence, and writes
`report.html`.

## 8b. Record what ran — and what you skipped

`assemble` infers `perspectives`, `interrogation`, `synthesis` and `verification` from
evidence on disk. It cannot infer `outline` or `redteam`. Mark those explicitly:

```bash
node bin/research.js stage <run> redteam --status complete
node bin/research.js stage <run> outline --status skipped
```

**If you skipped a stage — for cost, time, or any other reason — mark it `skipped` and say so
in your report.** An unmarked stage renders as "did not run", which is correct; a skipped stage
you never disclosed is a run that looks more thorough than it was.

## 9. Report to the user

**Lead with the answer to the question**, not with process. Then: the routed domain, source
count by tier, claims kept / weakened / dropped / contested, and the path to `report.html`. Offer `node bin/research.js export <run>` if they want a
portable markdown note (Obsidian-compatible frontmatter and wikilinks).

**If the run was degraded, lead with that** — not as a footnote. A degraded run covered less
than it appears to, and a reader who does not know that will over-trust it.

---

## Rules

- Never write a claim without a citation.
- Never re-run a failed verification hoping for a pass.
- Never let a verifier subagent have web access — its evidence base is the stored source text.
- A run that rejects **nothing** is suspicious. Say so rather than presenting it as clean.
- Contradiction between sources is the most valuable output of a run. Surface it; never
  average it into a consensus that does not exist.
