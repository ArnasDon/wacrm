// ============================================================
// Trava do handoff no modo comercial (Bloco 3-A).
//
// Regra do Ricardo: o agente comercial nunca passa uma conversa para
// a equipa sem ter nome, email e motivo de contacto registados. Isto
// NÃO pode viver só no prompt — um prompt cede a quem insista — por
// isso esta verificação corre em código, sempre que o modelo emite o
// sinal de handoff (HANDOFF_SENTINEL) numa conversa comercial. Ver
// dispatchInboundToAiReply em auto-reply.ts, que é o único chamador.
//
// Válvula de escape: se a mesma conversa for bloqueada
// `maxAttempts` vezes seguidas, a tentativa seguinte deixa passar na
// mesma (com o que houver), marcando `handoff_incomplete = true` — o
// objectivo é nunca prender alguém irritado a repetir dados que não
// quer dar.
// ============================================================

export type MissingHandoffField = 'name' | 'email' | 'reason' | 'company'

export interface HandoffReadinessInput {
  contactName: string | null | undefined
  contactEmail: string | null | undefined
  escalationReason: string | null | undefined
  /** Nome concreto da empresa do lead — NÃO o sector (ver defaults.ts).
   *  Ricardo pediu isto a 21/09/2026: sem saber a empresa concreta, não
   *  sabe com quem vai falar na reunião. */
  contactCompany: string | null | undefined
}

export interface HandoffReadiness {
  ready: boolean
  missing: MissingHandoffField[]
}

/** Fallback used whenever `ai_configs.max_handoff_blocked_attempts`
 *  isn't set (older rows, or an `AiConfig` literal built in a test). */
export const DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS = 2

/**
 * Checks whether a commercial conversation has everything the Ricardo's
 * rule requires before it can be handed off to a human: the contact's
 * name, their email, and the reason they want to talk to someone.
 */
export function checkHandoffReadiness(input: HandoffReadinessInput): HandoffReadiness {
  const missing: MissingHandoffField[] = []
  if (!input.contactName || !input.contactName.trim()) missing.push('name')
  if (!input.contactEmail || !input.contactEmail.trim()) missing.push('email')
  if (!input.escalationReason || !input.escalationReason.trim()) missing.push('reason')
  if (!input.contactCompany || !input.contactCompany.trim()) missing.push('company')
  return { ready: missing.length === 0, missing }
}

const MISSING_FIELD_LABELS: Record<MissingHandoffField, string> = {
  name: 'o teu nome',
  email: 'o teu email',
  reason: 'o motivo do que precisas',
  company: 'o nome da empresa',
}

/**
 * Builds the fixed, natural-sounding message sent to the customer when
 * a handoff attempt is blocked for missing data. Deterministic (no
 * extra LLM call) — same discipline as the other fixed messages in
 * handoff.ts / commercial.ts, so it can never fail or contradict the
 * rule it exists to enforce.
 */
export function buildMissingInfoNudge(missing: MissingHandoffField[]): string {
  const labels = missing.map((field) => MISSING_FIELD_LABELS[field])
  return (
    `Antes de chamar aqui alguém da equipa, preciso só de ${joinPt(labels)}, ` +
    'para saberem com quem vão falar e sobre o quê. Podes dizer-me?'
  )
}

function joinPt(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} e ${items[1]}`
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

/**
 * Decides what happens to a blocked handoff attempt: keep blocking
 * (nudge the customer, stay in the loop) or let it through incomplete
 * (the escape valve). `attemptsSoFar` is the conversation's current
 * `handoff_blocked_attempts` counter (before this attempt).
 */
export function shouldForceHandoffThrough(
  attemptsSoFar: number,
  maxAttempts: number = DEFAULT_MAX_HANDOFF_BLOCKED_ATTEMPTS,
): boolean {
  return attemptsSoFar >= maxAttempts
}
