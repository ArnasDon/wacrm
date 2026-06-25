/**
 * Deterministic escalation guardrails (spec §6/§7).
 *
 * The first, pre-LLM half of the assistant's "fail safe to a human"
 * bias: before any Anthropic call we scan the inbound text for
 * account-configured escalation keywords and for explicit
 * "talk to a human" style requests. A hit forces an escalation with no
 * model call at all — cheaper, faster, and immune to a confused model.
 *
 * Pure and fully deterministic: no I/O, no clock, no randomness. All
 * the logic worth testing lives here so it can be exercised without a
 * Supabase / Anthropic mock (mirrors `src/lib/flows/fallback.ts`).
 *
 * Matching rules:
 * - Case-insensitive.
 * - Word-boundary anchored, so a keyword like `legal` matches
 *   "I need legal help" but NOT "illegal" or "delegal" — substring
 *   false-positives would silently route innocent traffic to a human.
 * - The built-in "talk to a human/agent/person/..." detection is always
 *   on, independent of the configured keyword list, so an account that
 *   trimmed its keywords still honours an explicit hand-off request.
 *
 * The returned `reason` is the literal `AiEscalationReason` value
 * `'keyword'` (spec §6: "keyword / 'talk to a human' → escalate
 * (reason=keyword)"), so callers can write it straight to
 * `ai_reply_log.reason` / `conversations.ai_escalation_reason`.
 */

import { type AiEscalationReason } from '@/types';

/** Outcome of the deterministic guardrail scan. */
export interface GuardrailResult {
  /** True when the inbound text must be escalated without an LLM call. */
  escalate: boolean;
  /**
   * Why we escalated — always the `'keyword'` reason for guardrail
   * hits (covers both configured keywords and explicit human requests).
   * Omitted when `escalate` is false.
   */
  reason?: AiEscalationReason;
}

/**
 * Phrases that explicitly ask to be handed to a person. Always checked,
 * regardless of the account's configured keyword list. Each entry is a
 * lowercase token sequence; we match it word-boundary anchored so
 * "speak to an agent" hits but "user agent" / "real estate agent"
 * patterns still rely on the surrounding verb to qualify.
 *
 * We intentionally pair a request verb ("talk to", "speak to", etc.)
 * with a human noun ("human", "agent", "person", ...) rather than
 * matching the noun alone — the bare nouns are already (optionally) in
 * the configured keyword list, and matching them unconditionally here
 * would double-cover and over-escalate (e.g. "your agent called me").
 */
const HUMAN_REQUEST_VERBS = [
  'talk to',
  'speak to',
  'speak with',
  'talk with',
  'chat with',
  'connect me to',
  'connect me with',
  'transfer me to',
  'put me through to',
  'get me',
  'i want',
  'i need',
  "i'd like",
  'i would like',
  'can i talk to',
  'can i speak to',
  'let me talk to',
  'let me speak to',
] as const;

const HUMAN_REQUEST_NOUNS = [
  'a human',
  'a real human',
  'a real person',
  'a person',
  'a real agent',
  'an agent',
  'a live agent',
  'a human agent',
  'a representative',
  'a rep',
  'a manager',
  'a real human being',
  'customer service',
  'customer support',
  'support agent',
  'someone real',
  'a real one',
] as const;

/**
 * Escape a string for safe use inside a `RegExp`, and collapse runs of
 * whitespace in the source phrase into `\s+` so multi-word phrases
 * tolerate any amount/kind of inter-word whitespace in the input.
 */
function phraseToPattern(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
}

/**
 * Build a single case-insensitive, word-boundary-anchored regex for a
 * phrase. `\b` is used where the phrase edge is a word character; for
 * phrases whose edges are non-word characters (e.g. "i'd like") we lean
 * on the surrounding structure instead — but every entry here begins
 * and ends with a word character, so `\b` on both sides is sound.
 */
function phraseRegex(phrase: string): RegExp {
  return new RegExp(`\\b${phraseToPattern(phrase)}\\b`, 'i');
}

/**
 * Pre-built explicit-human-request matchers: the cross product of
 * request verbs and human nouns ("talk to a human", "i need a manager",
 * …). Built once at module load — the lists are static.
 */
const HUMAN_REQUEST_REGEXES: RegExp[] = (() => {
  const out: RegExp[] = [];
  for (const verb of HUMAN_REQUEST_VERBS) {
    for (const noun of HUMAN_REQUEST_NOUNS) {
      out.push(phraseRegex(`${verb} ${noun}`));
    }
  }
  return out;
})();

/** True when the text explicitly asks to be handed to a person. */
function requestsHuman(text: string): boolean {
  return HUMAN_REQUEST_REGEXES.some((re) => re.test(text));
}

/**
 * True when any configured escalation keyword appears in the text as a
 * whole word (case-insensitive). Blank / whitespace-only keywords are
 * skipped so a stray empty string in the array can't match everything.
 */
function matchesKeyword(text: string, keywords: readonly string[]): boolean {
  for (const keyword of keywords) {
    if (typeof keyword !== 'string') continue;
    const trimmed = keyword.trim();
    if (trimmed.length === 0) continue;
    if (phraseRegex(trimmed).test(text)) return true;
  }
  return false;
}

/**
 * Decide whether an inbound customer message must be escalated to a
 * human BEFORE any LLM call.
 *
 * Returns `{ escalate: true, reason: 'keyword' }` when either:
 * - the text contains a configured escalation keyword as a whole word
 *   (case-insensitive, word-boundary anchored), OR
 * - the text is an explicit "talk to a human / agent / person" request.
 *
 * Otherwise returns `{ escalate: false }` and the caller proceeds to the
 * model. Empty / non-string input and an empty keyword list are handled
 * safely (no escalation, unless an explicit human request is present).
 */
export function shouldForceEscalate(
  inboundText: string,
  escalationKeywords: readonly string[]
): GuardrailResult {
  if (typeof inboundText !== 'string' || inboundText.trim().length === 0) {
    return { escalate: false };
  }

  const keywords = Array.isArray(escalationKeywords) ? escalationKeywords : [];

  if (matchesKeyword(inboundText, keywords) || requestsHuman(inboundText)) {
    return { escalate: true, reason: 'keyword' };
  }

  return { escalate: false };
}
