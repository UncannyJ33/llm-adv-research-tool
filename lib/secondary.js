'use strict';

// Spec §8.7.2. Citing a review that cites the primary study is the thing a thesis committee
// objects to, and for a concrete reason: reviews introduce transcription drift. The claim as
// stated in a review is often subtly stronger than the primary result it describes, so a
// brief built on reviews inherits an inflation nobody introduced deliberately.

function isSecondary(rec) {
  if (!rec) return false;
  if (String(rec.work_type || '').toLowerCase() === 'review') return true;
  return /review/i.test(String(rec.tier_basis || ''));
}

function classifySupport(cited) {
  const list = (cited || []).filter(Boolean);
  const reviewIds = list.filter(isSecondary).map(r => r.id);
  const primaryIds = list.filter(r => !isSecondary(r)).map(r => r.id);
  const secondaryOnly = list.length > 0 && primaryIds.length === 0;

  return {
    secondaryOnly,
    reviewIds,
    primaryIds,
    reason: secondaryOnly
      ? `Support rests only on review articles (${reviewIds.join(', ')}). Reviews restate `
        + 'primary results and often strengthen them in the retelling; trace the claim to the '
        + 'primary work before relying on it.'
      : 'Support includes at least one primary source.',
  };
}

module.exports = { isSecondary, classifySupport };
