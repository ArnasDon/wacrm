import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendText } from '@/lib/flows/meta-send'
import type { AiConfig } from './types'

// ============================================================
// Bloco 3-A — commercial mode for Meta Click-to-WhatsApp ad leads.
//
// A conversation is "commercial" when it originated from a Meta ad
// referral (`conversations.source = 'meta_ad'`, persisted by the
// webhook from the inbound message's `referral` object — see
// src/app/api/whatsapp/webhook/route.ts) AND the account has both
// turned the persona on (`ai_configs.commercial_mode_enabled`) AND
// configured a commercial system prompt. All three must hold — this
// is the single gate `dispatchInboundToAiReply` (auto-reply.ts) checks
// before switching personas, so a conversation that isn't fully
// configured behaves EXACTLY like today, unchanged.
// ============================================================

export interface CommercialConversationInfo {
  source: string | null
  commercial_welcome_sent_at: string | null
}

export function isCommercialConversation(
  conv: CommercialConversationInfo,
  config: Pick<AiConfig, 'commercialModeEnabled' | 'commercialSystemPrompt'>,
): boolean {
  return (
    conv.source === 'meta_ad' &&
    config.commercialModeEnabled === true &&
    !!config.commercialSystemPrompt &&
    config.commercialSystemPrompt.trim().length > 0
  )
}

/**
 * Default welcome sent immediately on the first inbound message of a
 * commercial conversation, used whenever the account hasn't set its
 * own `commercial_welcome_message`. Portuguese (Portugal) — this is
 * also the "boas-vindas adequada a quem acabou de clicar no anúncio"
 * required by Bloco 3-A.
 */
export const DEFAULT_COMMERCIAL_WELCOME_MESSAGE =
  'Olá! Obrigado por nos contactares a partir do anúncio. 😊 ' +
  'Somos a equipa comercial e estamos aqui para perceber melhor o teu negócio e ver como podemos ajudar. ' +
  'Em que empresa ou projecto estás, e que problema gostavas de resolver?'

/**
 * Fixed fallback sent when the AI call fails, times out, or returns no
 * usable text in commercial mode. Not configurable today — deliberately
 * short and generic so it never contradicts whatever the AI would have
 * said, and never invents facts. The point is only to guarantee some
 * reply lands inside WhatsApp's 24h session window; a human follows up
 * from the inbox regardless.
 */
export const DEFAULT_COMMERCIAL_FALLBACK_MESSAGE =
  'Recebemos a tua mensagem, obrigado! Estamos só a confirmar uns detalhes e respondemos já de seguida.'

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
