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
 * own `commercial_welcome_message` AND the conversation didn't come
 * from a mapped Meta ad (see `buildCommercialAdOpeningMessage` below,
 * which takes priority for `source = 'meta_ad'`). Portuguese
 * (Portugal) — this is also the "boas-vindas adequada a quem acabou
 * de clicar no anúncio" required by Bloco 3-A.
 */
export const DEFAULT_COMMERCIAL_WELCOME_MESSAGE =
  'Olá! Obrigado por nos contactar. 😊 ' +
  'Somos a equipa comercial e estamos aqui para perceber melhor o seu negócio e ver como podemos ajudar. ' +
  'Em que empresa ou projecto está, e que problema gostava de resolver?'

// ============================================================
// Abertura por persona — a primeira mensagem de uma conversa vinda de
// anúncio (`conversations.source = 'meta_ad'`) confirma o cargo da
// pessoa antes de qualificar, em vez de ir logo às perguntas de
// negócio. O `ad_id` guardado na conversa (migração 045) identifica
// qual dos anúncios abriu a conversa; cada anúncio testa uma persona
// diferente (CEO / director comercial / empresário) — ver
// `COMMERCIAL_AD_PERSONA_BY_AD_ID`. Texto aprovado pelo Ricardo,
// 24/09/2026. Sem ad_id conhecido, usa-se a variante genérica.
//
// O cargo que a pessoa confirmar (ou corrigir) é registado por
// save_lead_details no campo `role` → `contacts.lead_role` (migração
// 058) — ver commercial-schema.ts / handlers/commercial.ts. Isto não
// altera o gate de handoff (nome, email, motivo, empresa continuam
// obrigatórios).
// ============================================================

export type CommercialAdPersona = 'ceo' | 'director_comercial' | 'empresario'

/** ad_id (`conversations.ad_id`) → persona testada nesse anúncio.
 *  Inclui os anúncios actuais e os antigos ainda em posts activos. */
export const COMMERCIAL_AD_PERSONA_BY_AD_ID: Record<string, CommercialAdPersona> = {
  '120249664433370585': 'ceo',
  '120249685585350585': 'ceo',
  '120249645217990585': 'ceo',
  '120249664433640585': 'director_comercial',
  '120249645233150585': 'director_comercial',
  '120249664434280585': 'empresario',
  '120249645233480585': 'empresario',
}

/** Pergunta de confirmação de cargo por persona, usada na abertura da
 *  conversa (ver `buildCommercialAdOpeningMessage`). Sem persona
 *  conhecida (ad_id em falta ou não mapeado), usa-se a genérica. */
const COMMERCIAL_AD_PERSONA_QUESTION: Record<CommercialAdPersona, string> = {
  ceo: 'é o responsável máximo da empresa, ou trata disto outra pessoa?',
  director_comercial: 'é quem lidera a equipa comercial, ou trata disto outra pessoa?',
  empresario: 'a empresa é sua, ou trata disto outra pessoa?',
}
const COMMERCIAL_AD_PERSONA_QUESTION_GENERIC =
  'é o responsável comercial da empresa, ou trata disto por outra via?'

/** Persona testada pelo anúncio que abriu a conversa, ou `null` sem
 *  `ad_id` ou com um `ad_id` não mapeado. */
export function personaFromAdId(adId: string | null | undefined): CommercialAdPersona | null {
  if (!adId) return null
  return COMMERCIAL_AD_PERSONA_BY_AD_ID[adId] ?? null
}

/**
 * Abertura da primeira mensagem de uma conversa comercial vinda de
 * anúncio (`conversations.source === 'meta_ad'`) — substitui, só para
 * este caso, `DEFAULT_COMMERCIAL_WELCOME_MESSAGE` e qualquer
 * `commercial_welcome_message` configurado na conta (a confirmação de
 * cargo é sempre a prioridade quando se sabe que a pessoa veio de um
 * anúncio). Chamar apenas quando `source === 'meta_ad'` — ver
 * `sendCommercialWelcomeIfNeeded`.
 */
export function buildCommercialAdOpeningMessage(adId: string | null | undefined): string {
  const persona = personaFromAdId(adId)
  const question = persona ? COMMERCIAL_AD_PERSONA_QUESTION[persona] : COMMERCIAL_AD_PERSONA_QUESTION_GENERIC
  return (
    'Olá! Sou o agente da Eter Growth. Respondo em segundos, a qualquer hora, é isto que fazemos pelas empresas.\n' +
    `Para lhe dar a resposta certa: ${question}`
  )
}

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
  /** `conversations.source` (migração 045) — quando `'meta_ad'`, a
   *  abertura por persona (`buildCommercialAdOpeningMessage`) tem
   *  sempre prioridade sobre `welcomeMessage`. */
  source?: string | null
  /** `conversations.ad_id` (migração 045) — qual anúncio abriu a
   *  conversa, usado para escolher a persona da abertura. Só relevante
   *  quando `source === 'meta_ad'`. */
  adId?: string | null
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
  const { db, accountId, conversationId, contactId, configOwnerUserId, welcomeMessage, source, adId } =
    args
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

    // Abertura por persona (Ricardo, 24/09/2026): uma conversa vinda de
    // um anúncio confirma o cargo antes de qualificar, independentemente
    // de a conta ter um `commercial_welcome_message` próprio — esse
    // continua a valer para conversas directas (source !== 'meta_ad').
    const text =
      source === 'meta_ad'
        ? buildCommercialAdOpeningMessage(adId)
        : welcomeMessage && welcomeMessage.trim()
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
