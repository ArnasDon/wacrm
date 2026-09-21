import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendText } from '@/lib/flows/meta-send'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import type { AiConfig } from './types'

// ============================================================
// Bloco 3-A — commercial mode.
//
// O número de WhatsApp da Eter está num anúncio pago (público), por
// isso QUALQUER pessoa que escreva, venha do anúncio ou directamente,
// é um desconhecido para o negócio. A conversa é "comercial" POR
// OMISSÃO, desde que a conta tenha ligado a persona
// (`ai_configs.commercial_mode_enabled`) e configurado um prompt
// comercial. A ÚNICA excepção é um número que conste na lista da
// equipa (`ai_configs.team_phone_numbers`) — esses continuam a apanhar
// o assistente interno (`systemPrompt`), independentemente da origem
// da conversa. Lista vazia = toda a gente comercial (comportamento
// seguro por omissão). Ver `dispatchInboundToAiReply` (auto-reply.ts).
// ============================================================

export function isCommercialConversation(
  config: Pick<AiConfig, 'commercialModeEnabled' | 'commercialSystemPrompt' | 'teamPhoneNumbers'>,
  contactPhone: string | null | undefined,
): boolean {
  if (config.commercialModeEnabled !== true) return false
  if (!config.commercialSystemPrompt || !config.commercialSystemPrompt.trim()) return false

  const team = config.teamPhoneNumbers ?? []
  if (team.length > 0 && contactPhone && normalizePhone(contactPhone).length > 0) {
    // phonesMatch (not raw equality) so a trunk-0 or country-code
    // formatting difference between the stored contact number and the
    // team list still matches — same tolerance already used elsewhere
    // for comparing WhatsApp numbers (see phone-utils.ts).
    const isTeamMember = team.some((n) => phonesMatch(n, contactPhone))
    if (isTeamMember) return false
  }

  return true
}

/**
 * Default welcome sent immediately on the first inbound message of a
 * commercial conversation, used whenever the account hasn't set its
 * own `commercial_welcome_message`. Portuguese (Portugal) — this is
 * also the "boas-vindas adequada a quem acabou de clicar no anúncio"
 * required by Bloco 3-A.
 */
export const DEFAULT_COMMERCIAL_WELCOME_MESSAGE =
  'Olá! Obrigado por nos contactar. 😊 ' +
  'Somos a equipa comercial e estamos aqui para perceber melhor o seu negócio e ver como podemos ajudar. ' +
  'Em que empresa ou projecto está, e que problema gostava de resolver?'

/**
 * Fixed fallback sent when the AI call fails, times out, or returns no
 * usable text in commercial mode. Not configurable today — deliberately
 * short and generic so it never contradicts whatever the AI would have
 * said, and never invents facts. The point is only to guarantee some
 * reply lands inside WhatsApp's 24h session window; a human follows up
 * from the inbox regardless.
 */
export const DEFAULT_COMMERCIAL_FALLBACK_MESSAGE =
  'Recebemos a sua mensagem, obrigada. Estamos só a confirmar uns detalhes e respondemos já de seguida.'

interface WelcomeArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  welcomeMessage: string | null | undefined
}

/**
 * Send the commercial welcome message exactly once per conversation.
 *
 * WHY: WhatsApp only allows free-form replies within 24h of the
 * customer's last message ("session window"); if nobody replies in
 * time, the thread locks and re-opening it requires a Meta-approved
 * template. The AI reply that answers the lead's actual message can be
 * slow, can time out, or can fail outright — so this welcome is sent
 * FIRST and unconditionally (see dispatchInboundToAiReply), before any
 * AI call, to guarantee the window stays open regardless of what
 * happens next.
 *
 * Idempotency: an atomic "claim" UPDATE sets
 * `commercial_welcome_sent_at` only WHERE it is still NULL (same
 * pattern as `claim_ai_reply_slot` in migration 029's atomic-claim
 * comment) — so two inbound messages landing close together, or a
 * webhook retry, can never send this twice. Never throws: a failure
 * here must not block the rest of the auto-reply flow.
 */
export async function sendCommercialWelcomeIfNeeded(args: WelcomeArgs): Promise<void> {
  const { db, accountId, conversationId, contactId, configOwnerUserId, welcomeMessage } = args
  try {
    const { data: claimedRows, error } = await db
      .from('conversations')
      .update({ commercial_welcome_sent_at: new Date().toISOString() })
      .eq('id', conversationId)
      .is('commercial_welcome_sent_at', null)
      .select('id')

    if (error) {
      console.error(
        '[ai auto-reply] commercial welcome: falha ao reservar o envio único:',
        error.message,
      )
      return
    }
    if (!claimedRows || claimedRows.length === 0) return // already sent, or lost the race

    const text =
      welcomeMessage && welcomeMessage.trim()
        ? welcomeMessage.trim()
        : DEFAULT_COMMERCIAL_WELCOME_MESSAGE

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: false,
    })
  } catch (err) {
    console.error(
      '[ai auto-reply] commercial welcome send failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

interface FallbackArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
}

/**
 * Guaranteed reply for commercial mode when the AI call fails, times
 * out, or returns no usable text (see dispatchInboundToAiReply). Never
 * throws — callers treat this as best-effort, same discipline as the
 * rest of the auto-reply / webhook cascade.
 */
export async function sendCommercialFallback(args: FallbackArgs): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args
  try {
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: DEFAULT_COMMERCIAL_FALLBACK_MESSAGE,
      aiGenerated: false,
    })
  } catch (err) {
    console.error(
      '[ai auto-reply] commercial fallback send failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
