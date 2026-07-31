'use strict';
const { makeClaim, HARD_FAIL_ROLES, LIMITATION_COMPATIBLE_ROLES } = require('./ledger');
const { checkSpan } = require('./spancheck');
const { detectSection, crossCheck } = require('./spanrole');
const { analyze } = require('./independence');
const { classifySupport } = require('./secondary');

function registerClaim(ledger, fields) {
  return ledger.add(makeClaim(fields));
}

// The agent supplies the span. THIS function decides whether it matched — there is
// deliberately no argument by which a caller can assert the check passed.
function verifyClaim({ corpus, ledger, claimId, sourceId, verdict, span, role, reason }) {
  const rec = corpus.get(sourceId);
  if (!rec) throw new Error(`unknown source: ${sourceId}`);

  const { text, basis } = corpus.getText(sourceId);
  const spanResult = checkSpan(span, text);
  const detected = detectSection(text, span);
  const cross = crossCheck(role, detected);

  // Section detection is asymmetric: it can only make a claim WEAKER, never stronger.
  //
  // Without this, a verifier could quote a limitations sentence verbatim ("we do not support
  // arbitrary IO"), label it `result`, and have the claim it contradicts land as supported —
  // every mechanical check green. Honouring the detected section closes that.
  //
  // The reverse never applies: a detected `result` can never upgrade a span the verifier
  // honestly declared a limitation. So a false heading match costs at worst a true claim,
  // which lands visibly in the ledger with its reason — the cheap failure, by design.
  let effectiveRole = role || null;
  let roleOverride = null;

  // `caveat` already acknowledges the span sits in a limitation — the claim restates it as
  // a caveat rather than inverting it into a finding. Overriding it to `limitation` would
  // kill a legitimately-cited hedge.
  const alreadyAccountedFor = detected.section === 'limitation'
    ? LIMITATION_COMPATIBLE_ROLES.includes(role)
    : HARD_FAIL_ROLES.includes(role);

  if (
    detected.confidence === 'high'
    && HARD_FAIL_ROLES.includes(detected.section)
    && !alreadyAccountedFor
  ) {
    effectiveRole = detected.section;
    roleOverride = `Declared role "${role}" was overridden to "${detected.section}": the span `
      + `sits under a "${detected.heading}" heading in the source.`;
  }

  const record = ledger.recordVerification(claimId, {
    verdict,
    reason,
    quoted_span: span || null,
    span_check: spanResult.result,
    span_role: effectiveRole,
    evidence_basis: basis,
  });

  record.source_id = sourceId;
  record.declared_role = role || null;
  record.detected_section = detected.section;
  record.detected_heading = detected.heading;
  record.role_warning = cross.warning;
  if (roleOverride) {
    record.override_reason = record.override_reason
      ? `${roleOverride} ${record.override_reason}`
      : roleOverride;
  }
  return record;
}

const TIER_RANK = { primary: 3, secondary: 2, weak: 1 };

// Spec §8.3: load-bearing claims get a three-verifier panel in `deep` mode.
const PANEL_SIZE = 3;

function finalize({ corpus, ledger, state, mode }) {
  const effectiveMode = mode || (state && state.data && state.data.mode) || 'orient';

  const counts = {
    claims_drafted: ledger.all().length,
    claims_kept: 0,
    claims_weakened: 0,
    claims_dropped: 0,
    contested: 0,
    under_verified: 0,
  };

  // Recomputed from scratch every finalize — accumulating across re-assembles would leave
  // stale claim ids on sources whose claims were later dropped.
  for (const rec of corpus.all()) rec.used_by = [];

  for (const claim of ledger.all()) {
    const cited = (claim.cited_source_ids || [])
      .map(id => corpus.get(id))
      .filter(Boolean);

    if (cited.length > 1) {
      claim.independent_corroboration = analyze(cited);
    }

    const support = classifySupport(cited);
    claim.secondary_only = support.secondaryOnly;
    claim.secondary_reason = support.secondaryOnly ? support.reason : null;

    // An unverified claim is DROPPED. Never silently kept — a claim that no verifier ever
    // looked at is exactly the thing this tool exists to keep out of a brief.
    if (!claim.verification.length) {
      claim.disposition_reason = 'No verifier examined this claim.';
      ledger.setDisposition(claim.claim_id, 'dropped');
      counts.claims_dropped++;
      continue;
    }

    // Panel shortfall FAILS CLOSED. Keeping a load-bearing claim at single-verifier
    // confidence while the report says a panel reviewed it would be worse than dropping it:
    // the reader cannot tell the difference, which is the whole failure mode.
    if (effectiveMode === 'deep'
      && claim.load_bearing
      && claim.verification.length < PANEL_SIZE) {
      claim.under_verified = true;
      claim.disposition_reason = 'Load-bearing claim received '
        + `${claim.verification.length} of ${PANEL_SIZE} required panel verifications. `
        + 'Dropped rather than kept at single-verifier confidence.';
      ledger.setDisposition(claim.claim_id, 'dropped');
      counts.claims_dropped++;
      counts.under_verified++;
      continue;
    }

    const verdicts = claim.verification.map(v => v.effective_verdict);
    const supported = verdicts.filter(v => v === 'supported').length;

    // "Contested" means the VERIFIERS disagree with each other — genuine dispute worth
    // surfacing both sides of. A claim that is simply contradicted by its own source is not
    // contested, it is wrong, and it must be dropped. Treating a lone `contradicted` as
    // contested would promote refuted claims into the brief's contested section.
    const disputed = supported > 0
      && verdicts.some(v => v === 'unsupported' || v === 'contradicted');

    if (disputed) {
      ledger.setDisposition(claim.claim_id, 'contested');
      counts.contested++;
      continue;
    }
    if (!supported) {
      claim.disposition_reason = claim.disposition_reason
        || `No verifier fully supported this claim (${verdicts.join(', ')}).`;
      ledger.setDisposition(claim.claim_id, 'dropped');
      counts.claims_dropped++;
      continue;
    }

    // A panel majority that only PARTIALLY supports a claim must not yield full confidence.
    // Counting a lone `supported` among hedged verdicts as verified would make a panel weaker
    // than a single verifier — the majority's reservations would vanish from the output.
    if (verdicts.length > 1 && supported < Math.ceil(verdicts.length / 2)) {
      claim.disposition_reason = `Panel majority did not fully support this claim `
        + `(${verdicts.join(', ')}). Held below verified.`;
      ledger.setDisposition(claim.claim_id, 'weakened', { final_text: claim.text });
      counts.claims_weakened++;
      continue;
    }

    // Spec §8.6: a claim resting only on sources below its domain's primary tier can
    // never reach `verified`.
    const best = cited.length
      ? Math.max(...cited.map(r => TIER_RANK[r.tier] || 1))
      : 0;
    if (best < TIER_RANK.primary) {
      ledger.setDisposition(claim.claim_id, 'weakened', { final_text: claim.text });
      counts.claims_weakened++;
    } else {
      ledger.setDisposition(claim.claim_id, 'kept', { confidence: 'verified' });
      counts.claims_kept++;
    }
  }

  // A source counts as USED only if a claim citing it survived into the brief. Without this,
  // a 93-source bibliography gives no signal that four sources carried the whole argument —
  // which is the opposite of the curation the tool exists to provide.
  for (const claim of ledger.surviving()) {
    for (const id of claim.cited_source_ids || []) {
      const rec = corpus.get(id);
      if (rec && !rec.used_by.includes(claim.claim_id)) rec.used_by.push(claim.claim_id);
    }
  }

  counts.sources_cited = corpus.all().filter(r => r.used_by.length).length;

  ledger.save();
  if (state) state.setCounts(counts);
  return counts;
}

module.exports = { registerClaim, verifyClaim, finalize, TIER_RANK, PANEL_SIZE };
