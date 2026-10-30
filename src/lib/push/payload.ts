import {
  DEFAULT_NOTIFICATION_LABELS,
  buildNotificationContent,
  conversationHref,
  pickContactDisplayName,
  type NotifiableMessage,
} from '@/lib/notifications/browser-notify'

/**
 * What the service worker receives. Deliberately tiny and free of any
 * credentials: the Web Push service only ever sees it encrypted, and the
 * quick-reply goes back through the user's own logged-in session.
 */
export interface PushPayload {
  v: 1
  conversationId: string
  title: string
  body: string
  /** Deep link opened by "Open chat" / tapping the notification. */
  url: string
  /** One alert per conversation: a newer message replaces the older one. */
  tag: string
  ts: number
}

export function buildPushPayload(args: {
  message: Pick<NotifiableMessage, 'conversation_id' | 'content_type' | 'content_text'>
  contact?: { name?: string | null; wa_username?: string | null; phone?: string | null } | null
  now?: number
}): PushPayload {
  const { message, contact } = args
  const { title, body } = buildNotificationContent(
    { id: '', sender_type: 'customer', ...message },
    pickContactDisplayName(contact),
    DEFAULT_NOTIFICATION_LABELS,
  )
  return {
    v: 1,
    conversationId: message.conversation_id,
    title,
    body,
    url: conversationHref(message.conversation_id),
    tag: message.conversation_id,
    ts: args.now ?? Date.now(),
  }
}

export interface ParsedSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/** Validates the browser's PushSubscription JSON. Returns null if unusable. */
export function parseSubscription(input: unknown): ParsedSubscription | null {
  if (!input || typeof input !== 'object') return null
  const sub = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  const { endpoint } = sub
  const p256dh = sub.keys?.p256dh
  const auth = sub.keys?.auth
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return null
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null
  if (p256dh.length < 20 || p256dh.length > 256 || auth.length < 8 || auth.length > 64) return null
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  // Push services are always HTTPS; refusing anything else stops this
  // table being used to make the server call arbitrary http:// targets.
  if (url.protocol !== 'https:') return null
  return { endpoint, p256dh, auth }
}
