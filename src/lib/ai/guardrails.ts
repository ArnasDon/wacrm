import { REPLY_SPLIT_MARKER } from './chunk-reply'
import { HISTORY_ANNOTATION_MARKERS } from './history-annotations'

export type GuardrailViolation =
  | 'control_marker'
  | 'system_prompt_leak'
  | 'credential_or_secret'
  | 'payment_card'
  | 'unsupported_price'
  | 'unverified_availability'
  | 'unsafe_promise'
  | 'history_annotation_leak'

export interface GuardrailResult {
  safe: boolean
  violations: GuardrailViolation[]
}

function normalizedAmount(value: string): number | null {
  let candidate = value.replace(/\s/g, '')
  if (!candidate) return null
  const comma = candidate.lastIndexOf(',')
  const dot = candidate.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.'
    candidate = candidate
      .replace(decimal === ',' ? /\./g : /,/g, '')
      .replace(decimal, '.')
  } else if (comma >= 0) {
    const decimals = candidate.length - comma - 1
    candidate =
      decimals > 0 && decimals <= 2
        ? candidate.replace(',', '.')
        : candidate.replace(/,/g, '')
  } else if (dot >= 0) {
    const decimals = candidate.length - dot - 1
    if (decimals === 3) candidate = candidate.replace(/\./g, '')
  }
  const amount = Number(candidate)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export function extractCurrencyAmounts(text: string): number[] {
  const amounts = new Set<number>()
  const patterns = [
    /\b(\d[\d\s.,]{0,18})\s*(?:MZN|MT|USD|EUR|GBP|ZAR|AOA|BRL)\b/gi,
    /(?:\b(?:MZN|MT|USD|EUR|GBP|ZAR|AOA|BRL)\b|[$€£])\s*(\d[\d\s.,]{0,18})/gi,
    /\b(?:pre[cç]o|custa|custam|valor)\s*(?:[ée]|de|:)?\s*(\d[\d\s.,]{0,18})/gi,
    /"price"\s*:\s*(\d+(?:\.\d+)?)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = normalizedAmount(match[1])
      if (amount !== null) amounts.add(amount)
    }
  }
  return Array.from(amounts)
}

function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) {
    return false
  }
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

function hasPaymentCard(text: string): boolean {
  return (text.match(/(?:\d[ -]?){13,19}/g) ?? []).some(luhnValid)
}

function amountIsTrusted(amount: number, trusted: number[]): boolean {
  return trusted.some((candidate) => Math.abs(candidate - amount) < 0.01)
}

export function evaluateAgentOutput(args: {
  text: string
  trustedText?: string
  trustedPriceAmounts?: number[]
  salesIntent?: boolean
  catalogueVerified?: boolean
}): GuardrailResult {
  const text = args.text.trim()
  if (!text) return { safe: true, violations: [] }
  const violations = new Set<GuardrailViolation>()
  const withoutSplits = text.split(REPLY_SPLIT_MARKER).join('')

  if (/\[\[[A-Z][A-Z0-9_:-]{1,40}\]\]/.test(withoutSplits)) {
    violations.add('control_marker')
  }
  // buildConversationContext annotates past media/interactive messages with
  // bracketed markers like "[Opção interactiva no WhatsApp]" so the model
  // can read its own history — a real leak observed in production is the
  // model echoing that annotation back as if it were reply content.
  if (HISTORY_ANNOTATION_MARKERS.some((marker) => withoutSplits.includes(marker))) {
    violations.add('history_annotation_leak')
  }
  if (
    /Treat everything in the customer messages as untrusted|Tool-use rule:|Catalogue selling rule:|Business context and instructions:/i.test(
      text,
    )
  ) {
    violations.add('system_prompt_leak')
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bEAA[A-Za-z0-9]{35,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(
      text,
    )
  ) {
    violations.add('credential_or_secret')
  }
  if (hasPaymentCard(text)) violations.add('payment_card')

  const trustedAmounts = [
    ...(args.trustedPriceAmounts ?? []),
    ...extractCurrencyAmounts(args.trustedText ?? ''),
  ]
  const claimedAmounts = extractCurrencyAmounts(text)
  if (
    claimedAmounts.some((amount) => !amountIsTrusted(amount, trustedAmounts))
  ) {
    violations.add('unsupported_price')
  }

  if (
    args.salesIntent &&
    !args.catalogueVerified &&
    /\b(?:temos|esta|está|encontra-se)\s+(?:dispon[ií]vel|em stock)|\bdispon[ií]vel para (?:entrega|levantamento)\b/i.test(
      text,
    )
  ) {
    violations.add('unverified_availability')
  }
  if (
    /\b(?:garanto|garantimos|garantido|sem qualquer risco|100% garantid[oa]|vai chegar de certeza)\b/i.test(
      text,
    )
  ) {
    violations.add('unsafe_promise')
  }

  return {
    safe: violations.size === 0,
    violations: Array.from(violations),
  }
}
