/**
 * Click-to-WhatsApp Ads (CTWA) referral capture.
 *
 * Meta sends a `referral` object on the message that opened a
 * conversation started by tapping a Facebook/Instagram ad — identifying
 * which ad/creative sent the lead (source_id, headline, image_url, ...).
 * The route handler at /api/whatsapp/webhook calls `captureCtwaReferral`
 * for every inbound message that carries one; persistence lives here
 * (not inline in the route) so it's unit-testable with an injected
 * client, same as `template-webhook.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CtwaReferral {
  source_url?: string
  source_id?: string
  source_type?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
}

/**
 * Persist a referral onto the conversation that first carried it — never
 * overwrites an existing value. Meta only sends `referral` on the message
 * that actually opened the thread from the ad tap; every later message in
 * the same conversation has none, and that must NOT be read as "no ad"
 * and clear/skip the stored origin (see AGENTS task, rule 14).
 *
 * Diagnostic logging is intentionally kept here (not a temporary log to
 * remove post-launch) — it's the only place we can see the real shape of
 * the referral object from live traffic, which no test payload can
 * substitute for. Logs only non-sensitive fields, never a token/secret.
 */
export async function captureCtwaReferral(
  db: SupabaseClient,
  conversation: { id: string; ctwa_referral?: unknown },
  referral: CtwaReferral,
): Promise<void> {
  console.log('[webhook] CTWA referral present:', {
    conversation_id: conversation.id,
    source_id: referral.source_id,
    source_type: referral.source_type,
    source_url: referral.source_url,
    media_type: referral.media_type,
    has_image_url: !!referral.image_url,
    has_video_url: !!referral.video_url,
    has_thumbnail_url: !!referral.thumbnail_url,
    headline: referral.headline,
  })

  if (conversation.ctwa_referral) return // already captured — first touch wins

  const { error, count } = await db
    .from('conversations')
    .update({ ctwa_referral: referral }, { count: 'exact' })
    .eq('id', conversation.id)
    .is('ctwa_referral', null) // guards the race two concurrent inbound
    // deliveries for the same brand-new conversation would otherwise hit

  if (error) {
    console.error('[webhook] Failed to persist CTWA referral:', error)
  } else if (count === 0) {
    console.log(
      '[webhook] CTWA referral already captured by a concurrent delivery, skipped:',
      conversation.id,
    )
  }
}
