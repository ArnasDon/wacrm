import type { EmailOtpType } from '@supabase/supabase-js'

// The e-mail-link OTP types we're willing to verify from `/auth/confirm`.
// Anything else (SMS, phone_change, …) never arrives through this route,
// so we reject it rather than hand an arbitrary string to `verifyOtp`.
const ALLOWED_OTP_TYPES = [
  'invite',
  'recovery',
  'magiclink',
  'email',
  'signup',
  'email_change',
] as const

export type ConfirmOtpType = (typeof ALLOWED_OTP_TYPES)[number]

export function parseOtpType(raw: string | null | undefined): ConfirmOtpType | null {
  if (!raw) return null
  return (ALLOWED_OTP_TYPES as readonly string[]).includes(raw)
    ? (raw as ConfirmOtpType)
    : null
}

// Belt-and-braces: `ConfirmOtpType` must stay assignable to the SDK's
// union so `verifyOtp({ type })` type-checks without a cast.
const _typecheck: EmailOtpType = 'invite' as ConfirmOtpType
void _typecheck

/**
 * A `next` destination is only ever an in-app path. Anything that could
 * bounce the just-authenticated visitor to another origin — `//evil.com`,
 * `https://evil.com`, a `\` some browsers/proxies fold into `/`, a
 * `%2F%2Fevil.com` that decodes later — collapses to the safe default.
 */
export function sanitizeNext(
  raw: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!raw) return fallback
  const value = raw.trim()
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.includes('\\')) return fallback
  if (value.includes('://')) return fallback
  // Reject anything still encoding a slash-run or scheme once decoded.
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return fallback
  }
  if (decoded.startsWith('//') || decoded.includes('\\') || decoded.includes('://')) {
    return fallback
  }
  return value
}
