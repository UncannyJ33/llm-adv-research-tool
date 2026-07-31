'use strict';

// The quote gate (spec §8.2). Every claim reaching a brief must be justified by a verbatim
// span from stored source text. The verifier returns the span; this module greps it.
//
// This is the one place a hallucinated justification is caught by CODE rather than by another
// model's judgment. A model can be argued into agreeing. String.includes cannot.

// A span shorter than this cannot function as evidence — "the results" would match nearly any
// source, which would turn a pass into meaningless noise. Rejecting is the fail-closed choice.
const MIN_SPAN_CHARS = 40;

function normalize(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFKC')                      // ligatures (ﬁ -> fi), compatibility forms
    .replace(/­/g, '')                 // soft hyphen
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-') // en/em dash, minus -> hyphen
    .replace(/-\s*\n\s*/g, '')              // PDF line-break hyphenation: "ap-\nproximately"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function checkSpan(span, sourceText, opts = {}) {
  const min = opts.minChars || MIN_SPAN_CHARS;

  if (span === null || span === undefined || String(span).trim() === '') {
    return {
      result: 'no_span_offered',
      reason: 'Verifier returned no supporting span.',
      normalizedSpan: '',
    };
  }

  const nSpan = normalize(span);
  if (nSpan.length < min) {
    return {
      result: 'too_short',
      reason: `Span is ${nSpan.length} normalized characters; minimum evidentiary length is ${min}.`,
      normalizedSpan: nSpan,
    };
  }

  const nSource = normalize(sourceText);
  if (!nSource) {
    return {
      result: 'fail_not_found',
      reason: 'No stored source text to check against.',
      normalizedSpan: nSpan,
    };
  }

  if (nSource.includes(nSpan)) {
    return {
      result: 'pass',
      reason: 'Span found verbatim in stored source text.',
      normalizedSpan: nSpan,
    };
  }

  return {
    result: 'fail_not_found',
    reason: 'Span not present in the stored source text after normalization.',
    normalizedSpan: nSpan,
  };
}

module.exports = { normalize, checkSpan, MIN_SPAN_CHARS };
