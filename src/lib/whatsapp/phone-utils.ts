/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Validate a *stored or inbound* phone number is E.164-like: 8–15 digits
 * starting with a non-zero digit, optional + prefix.
 *
 * This is the check for digit strings we already hold — a contact row,
 * Meta's `wa_id`, a broadcast recipient — so it accepts the digits-only
 * form Meta uses. It cannot tell a national number from an international
 * one ("4155551212" is a US number to the person who typed it and a Swiss
 * one to Meta), which is why numbers entered by a person or an integrator
 * must go through `parseInternationalPhone` instead (issue #586).
 *
 * The floor is 8 digits, not E.164's theoretical 7: a country code plus the
 * shortest national numbering plans in real use is 8+, and 7 admitted most
 * national formats. (Only a handful of tiny territories — Niue, Tokelau,
 * Saint Helena — have 7-digit international numbers.)
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{7,14}$/.test(phone)
}

/**
 * Parse a phone number as typed by a person or sent by an API integrator.
 *
 * Requires the international `+` prefix so the country code is explicit,
 * then returns the digits-only form Meta wants — or null. Formatting noise
 * (spaces, dots, dashes, parentheses) between the digits is tolerated:
 * "+1 (415) 555-1212" → "14155551212".
 *
 * Without the `+` requirement a national-format number passes `isValidE164`
 * and is delivered to whichever country its leading digits happen to spell:
 * "4155551212" (US, national) is sent as +41 55 555 12 12 (Switzerland),
 * Meta accepts it, and the send looks successful (issue #586). Making the
 * `+` load-bearing at every boundary where raw input enters is what the
 * error messages ("E.164 format, e.g. +14155550123") already promised.
 */
export function parseInternationalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const compact = raw.trim().replace(/[\s().-]/g, '')
  if (!compact.startsWith('+')) return null
  const digits = compact.slice(1)
  if (!/^\d+$/.test(digits)) return null
  return isValidE164(digits) ? digits : null
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}
