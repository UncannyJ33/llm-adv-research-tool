---
name: research
description: Run an adversarially-verified research brief on any topic. Use when the user asks to research something, deep-dive a subject, get oriented on an unfamiliar concept, or find sources on a question.
---

# research

Produce a synthesized brief **plus a curated source list**, where every claim has been checked
against the text of the source it cites.

All state lives in `runs/<run-id>/`. **Never edit `corpus.jsonl`, `ledger.jsonl` or `run.json`
by hand** — always go through `bin/research.js`. The CLI enforces gates that cannot be enforced
by good intentions, and hand-editing silently removes them.

This procedure is explicit on purpose. A skill that says "verify the claims" produces a
verification-shaped performance rather than verification.

---

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
node bin/research.js seed "<question>" --domain <d> --mode orient
```

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

## 4. Perspectives — `orient` uses 2

Read the corpus first. Choose perspectives grounded in **what the sources actually contain**,
not from your own knowledge of the topic. Dispatch one `perspective` subagent each, giving each
a different slice of the corpus so they do not converge on the same reading.

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

## 7. Red team — `orient` runs 2 lenses

Dispatch `redteam-source-quality` and `redteam-recency`. For the top 3 sources, have the recency
lens run `research.js citing` and record its judgment with `research.js health`.

## 8. Assemble

```bash
node bin/research.js brief <run> --file <path-to-brief.md>
node bin/research.js assemble <run>
```

`assemble` finalizes dispositions, applies tier caps, computes independence, and writes
`report.html`.

## 9. Report to the user

State: the routed domain, source count by tier, claims kept / weakened / dropped / contested,
and the path to `report.html`. Offer `node bin/research.js export <run>` if they want a
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
