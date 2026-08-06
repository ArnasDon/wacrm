import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface CustomerServiceWindow {
  open: boolean
  lastCustomerMessageAt: string | null
  expiresAt: string | null
}

/**
 * Resolve Meta's rolling 24-hour customer-service window from the latest
 * inbound customer message in a conversation.
 *
 * Templates are handled by the caller because approved templates are allowed
 * outside the window. Free-form text, media and interactive messages must only
 * be sent when `open` is true.
 */
export async function getCustomerServiceWindow(
  db: WacrmSupabaseClient,
  conversationId: string,
): Promise<CustomerServiceWindow> {
  const { data, error } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  const lastCustomerMessageAt = data?.created_at ?? null
  if (!lastCustomerMessageAt) {
    return { open: false, lastCustomerMessageAt: null, expiresAt: null }
  }

  const lastCustomerMessageMs = new Date(lastCustomerMessageAt).getTime()
  if (!Number.isFinite(lastCustomerMessageMs)) {
    return {
      open: false,
      lastCustomerMessageAt,
      expiresAt: null,
    }
  }

  const expiresAtMs = lastCustomerMessageMs + CUSTOMER_SERVICE_WINDOW_MS

  return {
    open: Date.now() < expiresAtMs,
    lastCustomerMessageAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
  }
}
