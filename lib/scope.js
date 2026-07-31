'use strict';
const { contentTokens } = require('./relevance');

// A question too vague to retrieve on wastes an entire run: the corpus comes back broad and
// shallow, perspectives have nothing to divide, and the brief answers a question nobody asked.
// Cheaper to stop before spinning up agents and ask what the user actually wants.
//
// This is a FIRST-PASS SIGNAL, not the decision. Vagueness is genuinely subjective, so the
// orchestrator judges on top of it and may override with a stated reason. What this removes is
// the case where nobody checked at all.

// Words that frame a request without narrowing its subject. "Tell me about X" carries exactly
// as much subject as "X".
const FRAME_WORDS = new Set([
  'tell', 'give', 'show', 'explain', 'describe', 'discuss', 'summarize', 'summarise',
  'research', 'look', 'find', 'know', 'learn', 'understand', 'want', 'need', 'please',
  'everything', 'anything', 'something', 'stuff', 'things', 'info', 'information',
  'overview', 'introduction', 'basics', 'general', 'brief', 'quick',
]);

// Markers that a question asks for a RELATION rather than a topic dump. An angle gives
// perspectives something to divide along.
const ANGLE_MARKERS = [
  /\bhow\b/i, /\bwhy\b/i, /\bwhen\b/i, /\bwhether\b/i,
  /\bcompare|versus|vs\.?\b|\bdifference|differ\b/i,
  /\bevolv|origin|history|develop\b/i,
  /\bmechanism|cause|effect|impact|influence|relationship|interact\b/i,
  /\bevidence|support|contested|debate|controvers\b/i,
  /\btrade-?off|advantage|disadvantage|limitation\b/i,
  /\bbetween\b/i,
];

const MIN_SUBJECT_TOKENS = 3;
const MIN_WITH_ANGLE = 2;

function subjectTokens(question) {
  return contentTokens(question).filter(t => !FRAME_WORDS.has(t));
}

function hasAngle(question) {
  return ANGLE_MARKERS.some(re => re.test(String(question || '')));
}

function assessScope(question) {
  const subject = subjectTokens(question);
  const angle = hasAngle(question);

  const runnable = subject.length >= MIN_SUBJECT_TOKENS
    || (subject.length >= MIN_WITH_ANGLE && angle);

  const reasons = [];
  if (subject.length === 0) {
    reasons.push('No subject at all: the request names nothing specific enough to retrieve on.');
  } else if (subject.length < MIN_WITH_ANGLE) {
    reasons.push(`Only one subject term (${subject.join(', ')}). A single broad noun will `
      + 'return a corpus about everything and a brief about nothing.');
  } else if (!runnable) {
    reasons.push(`Two subject terms (${subject.join(', ')}) and no stated angle. `
      + 'Retrieval will be broad and the perspectives will have nothing to divide along.');
  }
  if (runnable && !angle) {
    reasons.push('Specific enough to run, but no angle is stated — the brief will be '
      + 'descriptive rather than answering a question.');
  }

  return {
    runnable,
    question: String(question || ''),
    subject,
    subjectCount: subject.length,
    hasAngle: angle,
    reasons,
    verdict: runnable
      ? (angle ? 'runnable' : 'runnable-but-broad')
      : 'too-vague',
  };
}

module.exports = {
  assessScope, subjectTokens, hasAngle,
  FRAME_WORDS, ANGLE_MARKERS, MIN_SUBJECT_TOKENS, MIN_WITH_ANGLE,
};
