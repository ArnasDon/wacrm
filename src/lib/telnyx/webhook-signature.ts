// ============================================================
// Telnyx webhook signature verification (Ed25519).
//
// Verified against developers.telnyx.com (webhook signature
// verification): payload = `${timestamp}|${rawBody}`, signature is
// base64 (header `telnyx-signature-ed25519`, base64-encoded Ed25519),
// timestamp is Unix ms (header `telnyx-timestamp`). We verify the raw
// body BEFORE any DB work and fail-closed when the public key is not
// configured.
// ============================================================

import { createPublicKey, verify } from 'node:crypto'

const PUBLIC_KEY_B64 = process.env.TELNYX_WEBHOOK_PUBLIC_KEY

/** 5 min de ventana anti-replay (misma política que policyjar). */
const MAX_TIMESTAMP_DRIFT_MS = 300_000

export interface Verification {
  ok: boolean
  reason?: string
}

export function verifyTelnyxWebhook(
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
): Verification {
  if (!PUBLIC_KEY_B64) {
    return { ok: false, reason: 'TELNYX_WEBHOOK_PUBLIC_KEY not configured' }
  }
  if (!timestamp || !signature) {
    return { ok: false, reason: 'missing signature headers' }
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return { ok: false, reason: 'stale timestamp' }
  }

  let sigBytes: Buffer
  try {
    sigBytes = Buffer.from(signature, 'base64')
  } catch {
    return { ok: false, reason: 'bad signature encoding' }
  }

  try {
    // The key delivered by GET /v2/public_key is base64-encoded Ed25519
    // SPKI (SubjectPublicKeyInfo). `verify(null, …)` auto-detects Ed25519.
    const key = createPublicKey({ key: Buffer.from(PUBLIC_KEY_B64, 'base64'), format: 'der', type: 'spki' })
    const signedPayload = Buffer.from(`${timestamp}|${rawBody}`, 'utf8')
    const ok = verify(null, signedPayload, key, sigBytes)
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  } catch {
    return { ok: false, reason: 'signature verification failed' }
  }
}