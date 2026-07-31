'use strict';
const { normalize } = require('./spancheck');

// Span PRESENCE is mechanical (lib/spancheck.js). Span ROLE is a model judgment, so a
// verifier could label a limitations quote as `result` and the §8.7.4 override would never
// fire. This module makes a wrong role AUDITABLE: locate the span, find the nearest preceding
// section heading, and report whether the declared role contradicts it.
//
// It advises. It never overrides — a false heading match must not silently kill a true claim.

const SECTION_PATTERNS = [
  { section: 'limitation', re: /^\s*(limitations?|caveats?|threats to validity)\b/i },
  { section: 'related-work', re: /^\s*(related work|prior work|background|literature review)\b/i },
  { section: 'result', re: /^\s*(results?|findings?)\b/i },
  { section: 'method', re: /^\s*(methods?|materials and methods|methodology|experimental setup)\b/i },
  { section: 'speculation', re: /^\s*(discussion|future work|outlook|implications)\b/i },
];

const UNKNOWN = { section: 'unknown', heading: null, confidence: 'none' };

function detectSection(sourceText, span) {
  const text = String(sourceText || '');
  const nSpan = normalize(span);
  if (!nSpan || !normalize(text).includes(nSpan)) return { ...UNKNOWN };

  const lines = text.split('\n');
  let lastHeading = null;
  let lastSection = null;
  let acc = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // A heading is a short standalone line, not a sentence that happens to start with
    // "Results show that...".
    if (trimmed && trimmed.length < 60) {
      for (const p of SECTION_PATTERNS) {
        if (p.re.test(trimmed)) {
          lastHeading = trimmed;
          lastSection = p.section;
          break;
        }
      }
    }
    acc += ' ' + line;
    if (normalize(acc).includes(nSpan)) {
      return lastSection
        ? { section: lastSection, heading: lastHeading, confidence: 'high' }
        : { ...UNKNOWN };
    }
  }
  return { ...UNKNOWN };
}

// A claim that restates a caveat AS a caveat is correctly citing a limitations section.
const COMPATIBLE = { limitation: ['limitation', 'caveat'] };

function crossCheck(declaredRole, detected) {
  if (!detected || detected.section === 'unknown' || detected.confidence === 'none') {
    return { agrees: true, warning: null };
  }
  if (declaredRole === detected.section) return { agrees: true, warning: null };
  if ((COMPATIBLE[detected.section] || []).includes(declaredRole)) {
    return { agrees: true, warning: null };
  }

  return {
    agrees: false,
    warning: `Span sits under a "${detected.heading}" heading, which reads as `
      + `${detected.section}, but the verifier declared it ${declaredRole}. `
      + 'Check this citation by hand.',
  };
}

module.exports = { detectSection, crossCheck, SECTION_PATTERNS, COMPATIBLE };
