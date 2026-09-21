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
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
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
 * Known E.164 calling codes (digits, no `+`), longest first so a more
 * specific code (e.g. `351`) is tried before a shorter code that could
 * otherwise match the same leading digits. Not exhaustive — covers the
 * countries Eter Growth's WhatsApp ad campaigns realistically see
 * leads from. Add more here if a real lead from an uncovered country
 * ever fails Twenty's INVALID_PHONE_NUMBER check (see
 * splitPhoneCallingCode below).
 */
const KNOWN_CALLING_CODES = [
  '971', // Emirados Árabes Unidos
  '420', // Chéquia
  '421', // Eslováquia
  '380', // Ucrânia
  '353', // Irlanda
  '352', // Luxemburgo
  '351', // Portugal
  '55', // Brasil
  '49', // Alemanha
  '44', // Reino Unido
  '39', // Itália
  '34', // Espanha
  '33', // França
  '32', // Bélgica
  '31', // Países Baixos
  '30', // Grécia
  '20', // Egipto
  '1', // EUA / Canadá
].sort((a, b) => b.length - a.length)

/** Indicativo assumido quando o número não começa por nenhum dos
 *  indicativos conhecidos acima — Portugal, o mercado por omissão da
 *  Eter Growth. */
const DEFAULT_CALLING_CODE = '351'

/**
 * Separates a digits-only phone number (as stored in `contacts.phone`,
 * via `normalizePhone`) into a calling code and the remaining national
 * number, for CRM integrations that need them as two separate fields
 * (e.g. Twenty's `phones.primaryPhoneCallingCode` /
 * `primaryPhoneNumber` — a single combined string like "351939000016"
 * is rejected by Twenty with INVALID_PHONE_NUMBER).
 *
 * Falls back to `DEFAULT_CALLING_CODE` (Portugal) when the number
 * doesn't start with any known calling code — the whole input is then
 * treated as the national number under +351, which is right for the
 * common case (a Portuguese number typed without the country code) and
 * a reasonable default otherwise.
 *
 * @returns `callingCode` WITHOUT the `+` prefix (caller adds it) and
 *   `nationalNumber` with the calling code stripped off.
 */
export function splitPhoneCallingCode(phone: string): {
  callingCode: string
  nationalNumber: string
} {
  const digits = normalizePhone(phone)
  for (const code of KNOWN_CALLING_CODES) {
    if (digits.startsWith(code) && digits.length > code.length) {
      return { callingCode: code, nationalNumber: digits.slice(code.length) }
    }
  }
  return { callingCode: DEFAULT_CALLING_CODE, nationalNumber: digits }
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}

/**
 * Returns true when the Meta API error indicates a free-text send was
 * rejected because it fell outside the 24h customer-service session
 * window (error code 131047, "re-engagement message"). Callers must
 * fall back to an APPROVED template rather than retrying free text.
 */
export function isOutsideSessionWindowError(message: string): boolean {
  return /131047|24 hours have passed|outside the allowed window|re-?engagement/i.test(message)
}
