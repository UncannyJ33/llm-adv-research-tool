'use strict';

// Spec §10. Self-contained HTML — inline CSS/JS, no external requests — so a report opens
// from disk years later. Scannable in two minutes; auditable sentence-by-sentence when it
// matters.

const TIER_ORDER = ['primary', 'secondary', 'weak'];
const TIER_LABEL = { primary: 'Primary', secondary: 'Secondary', weak: 'Weak / supporting' };

const CONFIDENCE_MARK = {
  verified: '&#9989;',
  weakened: '&#9888;&#65039;',
  contested: '&#128310;',
  dropped: '&#9940;',
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function citation(rec) {
  const authors = (rec.authors || []).slice(0, 3).join(', ')
    + ((rec.authors || []).length > 3 ? ' et al.' : '');
  const bits = [
    authors,
    rec.year ? `(${rec.year})` : '',
    rec.title,
    rec.venue && rec.venue.name ? `<em>${escapeHtml(rec.venue.name)}</em>` : '',
  ].filter(Boolean);

  let out = bits
    .map(b => (b.startsWith('<em>') ? b : escapeHtml(b)))
    .join('. ');

  const link = rec.doi ? `https://doi.org/${rec.doi}` : (rec.oa_pdf_url || rec.url);
  if (link) out += ` <a href="${escapeHtml(link)}" rel="noopener">link</a>`;
  return out;
}

// Entries are keyed on the stable corpus id, NEVER on array position. Positional numbering
// aligned with S-ids only while no source was ever excluded; one retracted source dropped at
// seed would have shifted every number and silently pointed each citation at the wrong paper.
function bibSection(recs) {
  const byTier = new Map(TIER_ORDER.map(t => [t, []]));
  for (const rec of recs) {
    const t = TIER_ORDER.includes(rec.tier) ? rec.tier : 'weak';
    byTier.get(t).push(rec);
  }

  let html = '';
  for (const tier of TIER_ORDER) {
    const group = byTier.get(tier);
    if (!group.length) continue;
    html += `<h3>${TIER_LABEL[tier]} <span class="count">${group.length}</span></h3><ul class="bib">`;
    for (const rec of group) {
      html += `<li><span class="sid">${escapeHtml(rec.id)}</span> ${citation(rec)}`
        + (rec.tier_basis ? ` <span class="basis">${escapeHtml(rec.tier_basis)}</span>` : '')
        + (rec.used_by && rec.used_by.length
          ? ` <span class="basis">cited by ${escapeHtml(rec.used_by.join(', '))}</span>` : '')
        + '</li>';
    }
    html += '</ul>';
  }
  return html;
}

function bibliography(corpus) {
  const all = corpus.all();
  if (!all.length) return '<p class="empty">No sources retrieved.</p>';

  const cited = all.filter(r => r.used_by && r.used_by.length);
  const unused = all.filter(r => !r.used_by || !r.used_by.length);

  let html = '';
  html += `<h2 class="sub">Cited <span class="count">${cited.length}</span></h2>`;
  html += cited.length
    ? bibSection(cited)
    : '<p class="empty">No source survived into the brief.</p>';

  if (unused.length) {
    html += `<h2 class="sub">Retrieved but not cited <span class="count">${unused.length}</span></h2>`;
    html += '<p class="meta">Returned by retrieval and admitted, but no surviving claim rests '
      + 'on them. Skim for anything the run missed &mdash; and for retrieval noise.</p>';
    html += bibSection(unused);
  }
  return html;
}

function claimBlocks(claims, opts = {}) {
  let html = '';
  for (const c of claims) {
    const last = c.verification[c.verification.length - 1];
    html += '<div class="rej">';
    html += `<div class="rej-claim">${CONFIDENCE_MARK[c.confidence] || ''} `
      + `<strong>${escapeHtml(c.original_text || c.text)}</strong></div>`;
    if (c.final_text) {
      html += `<div class="rej-line"><span class="k">Kept as</span> ${escapeHtml(c.final_text)}</div>`;
    }
    if (c.cited_source_ids && c.cited_source_ids.length) {
      html += `<div class="rej-line"><span class="k">Cited</span> ${escapeHtml(c.cited_source_ids.join(', '))}</div>`;
    }
    if (c.drafted_by) {
      html += `<div class="rej-line"><span class="k">Drafted by</span> ${escapeHtml(c.drafted_by)}</div>`;
    }
    if (c.disposition_reason) {
      html += `<div class="rej-line override"><span class="k">Outcome</span> ${escapeHtml(c.disposition_reason)}</div>`;
    }
    if (c.secondary_reason) {
      html += `<div class="rej-line flag">${escapeHtml(c.secondary_reason)}</div>`;
    }
    if (c.independent_corroboration && c.independent_corroboration.independent_count
        < c.independent_corroboration.cited_count) {
      html += `<div class="rej-line flag">${escapeHtml(c.independent_corroboration.reason)}</div>`;
    }

    // A contested claim asserts that verifiers disagreed. Showing only the last verification
    // asserts the disagreement without exhibiting it — so contested renders every position.
    const shown = opts.showAll ? c.verification : [last];
    for (const v of shown) {
      if (!v) continue;
      if (opts.showAll) {
        html += `<div class="rej-line"><span class="k">Verifier ${v.verifier}</span> `
          + `<strong>${escapeHtml(v.effective_verdict)}</strong></div>`;
      }
      html += `<div class="rej-line"><span class="k">Reason</span> ${escapeHtml(v.reason)}</div>`;
      if (v.override_reason) {
        html += `<div class="rej-line override"><span class="k">Override</span> ${escapeHtml(v.override_reason)}</div>`;
      }
      html += '<div class="rej-line"><span class="k">Span</span> '
        + `${v.quoted_span ? `&ldquo;${escapeHtml(v.quoted_span)}&rdquo;` : 'no supporting span found'}`
        + ` <span class="basis">${escapeHtml(v.span_check)}`
        + `${v.span_role ? ` / ${escapeHtml(v.span_role)}` : ''}`
        + ` / ${escapeHtml(v.evidence_basis)}</span></div>`;
      if (v.reason_quality === 'low') {
        html += '<div class="rej-line flag">Rationale does not reference source '
          + 'content &mdash; low-quality reason, treat this verdict with suspicion.</div>';
      }
      if (v.role_warning) {
        html += `<div class="rej-line flag">${escapeHtml(v.role_warning)}</div>`;
      }
    }
    html += '</div>';
  }
  return html;
}

// Dropped and weakened are DIFFERENT outcomes and must never share a heading. A weakened
// claim survives into the brief; listing it under "Rejected" made kept work look discarded.
function rejectionLedger(ledger) {
  const dropped = ledger.dropped();
  const weakened = ledger.weakened();
  const contested = ledger.contested();

  if (!dropped.length && !weakened.length && !contested.length) {
    return '<p class="empty">Nothing was dropped, weakened or contested in this run. '
      + 'A run that rejects nothing is worth a second look &mdash; it may mean the verifier '
      + 'is asleep.</p>';
  }

  let html = '';
  if (dropped.length) {
    html += `<h3>Dropped &mdash; absent from the brief <span class="count">${dropped.length}</span></h3>`;
    html += claimBlocks(dropped);
  }
  if (weakened.length) {
    html += `<h3>Weakened &mdash; present in the brief, held below verified <span class="count">${weakened.length}</span></h3>`;
    html += claimBlocks(weakened);
  }
  if (contested.length) {
    html += `<h3>Contested &mdash; verifiers disagreed <span class="count">${contested.length}</span></h3>`;
    html += '<p class="meta">Every verifier position is shown. Disagreement is the finding; '
      + 'it is not resolved for you.</p>';
    html += claimBlocks(contested, { showAll: true });
  }
  return html;
}

function briefHtml(brief) {
  if (!brief) {
    return '<p class="empty">No synthesized brief yet &mdash; this run has completed '
      + 'retrieval only. The bibliography and ledger below are complete.</p>';
  }
  // Minimal markdown: headings and paragraphs. The brief is generated internally, so this
  // is a formatter, not a general-purpose markdown parser.
  return brief
    .split(/\n{2,}/)
    .map(block => {
      const h = block.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const level = Math.min(h[1].length + 1, 5);
        return `<h${level}>${escapeHtml(h[2])}</h${level}>`;
      }
      return `<p>${escapeHtml(block.trim())}</p>`;
    })
    .join('\n');
}

const CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--accent:#0b5fff;--warn:#b45309;--warnbg:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e8e8;--muted:#9aa0a6;--line:#2a2e35;--accent:#7aa2ff;--warn:#fbbf24;--warnbg:#3a2f12}}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.25rem;background:var(--bg);color:var(--fg);
font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:52rem;margin:0 auto}
h1{font-size:1.6rem;margin:0 0 .25rem}
h2{font-size:1.2rem;margin:2.5rem 0 .75rem;padding-bottom:.35rem;border-bottom:1px solid var(--line)}
h3{font-size:1rem;margin:1.5rem 0 .5rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
h2.sub{font-size:1.05rem;margin:1.75rem 0 .5rem;border:0;color:var(--fg)}
.meta{color:var(--muted);font-size:.875rem;margin-bottom:1.5rem}
.meta code{background:rgba(128,128,128,.14);padding:.1rem .35rem;border-radius:3px}
.count{color:var(--muted);font-weight:400}
.empty{color:var(--muted);font-style:italic}
ul.bib{padding-left:1.1rem;list-style:none}
ul.bib li{margin:.5rem 0;text-indent:-1.1rem;padding-left:1.1rem}
.sid{font:.75rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);margin-right:.4rem}
.basis{font:.72rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
a{color:var(--accent)}
.rej{border-left:3px solid var(--line);padding:.6rem 0 .6rem .9rem;margin:1rem 0}
.rej-claim{margin-bottom:.4rem}
.rej-line{font-size:.9rem;color:var(--muted);margin:.2rem 0}
.rej-line .k{display:inline-block;min-width:5.5rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.rej-line.override{color:var(--fg)}
.rej-line.flag{color:var(--warn)}
.degraded,.incomplete{background:var(--warnbg);border:1px solid var(--warn);border-radius:6px;padding:.9rem 1.1rem;margin:1.5rem 0}
.degraded h2,.incomplete h2{border:0;margin:0 0 .4rem;font-size:1rem}
.incomplete{background:transparent;border-style:dashed}
.incomplete code{background:rgba(128,128,128,.14);padding:.05rem .3rem;border-radius:3px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
.scroll{overflow-x:auto}
`;

function renderHtml({ state, corpus, ledger, brief = null }) {
  const d = state.data;
  const degraded = state.isDegraded();

  let notice = '';
  if (degraded) {
    const rows = d.degradations
      .map(x => `<li><strong>${escapeHtml(x.kind)}</strong> &mdash; ${escapeHtml(x.detail)}`
        + `${x.impact ? ` <span class="basis">${escapeHtml(x.impact)}</span>` : ''}</li>`)
      .join('');
    const failed = d.perspectives.filter(p => p.status === 'failed')
      .map(p => `<li>Perspective <strong>${escapeHtml(p.id)}</strong> failed`
        + `${p.error ? `: ${escapeHtml(p.error)}` : ''}</li>`)
      .join('');
    notice = `<div class="degraded"><h2>This run was degraded</h2>`
      + `<p>It covered less than a clean run would. Read the findings with that in mind.</p>`
      + `<ul>${rows}${failed}</ul></div>`;
  }

  // A skipped quality gate is indistinguishable from a passed one unless it is named.
  const skipped = state.skippedStages ? state.skippedStages() : [];
  let skippedNotice = '';
  if (skipped.length) {
    skippedNotice = '<div class="incomplete"><h2>Stages that did not run</h2>'
      + '<p>These checks were never performed, so their absence is not evidence that '
      + 'nothing was wrong.</p><ul>'
      + skipped.map(s => `<li><code>${escapeHtml(s)}</code></li>`).join('')
      + '</ul></div>';
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(d.question)}</title>
<style>${CSS}</style></head>
<body><main>
<h1>${escapeHtml(d.question)}</h1>
<div class="meta">
  <code>${escapeHtml(d.mode)}</code>
  &middot; domain <code>${escapeHtml(d.domain)}</code>
  ${d.ambiguous ? `(ambiguous: ${escapeHtml(d.candidate_domains.join(', '))})` : ''}
  &middot; confidence <code>${escapeHtml(d.domain_confidence)}</code>
  &middot; ${corpus.all().length} sources
  &middot; ${escapeHtml(d.run_id)}
</div>
${notice}
${skippedNotice}
<h2>Brief</h2>
${briefHtml(brief)}
<h2>Bibliography</h2>
${bibliography(corpus)}
<h2>Claim ledger</h2>
<p class="meta">Nothing is deleted, only demoted. This is also where you find out the
<em>tool</em> is wrong &mdash; a claim you know to be true showing up as dropped means the
verifier is too aggressive or the corpus is thin.</p>
${rejectionLedger(ledger)}
</main></body></html>`;
}

module.exports = { renderHtml, escapeHtml, bibliography, rejectionLedger, citation };
