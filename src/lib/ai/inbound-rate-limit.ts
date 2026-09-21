import type { SupabaseClient } from '@supabase/supabase-js'
import { phonesMatch } from '@/lib/whatsapp/phone-utils'
import type { AiConfig } from './types'

/**
 * Bloco 3-A — limite de mensagens inbound antes de a IA responder.
 *
 * Contexto (Ricardo, 21/09/2026, campanha de anúncios a arrancar às
 * 9h30): o número de WhatsApp está exposto num anúncio pago, por isso
 * qualquer pessoa (ou script) pode inundá-lo com mensagens de um só
 * número ou com números falsos em sequência, queimando tokens de IA
 * sem controlo. Dois limites, ambos aplicados só à IA — a mensagem em
 * si é SEMPRE guardada normalmente pelo webhook (ver
 * dispatchInboundToAiReply em auto-reply.ts, que chama isto DEPOIS do
 * INSERT em `messages`):
 *
 *   1) checkPerNumberRateLimit — mensagens por minuto de UM número.
 *   2) checkNewNumberRateLimit — números novos distintos por hora,
 *      para toda a conta.
 *
 * Contadores em `rate_limit_buckets` (migração 054), incrementados
 * atomicamente por `rate_limit_increment_and_check` (INSERT ... ON
 * CONFLICT DO UPDATE — atómico em Postgres por bloqueio de linha, por
 * isso dois pedidos simultâneos para a mesma chave nunca passam os
 * dois). Uma única chamada RPC por verificação — barato.
 *
 * À PROVA DE FALHA NO SENTIDO CORRECTO: qualquer erro a consultar a
 * base de dados aqui DEIXA PASSAR (devolve `allowed: true`) e regista
 * em log. Nunca bloquear uma mensagem legítima por um erro nosso.
 *
 * Nunca regista números de telefone em plaintext — só a conta e a
 * contagem.
 */

export const DEFAULT_RATE_LIMIT_MESSAGES_PER_MINUTE = 10
export const DEFAULT_RATE_LIMIT_NEW_NUMBERS_PER_HOUR = 60

export interface RateLimitDecision {
  allowed: boolean
  reason?: 'per_number_limit' | 'new_numbers_limit'
}

const ALLOWED: RateLimitDecision = { allowed: true }

function truncateToMinuteIso(now: Date): string {
  const d = new Date(now)
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

function truncateToHourIso(now: Date): string {
  const d = new Date(now)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

/**
 * Is this phone exempt from the per-number rate limit? Team members
 * and configured notification numbers are trusted senders (internal
 * testing, the Ricardo/team WhatsApp itself) and must never be
 * throttled. Uses `phonesMatch` (not raw equality) for the same trunk-
 * prefix tolerance used elsewhere for comparing WhatsApp numbers.
 */
export function isExemptFromRateLimit(
  config: Pick<AiConfig, 'teamPhoneNumbers' | 'notifyPhoneNumbers'>,
  contactPhone: string | null | undefined,
): boolean {
  if (!contactPhone) return false
  const exemptNumbers = [
    ...(config.teamPhoneNumbers ?? []),
    ...(config.notifyPhoneNumbers ?? []),
  ]
  return exemptNumbers.some((n) => phonesMatch(n, contactPhone))
}

/**
 * Per-number, per-minute limit. Counts every inbound message from this
 * phone (within this account) in the current UTC-minute window; the
 * Nth message onward within the same window is refused (the (limit+1)th
 * call already exceeds it — see test: message 10 is allowed, message
 * 11 is not).
 */
export async function checkPerNumberRateLimit(params: {
  db: SupabaseClient
  accountId: string
  phone: string
  isExempt: boolean
  limitPerMinute: number
  now?: Date
}): Promise<RateLimitDecision> {
  const { db, accountId, phone, isExempt, limitPerMinute } = params
  if (isExempt) return ALLOWED

  try {
    const windowStart = truncateToMinuteIso(params.now ?? new Date())
    const bucketKey = `msg:${accountId}:${phone}`
    const { data, error } = await db.rpc('rate_limit_increment_and_check', {
      p_bucket_key: bucketKey,
      p_window_start: windowStart,
    })

    if (error) {
      console.error(
        `[rate-limit] falha ao verificar limite por número (conta ${accountId}) — a deixar passar:`,
        error.message ?? error,
      )
      return ALLOWED
    }

    const count = typeof data === 'number' ? data : Number(data)
    if (!Number.isFinite(count)) {
      console.error(
        `[rate-limit] resposta inesperada de rate_limit_increment_and_check (conta ${accountId}) — a deixar passar.`,
      )
      return ALLOWED
    }

    if (count > limitPerMinute) {
      console.warn(
        `[rate-limit] número atingiu o limite de ${limitPerMinute} mensagens/min (conta ${accountId}, contagem ${count}) — IA suprimida, mensagem continua guardada.`,
      )
      return { allowed: false, reason: 'per_number_limit' }
    }

    return ALLOWED
  } catch (err) {
    console.error(
      `[rate-limit] excepção ao verificar limite por número (conta ${accountId}) — a deixar passar:`,
      err instanceof Error ? err.message : err,
    )
    return ALLOWED
  }
}

/**
 * Account-wide limit on distinct NEW numbers per hour. Only meant to
 * be checked for messages where the webhook just created the contact
 * row (`isNewContact: true`) — an existing contact writing again never
 * counts against or is blocked by this limit.
 */
export async function checkNewNumberRateLimit(params: {
  db: SupabaseClient
  accountId: string
  isNewContact: boolean
  limitPerHour: number
  now?: Date
}): Promise<RateLimitDecision> {
  const { db, accountId, isNewContact, limitPerHour } = params
  if (!isNewContact) return ALLOWED

  try {
    const windowStart = truncateToHourIso(params.now ?? new Date())
    const bucketKey = `newnum:${accountId}`
    const { data, error } = await db.rpc('rate_limit_increment_and_check', {
      p_bucket_key: bucketKey,
      p_window_start: windowStart,
    })

    if (error) {
      console.error(
        `[rate-limit] falha ao verificar limite de números novos (conta ${accountId}) — a deixar passar:`,
        error.message ?? error,
      )
      return ALLOWED
    }

    const count = typeof data === 'number' ? data : Number(data)
    if (!Number.isFinite(count)) {
      console.error(
        `[rate-limit] resposta inesperada de rate_limit_increment_and_check (conta ${accountId}) — a deixar passar.`,
      )
      return ALLOWED
    }

    if (count > limitPerHour) {
      console.warn(
        `[rate-limit] limite de ${limitPerHour} números novos/hora atingido (conta ${accountId}, contagem ${count}) — IA suprimida para números novos até a janela passar.`,
      )
      return { allowed: false, reason: 'new_numbers_limit' }
    }

    return ALLOWED
  } catch (err) {
    console.error(
      `[rate-limit] excepção ao verificar limite de números novos (conta ${accountId}) — a deixar passar:`,
      err instanceof Error ? err.message : err,
    )
    return ALLOWED
  }
}
