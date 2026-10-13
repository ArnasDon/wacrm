import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { loadCatalogContext } from '@/lib/ai/catalog-context'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { describeNowInZone, describeUpcomingWeekdaysInZone } from '@/lib/timezone'
import { loadQuickReplyContext } from '@/lib/ai/quick-reply-context'
import { loadHotelCategoryBanners } from '@/lib/ai/auto-reply'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { loadBusinessMetrics, metricsGrounding } from '@/lib/ai/business-metrics'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * One test turn against the account's agent WITHOUT touching WhatsApp.
 * Builds the `auto_reply` system prompt with the same ACCOUNT-level
 * context the live bot uses: knowledge base, catalog + delivery mode,
 * quick replies, the industry vertical (hotel reservation markers,
 * category banners and the first-reply welcome; clinic guardrails),
 * restaurant menu, timezone. What it can't simulate is
 * CONVERSATION-level state (a reservation in progress, a stay estimate,
 * the patient's appointment, facts about a real contact, the flow
 * directive). Reads the config even when the master switch is off.
 *
 * Used by the Playground (`/api/ai/playground`, the member's RLS client)
 * and the onboarding AI check in /admin (service-role client).
 */
export async function runPlaygroundTurn(db: SupabaseClient, accountId: string, rawMessages: ChatMessage[]) {
  const messages = rawMessages.slice(-MAX_TURNS)

  const config = await loadAiConfig(db, accountId, { requireActive: false }).catch((err) => {
    console.error('[ai/playground] loadAiConfig error:', err)
    throw new AiError('Stored API key could not be decrypted.', { code: 'key_decrypt_failed', status: 400 })
  })
  if (!config) {
    throw new AiError('No agent configured yet. Add your provider key in Setup.', {
      code: 'ai_not_configured',
      status: 400,
    })
  }

  const knowledge = await retrieveKnowledge(db, accountId, config, latestUserMessage(messages))
  const metrics = await loadBusinessMetrics(db, accountId)
  const catalog = await loadCatalogContext(db, accountId)
  const { data: account } = await db
    .from('accounts')
    .select('timezone, industry_vertical, catalog_delivery_mode, restaurant_menu_url')
    .eq('id', accountId)
    .maybeSingle()
  const timeZone = (account?.timezone as string | null | undefined)?.trim() || 'UTC'
  const isHotel = account?.industry_vertical === 'hotel'
  const isClinic = account?.industry_vertical === 'clinica'
  const [quickReplies, hotelCategoryBanners] = await Promise.all([
    loadQuickReplyContext(db, accountId).catch(() => null),
    isHotel ? loadHotelCategoryBanners(db, accountId).catch(() => []) : Promise.resolve([]),
  ])

  const systemPrompt = buildSystemPrompt({
    userPrompt: config.systemPrompt,
    mode: 'auto_reply',
    knowledge,
    catalog,
    catalogDeliveryMode:
      (account?.catalog_delivery_mode as 'digital' | 'pdf' | 'photos' | undefined) ?? 'digital',
    quickReplies,
    askCustomerTaxInfo: config.askCustomerTaxInfo,
    hotelReservations: isHotel,
    restaurantMenu: Boolean((account?.restaurant_menu_url as string | null | undefined)?.trim()),
    hotelCategoryBanners,
    // Same rule as the live bot: no assistant turn yet = first reply.
    hotelIsFirstReply: isHotel && !messages.some((m) => m.role === 'assistant'),
    clinicGuardrails: isClinic,
    currentDate: describeNowInZone(timeZone),
    upcomingWeekdays: describeUpcomingWeekdaysInZone(timeZone),
  }) + metricsGrounding(metrics)

  return generateReply({ config, systemPrompt, messages })
}

/** Keep only well-formed, non-empty user/assistant turns. */
export function cleanTranscript(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter(
    (m: unknown): m is ChatMessage =>
      !!m &&
      typeof m === 'object' &&
      ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
      typeof (m as ChatMessage).content === 'string' &&
      (m as ChatMessage).content.trim().length > 0,
  )
}
