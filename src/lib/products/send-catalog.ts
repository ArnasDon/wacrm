import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'

export class SendCatalogError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

/**
 * `NEXT_PUBLIC_SITE_URL` verbatim, no trailing slash — this runs from
 * both an HTTP route (which has a `Request` to derive an origin from)
 * and the AI's autonomous auto-reply path (a background job with no
 * incoming request), so per .env.local.example's own guidance this is
 * exactly the case the env var exists for: reading it directly rather
 * than plumbing a `Request` through every caller.
 */
function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!explicit) {
    throw new SendCatalogError('NEXT_PUBLIC_SITE_URL is not configured.', 500)
  }
  return explicit.replace(/\/+$/, '')
}

/**
 * Sends a link to the account's public, always-current catalog page
 * (`/catalog/[accountId]`, Bloque 8) to `conversationId` — the shared
 * core behind both the human-triggered `POST /api/products/send-catalog`
 * route and the AI's autonomous `send_catalog` action
 * (`src/lib/ai/auto-reply.ts`). Used to send a generated PDF snapshot
 * instead; the live page is simpler (no render/upload step) and never
 * goes stale. `sendMessageToConversation` is channel-agnostic, so this
 * already works over WhatsApp, Instagram, and Facebook without any
 * per-channel branching here.
 */
export async function sendCatalogToConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<{ catalogUrl: string }> {
  const { count, error: countError } = await db
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('is_active', true)
  if (countError) throw new SendCatalogError(countError.message, 500)
  if (!count) {
    throw new SendCatalogError('No active products in the catalog yet.')
  }

  const catalogUrl = `${siteBaseUrl()}/catalog/${accountId}`

  try {
    await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'text',
      contentText: `Puedes ver nuestro catálogo completo aquí: ${catalogUrl}`,
    })
  } catch (err) {
    if (err instanceof SendMessageError) throw new SendCatalogError(err.message, err.status)
    throw err
  }

  return { catalogUrl }
}
