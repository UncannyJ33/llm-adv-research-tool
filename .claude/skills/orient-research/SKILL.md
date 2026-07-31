---
name: orient-research
description: Fast verified orientation on an unfamiliar topic — a short brief plus a curated source list, every claim checked against source text. Use when the user wants to get oriented, understand what something is, or find good sources without a full deep dive.
---

# orient-research

**A fast pass that still cannot lie to you.** ~1000 words, 10–15 sources, minutes rather than
tens of minutes. Every claim is still checked against the verbatim text of the source it
cites — `orient` trades *breadth* for speed, never the verification floor.

Use `deep-research` instead when the question is contested, when a decision rests on the
answer, or when the user asks for depth.

All state lives in `runs/<run-id>/`. **Never edit `corpus.jsonl`, `ledger.jsonl` or `run.json`
by hand** — go through `bin/research.js`. The CLI enforces gates that cannot be enforced by
good intentions.

---

## 1. Route the domain

`node bin/research.js domains`

| Question shape | Domain |
|---|---|
| Biology, medicine, health, neuroscience | `biomedical` |
| Physics, chemistry, ML/CS research | `physical_cs` |
| A language, framework, protocol, tool | `software` |
| Markets, policy, regulation, economics | `economics_policy` |
| Historical events, texts, interpretation | `history_humanities` |
| Something unfolding now | `current_events` |

Spans domains? Pass `--domains a,b` — each source is then tiered under whichever table fits
it, instead of forcing one table onto everything. **Tell the user which domain you routed to.**

## 2. Seed

```bash
node bin/research.js seed "<question>" --domain <d> --mode orient
```

If the keywords that search well differ from the question as asked, pass
`--query "<keywords>"` so the exported note keeps the real question as its title.

## 3. Web retrieval — required for web-heavy domains

For `software`, `current_events` and partly `economics_policy`, the seed corpus will be thin:
those domains' primary sources live on the web and there is no keyless search API, so **you
are the retrieval layer.**

WebSearch, then WebFetch the 3–8 most authoritative results, and ingest each:

```bash
node bin/research.js ingest-web <run> --url "<url>" --title "<title>" --text "<page text>"
```

Prefer official documentation, specifications, filings and primary datasets over commentary.

## 4. Check for vendor-owned terminology

If the question contains a term one organisation may have coined:

```bash
node bin/research.js provenance <run> "<term>"
```

**Exit 1 means single-source.** That is an evidence trap, not a finding — searching a coined
term returns only its coiner, and the thin corpus *reads* as "under-studied" when it may be
"differently named". Dispatch `concept-expansion`, which works from the term's functional
definition instead of its name.

## 5. Two perspectives

Read the corpus, then pick two angles grounded in **what the sources actually contain** — not
from your own knowledge. Dispatch one `perspective` subagent each, giving each a different
subset of sources.

## 6. Draft claims

```bash
node bin/research.js claim <run> --text "<claim>" --sources S1,S4 --by perspective:<id>
```

**Write nothing you cannot cite.** `claim` refuses uncited text.

## 7. Verify — one `verifier` subagent per claim

The verifier gets the claim and `research.js source` output. Nothing else — **no web access**.

```bash
node bin/research.js verify <run> <C-id> --source S1 \
  --verdict supported --span "<verbatim text from the source>" \
  --role result --reason "<specific, source-grounded reason>"
```

Non-zero exit means the claim did not survive. **Do not retry with a different span to make it
pass** — that converts the whole apparatus into theatre.

## 8. Red team — two lenses

Dispatch `redteam-source-quality` and `redteam-recency`. For the top 3 sources, have the
recency lens run `research.js citing` and record its judgment with `research.js health`.

## 9. Assemble and record

```bash
node bin/research.js brief <run> --file <path-to-brief.md>
node bin/research.js stage <run> outline --status skipped
node bin/research.js assemble <run>
```

`orient` does not build a formal outline, so mark it skipped rather than leaving it as "did
not run". **If you skipped anything else — for cost or time — mark it and say so.**

## 10. Report

**Lead with the answer to the question**, not with process. Then: routed domain, sources by
tier, claims kept / weakened / dropped / contested, and the path to `report.html`. Offer
`export` for a portable markdown note.

**If the run was degraded, lead with that instead.** A degraded run covered less than it
appears to.

---

## Rules

- Never write a claim without a citation.
- Never re-run a failed verification hoping for a pass.
- Never give a verifier web access — its evidence base is the stored source text.
- A run that rejects **nothing** is suspicious. Say so.
- Contradiction between sources is the most valuable output. Surface it; never average it away.
