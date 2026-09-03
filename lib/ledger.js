'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic } = require('./lock');

// Spec §8.7.4 + §8.8. Two jobs:
//   1. Enforce span-role hard failures in CODE, so a clean quote match cannot launder a
//      claim that the source never actually asserted.
//   2. Retain every rejection with its reasoning. Nothing is deleted, only demoted — the
//      ledger is where you discover the TOOL is wrong, not just where the sources are.

const SPAN_ROLES = [
  'result', 'method', 'limitation', 'speculation',
  'background', 'related-work', 'quoting-others',
  // `caveat` = the span IS a stated limitation and the CLAIM restates it as one. Reporting
  // "the authors note several key differences remain" by quoting the caveat is legitimate
  // citation, not a limitation inverted into a finding. Without this role, the hard-fail on
  // `limitation` silently kills true claims whose whole content is the source's own hedge —
  // often the most important claims in a brief.
  'caveat',
];

// A clean span_check proves the text EXISTS in the source. It does not prove the source
// ASSERTS the claim. These roles mean it does not.
const HARD_FAIL_ROLES = ['limitation', 'speculation', 'related-work', 'quoting-others'];

// Roles that legitimately correspond to text sitting in a limitations section.
const LIMITATION_COMPATIBLE_ROLES = ['limitation', 'caveat'];

const ROLE_EXPLANATION = {
  limitation: 'the span comes from a limitations section — "we cannot rule out X" is not evidence that X occurs',
  speculation: 'the span comes from a speculative passage, not a reported result',
  'related-work': 'the span comes from a related-work or background section, so it describes another work\'s finding and citing it here attributes the claim to the wrong paper',
  'quoting-others': 'the span is the source quoting someone else, so it attributes the claim to another work',
};

function makeClaim(fields = {}) {
  return {
    claim_id: null,
    text: '',
    drafted_by: null,
    cited_source_ids: [],
    load_bearing: false,
    verification: [],
    panel: false,
    secondary_only: false,
    secondary_reason: null,
    independent_corroboration: null,
    under_verified: false,
    disposition_reason: null,
    disposition: 'pending',
    original_text: null,
    final_text: null,
    confidence: null,
    ...fields,
  };
}

// A rejection reason must be a REASON, not a category label. "Unsupported" is a label.
// A rationale that never references source content is itself a quality failure (spec §8.8).
function gradeReason(reason) {
  const text = String(reason || '').trim();
  if (text.length < 40) return 'low';
  const referencesSource = /\b(source|paper|study|article|abstract|section|report|author|states?|reports?|describes?|says?|find(s|ing)?|observ|measur|document)/i.test(text);
  return referencesSource ? 'ok' : 'low';
}

class Ledger {
  constructor(runDir) {
    this.runDir = runDir;
    this.claims = [];
    this.nextId = 1;
    fs.mkdirSync(runDir, { recursive: true });
  }

  static load(runDir) {
    const l = new Ledger(runDir);
    const file = path.join(runDir, 'ledger.jsonl');
    if (!fs.existsSync(file)) return l;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    l.claims = lines.map(x => JSON.parse(x));
    const nums = l.claims
      .map(c => parseInt(String(c.claim_id).slice(1), 10))
      .filter(Number.isFinite);
    l.nextId = nums.length ? Math.max(...nums) + 1 : 1;
    return l;
  }

  add(claim) {
    const id = `C${this.nextId++}`;
    claim.claim_id = id;
    this.claims.push(claim);
    return id;
  }

  get(id) {
    return this.claims.find(c => c.claim_id === id) || null;
  }

  all() {
    return this.claims;
  }

  // `rejected` means "something was taken away" — used for the did-the-verifier-sleep check.
  // Display code must NOT use it as a heading: it includes weakened claims, which SURVIVE
  // into the brief. Showing those under "Rejected" made kept claims look discarded.
  rejected() {
    return this.claims.filter(c => c.disposition === 'dropped' || c.disposition === 'weakened');
  }

  kept() { return this.claims.filter(c => c.disposition === 'kept'); }
  weakened() { return this.claims.filter(c => c.disposition === 'weakened'); }
  dropped() { return this.claims.filter(c => c.disposition === 'dropped'); }
  contested() { return this.claims.filter(c => c.disposition === 'contested'); }

  // Claims that reach the brief in some form, as opposed to those removed from it.
  surviving() {
    return this.claims.filter(c =>
      ['kept', 'weakened', 'contested'].includes(c.disposition));
  }

  // The model reports a verdict. This method decides the EFFECTIVE verdict, and the model
  // does not get a vote on the overrides.
  recordVerification(claimId, v) {
    const claim = this.get(claimId);
    if (!claim) throw new Error(`unknown claim: ${claimId}`);

    if (v.span_role && !SPAN_ROLES.includes(v.span_role)) {
      throw new Error(`unknown span role: ${v.span_role}`);
    }

    const record = {
      verifier: claim.verification.length + 1,
      verdict: v.verdict,
      reason: v.reason || '',
      quoted_span: v.quoted_span || null,
      span_check: v.span_check,
      span_role: v.span_role || null,
      evidence_basis: v.evidence_basis || 'abstract_only',
      effective_verdict: v.verdict,
      override_reason: null,
      reason_quality: gradeReason(v.reason),
    };

    if (v.span_check !== 'pass' && v.verdict === 'supported') {
      record.effective_verdict = 'unsupported';
      record.override_reason =
        `Span check returned ${v.span_check}; a claim cannot be supported without a verbatim span in the stored source text.`;
    } else if (v.span_check === 'pass' && HARD_FAIL_ROLES.includes(v.span_role) && v.verdict === 'supported') {
      record.effective_verdict = 'unsupported';
      record.override_reason =
        `Span matched, but ${ROLE_EXPLANATION[v.span_role]}. The claim is not supported by this source even though the text is present.`;
    }

    claim.verification.push(record);
    return record;
  }

  setDisposition(claimId, disposition, opts = {}) {
    const claim = this.get(claimId);
    if (!claim) throw new Error(`unknown claim: ${claimId}`);
    claim.disposition = disposition;
    if (disposition === 'weakened') {
      claim.original_text = claim.original_text || claim.text;
      claim.final_text = opts.final_text || null;
      claim.confidence = 'weakened';
    } else if (disposition === 'dropped') {
      claim.confidence = 'dropped';
    } else if (disposition === 'kept') {
      claim.final_text = claim.text;
      claim.confidence = opts.confidence || 'verified';
    } else if (disposition === 'contested') {
      claim.confidence = 'contested';
    }
    return claim;
  }

  save() {
    const file = path.join(this.runDir, 'ledger.jsonl');
    const body = this.claims.map(c => JSON.stringify(c)).join('\n');
    writeFileAtomic(file, body + (body ? '\n' : ''));
    return file;
  }
}

module.exports = {
  Ledger, makeClaim, gradeReason,
  SPAN_ROLES, HARD_FAIL_ROLES, LIMITATION_COMPATIBLE_ROLES, ROLE_EXPLANATION,
};
