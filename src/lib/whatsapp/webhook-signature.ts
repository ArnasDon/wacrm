import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   A secret is **required**. Each tenant stores their own app secret
 *   (Settings → WhatsApp), since every merchant connects their own Meta
 *   app; `META_APP_SECRET` is the fallback for single-tenant installs.
 *   If neither is configured we fail closed — every request is rejected
 *   until one is. A previous version fell open with a warning log,
 *   which is unsafe: anyone who forgot the secret would be running a
 *   fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret?: string | null,
): boolean {
  const secret = appSecret || process.env.META_APP_SECRET
  if (!secret) {
    console.error(
      '[webhook] No app secret configured — rejecting request. ' +
        'Paste the Meta app secret in Settings → WhatsApp (Meta → App ' +
        'Settings → Basic → App Secret), or set META_APP_SECRET.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
