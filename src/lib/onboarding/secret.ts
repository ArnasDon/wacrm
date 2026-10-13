import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Shared secret between the onboarding Apps Script and SANDÍA. Derived
 * from SUBSCRIPTIONS_CRON_SECRET (unless ONBOARDING_SECRET is set) so no
 * new EasyPanel env var is needed and the base secret never leaves the
 * server. The platform admin copies it from /admin into the script.
 */
export function onboardingSecret(): string | null {
  if (process.env.ONBOARDING_SECRET) return process.env.ONBOARDING_SECRET
  const base = process.env.SUBSCRIPTIONS_CRON_SECRET
  return base ? createHmac('sha256', base).update('sandia-onboarding').digest('hex') : null
}

export function isValidOnboardingSecret(supplied: string | null): boolean {
  const expected = onboardingSecret()
  if (!expected || !supplied) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
