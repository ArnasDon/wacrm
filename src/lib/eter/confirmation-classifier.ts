// ============================================================
// Deterministic classification of an inbound WhatsApp reply against a
// pending write-gate proposal (agent_pending_actions) — PT-PT
// "sim"/"não" detection. Pure, synchronous, no I/O — the LLM fallback
// (for anything that doesn't match here) lives in pending-confirmation.ts,
// which is the only caller that needs network/DB access.
//
// Bias: exact-match only, against a closed phrase list, after
// normalizing accents/case/punctuation. Substring/fuzzy matching was
// deliberately rejected — "sim, mas será que dá para outro dia?"
// contains "sim" as a substring but is NOT an unambiguous confirmation,
// and a false-positive confirm here means booking a meeting the lead
// didn't actually agree to (see write-gate.ts's whole reason for
// existing). Anything that isn't an exact match falls through to
// `other`, which the caller routes to the LLM classifier — also
// instructed to prefer `other` on any doubt.
// ============================================================

export type DeterministicClassification = 'confirm' | 'reject' | 'other'

const CONFIRM_PHRASES = [
  'sim',
  'confirmo',
  'ok',
  'esta bem',
  'pode ser',
  'combinado',
  'perfeito',
  'claro',
  'sim por favor',
  // Reasonable close variants of the above.
  'tudo bem',
  'fica combinado',
  'sim confirmo',
  'sim, confirmo',
]

const REJECT_PHRASES = [
  'nao',
  'nao pode',
  'cancela',
  'deixa estar',
  'outro dia',
  'mais tarde',
  // Reasonable close variants of the above.
  'nao pode ser',
  'cancelar',
  'nao obrigado',
  'nao, obrigado',
]

/**
 * Strip accents, lowercase, trim, and drop leading/trailing
 * punctuation. "Está bem!", "ESTÁ BEM.", "  está bem," all normalize
 * to "esta bem". Internal punctuation (commas inside a phrase) is
 * intentionally left alone — the phrase lists above spell out the
 * handful of variants with internal punctuation they need to match
 * ("sim, confirmo", "não, obrigado") explicitly, rather than stripping
 * all punctuation and risking collapsing genuinely different
 * sentences into the same normalized string.
 */
export function normalizeConfirmationText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/^[.,!?;:¿¡\s]+/, '')
    .replace(/[.,!?;:¿¡\s]+$/, '')
    .replace(/\s+/g, ' ')
}

const NORMALIZED_CONFIRM = new Set(CONFIRM_PHRASES.map(normalizeConfirmationText))
const NORMALIZED_REJECT = new Set(REJECT_PHRASES.map(normalizeConfirmationText))

/** Deterministic classification only — never calls out to an LLM.
 *  Returns 'other' for anything not an exact (post-normalization)
 *  match against the closed confirm/reject phrase lists. */
export function classifyConfirmationDeterministic(raw: string): DeterministicClassification {
  const normalized = normalizeConfirmationText(raw)
  if (NORMALIZED_CONFIRM.has(normalized)) return 'confirm'
  if (NORMALIZED_REJECT.has(normalized)) return 'reject'
  return 'other'
}
