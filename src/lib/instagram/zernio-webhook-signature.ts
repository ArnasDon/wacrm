import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Zernio attaches to webhook POSTs.
 *
 * Zernio signs the raw request body with the per-webhook secret
 * configured in the Zernio dashboard and sends the result in the
 * `X-Zernio-Signature` header (lowercase hex). Unlike Meta's single
 * app-wide secret (`verifyMetaWebhookSignature`), the secret here is
 * per-`instagram_config` row (each wacrm account creates its own
 * webhook in Zernio with its own secret), so the caller resolves and
 * decrypts the right secret before calling this.
 *
 * Reference: https://docs.zernio.com/webhooks#signature-verification
 */
export function verifyZernioWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
