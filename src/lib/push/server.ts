import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import type { PushPayload } from './payload'

// Server-only. Reads VAPID keys at call time (not import time) so a
// missing key never crashes the build or the webhook.

// Untyped (like the webhook route's client): no generated DB types in this repo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export function getVapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  }
}

export function isPushConfigured(): boolean {
  return getVapid() !== null
}

interface SubRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Sends `payload` to every push subscription in `accountId` (optionally
 * just one user's). Never throws; dead subscriptions (404/410) are pruned.
 * Returns how many were delivered to the push service.
 */
export async function sendPushToAccount(
  accountId: string,
  payload: PushPayload | Record<string, unknown>,
  opts: { userId?: string } = {},
): Promise<{ sent: number; removed: number; configured: boolean }> {
  const vapid = getVapid()
  if (!vapid) return { sent: 0, removed: 0, configured: false }
  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

    let q = admin()
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('account_id', accountId)
    if (opts.userId) q = q.eq('user_id', opts.userId)
    const { data, error } = await q
    if (error || !data) {
      console.error('[push] could not load subscriptions:', error?.message)
      return { sent: 0, removed: 0, configured: true }
    }

    const body = JSON.stringify(payload)
    const dead: string[] = []
    let sent = 0
    await Promise.all(
      (data as unknown as SubRow[]).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 3600, urgency: 'high', timeout: 8000 },
          )
          sent++
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) dead.push(s.id)
          else console.error('[push] send failed:', status ?? (err as Error).message)
        }
      }),
    )
    if (dead.length) await admin().from('push_subscriptions').delete().in('id', dead)
    return { sent, removed: dead.length, configured: true }
  } catch (err) {
    console.error('[push] unexpected failure:', (err as Error).message)
    return { sent: 0, removed: 0, configured: true }
  }
}

/** Upsert used by the subscribe route (after it authenticated the caller). */
export async function saveSubscription(args: {
  accountId: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
}): Promise<boolean> {
  const { error } = await admin()
    .from('push_subscriptions')
    .upsert(
      {
        account_id: args.accountId,
        user_id: args.userId,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        user_agent: args.userAgent?.slice(0, 300) ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
  if (error) console.error('[push] save subscription failed:', error.message)
  return !error
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await admin().from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint)
}

/**
 * Called from the inbound WhatsApp webhook. Bounded by a timeout and
 * wrapped so a push problem can never fail or delay message processing.
 */
export async function notifyInboundPush(args: {
  accountId: string
  payload: PushPayload
}): Promise<void> {
  if (!isPushConfigured()) return
  try {
    await Promise.race([
      sendPushToAccount(args.accountId, args.payload),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ])
  } catch {
    /* never throw into the webhook */
  }
}
