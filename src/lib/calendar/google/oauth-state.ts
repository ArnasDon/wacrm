import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// ============================================================
// Signed `state` parameter for the Google Calendar OAuth "Connect"
// flow — pure, server-side, no I/O.
//
// The authorize route (`/api/calendar/google/authorize`) mints a
// token here and hands it to Google as `state`; the callback route
// (`/api/calendar/google/callback`) verifies it before trusting the
// `code` Google sends back. This is the anti-CSRF / anti-forgery
// boundary for the flow: without a verified signature, anyone could
// craft a callback request and get their own Google refresh token
// written into an arbitrary account's `calendar_configs` row.
//
// Format: `<base64url(JSON payload)>.<hex HMAC-SHA256 of that
// encoded payload>` — same shape as the webhook signing scheme in
// `src/lib/webhooks/sign.ts` (encode-then-sign, constant-time
// compare), reused here because state has to travel as a single
// opaque query-string value rather than a header.
// ============================================================

export interface OAuthStatePayload {
  /** Which account this connection attempt is for — the callback
   *  writes `calendar_configs` for this id, never one inferred from
   *  the current session (the OAuth round trip can span a redirect
   *  to Google and back, so re-deriving from a live session would
   *  also work, but binding it into the signed state means a stale
   *  or swapped session at callback time can't silently redirect
   *  the token to the wrong workspace). */
  accountId: string
  /** Single-use random value. Not tracked for replay server-side
   *  (this module is pure/stateless) — replay protection comes from
   *  `maxAgeSeconds` below plus Google's own authorization codes
   *  being single-use. The nonce's job is purely to stop two states
   *  minted in the same second for the same account from being
   *  byte-identical. */
  nonce: string
  /** Unix seconds when the state was minted. */
  iat: number
}

export class OAuthStateError extends Error {
  readonly code: 'malformed' | 'invalid_signature' | 'expired' | 'issued_in_future'
  constructor(message: string, code: OAuthStateError['code']) {
    super(message)
    this.name = 'OAuthStateError'
    this.code = code
  }
}

const DEFAULT_MAX_AGE_SECONDS = 600 // 10 minutes
// Small allowance for clock skew between the server that signed the
// state and the one verifying it — real skew, not an attack vector,
// so this is generous but still tight enough to catch a forged
// far-future `iat`.
const CLOCK_SKEW_TOLERANCE_SECONDS = 60

/** Mint a signed state token for `accountId`. `now` is injectable so
 *  tests control the clock instead of racing `Date.now()`. */
export function signOAuthState(accountId: string, secret: string, now: Date = new Date()): string {
  const payload: OAuthStatePayload = {
    accountId,
    nonce: randomBytes(16).toString('hex'),
    iat: Math.floor(now.getTime() / 1000),
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('hex')
  return `${encoded}.${signature}`
}

/** Verify a state token: signature integrity first, then payload
 *  shape, then expiry. Throws `OAuthStateError` (never returns a
 *  falsy/partial result) so the callback route can't accidentally
 *  fall through and trust an unverified payload. */
export function verifyOAuthState(
  token: string,
  secret: string,
  opts: { now?: Date; maxAgeSeconds?: number } = {},
): OAuthStatePayload {
  const { now = new Date(), maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS } = opts

  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0 || dotIndex === token.length - 1) {
    throw new OAuthStateError('State parameter is malformed.', 'malformed')
  }
  const encoded = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)

  const expectedSignature = createHmac('sha256', secret).update(encoded).digest('hex')
  // Guard the length before timingSafeEqual — it throws on
  // unequal-length buffers rather than returning false, and a length
  // mismatch is itself not sensitive (constant-time comparison only
  // matters once lengths already match).
  if (expectedSignature.length !== signature.length) {
    throw new OAuthStateError('State signature does not match.', 'invalid_signature')
  }
  if (!timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) {
    throw new OAuthStateError('State signature does not match.', 'invalid_signature')
  }

  let payload: OAuthStatePayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new OAuthStateError('State payload is not valid JSON.', 'malformed')
  }
  if (
    !payload ||
    typeof payload.accountId !== 'string' ||
    !payload.accountId ||
    typeof payload.nonce !== 'string' ||
    !payload.nonce ||
    typeof payload.iat !== 'number' ||
    !Number.isFinite(payload.iat)
  ) {
    throw new OAuthStateError('State payload is missing required fields.', 'malformed')
  }

  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (payload.iat - nowSeconds > CLOCK_SKEW_TOLERANCE_SECONDS) {
    throw new OAuthStateError('State parameter was issued in the future.', 'issued_in_future')
  }
  if (nowSeconds - payload.iat > maxAgeSeconds) {
    throw new OAuthStateError(
      'State parameter has expired — please restart the connection flow.',
      'expired',
    )
  }

  return payload
}
