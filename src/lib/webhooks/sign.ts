// ============================================================
// Webhook payload signing — pure, server-side.
//
// Every delivery carries an `X-Wacrm-Signature` header so receivers
// can verify the request really came from wacrm and wasn't tampered
// with or replayed. The scheme is Stripe-style:
//
//   X-Wacrm-Signature: t=<unix_seconds>,v1=<hex HMAC-SHA256>
//
// where the signed message is `${t}.${rawBody}` and the key is the
// endpoint's secret. Receivers recompute the HMAC over the raw body
// they received (not a re-serialized copy) and compare in constant
// time, and reject if `t` is too old (replay protection).
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Build the `X-Wacrm-Signature` header value for `rawBody`, signed
 * with `secret` at time `timestampSeconds` (pass it in — never call
 * Date.now() here, so the value is testable and callers control the
 * clock).
 */
export function buildSignatureHeader(
  rawBody: string,
  secret: string,
  timestampSeconds: number
): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

/**
 * Verify a signature header. Exposed so a wacrm-to-wacrm integration
 * (or a test) can validate deliveries; receivers in other stacks
 * reimplement the same three lines. `toleranceSeconds` bounds replay.
 */
export function verifySignatureHeader(
  header: string,
  rawBody: string,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1)];
    })
  );
  const t = Number(parts.t);
  // Normalize the presented signature: hex is case-insensitive and a
  // header may carry stray whitespace (e.g. `t=…, v1=…`), so lower-case
  // and trim before the constant-time compare.
  const v1 = typeof parts.v1 === 'string' ? parts.v1.trim().toLowerCase() : '';
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  // Constant-time compare; guard against length mismatch (timingSafeEqual
  // throws on unequal-length buffers).
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
