import webpush from 'web-push'
import { supabaseAdmin } from './admin-client'

// Custom feature (not part of the upstream wacrm template): sends a
// Web Push notification to every device an account's teammates have
// subscribed from (Settings → the "Notificações no celular" card).
//
// Never throws — a push failure must not block the WhatsApp webhook
// or any other caller. Expired/invalid subscriptions (410/404 from
// the push service) are pruned automatically.

let _vapidConfigured = false
function ensureVapid() {
  if (_vapidConfigured) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) {
    throw new Error('VAPID keys not configured')
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  _vapidConfigured = true
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

export async function sendPushToAccount(
  accountId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  try {
    ensureVapid()
  } catch (err) {
    console.warn('[push] skipped — VAPID not configured:', (err as Error).message)
    return { sent: 0, pruned: 0 }
  }

  const { data: subs, error } = await supabaseAdmin()
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .eq('account_id', accountId)

  if (error) {
    console.error('[push] failed to load subscriptions:', error)
    return { sent: 0, pruned: 0 }
  }
  if (!subs || subs.length === 0) return { sent: 0, pruned: 0 }

  let sent = 0
  const staleIds: string[] = []

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          JSON.stringify(payload),
        )
        sent += 1
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id)
        } else {
          console.error('[push] send failed:', err)
        }
      }
    }),
  )

  if (staleIds.length > 0) {
    await supabaseAdmin().from('push_subscriptions').delete().in('id', staleIds)
  }

  return { sent, pruned: staleIds.length }
}
