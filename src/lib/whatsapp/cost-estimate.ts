/**
 * Meta per-message cost estimate for a broadcast (wabi addition).
 *
 * Meta bills each delivered template message by (recipient country, category).
 * wabi adds 0% markup: the business pays Meta directly, so this estimate IS the
 * full WhatsApp cost of the send. Rates are approximate list prices; Meta changes
 * them (last big change 2026-10-01), so the UI labels this as an estimate.
 * Messages inside an open 24h service window or 72h ad entry window can be free.
 */

export type TemplateCategory = 'Marketing' | 'Utility' | 'Authentication';
type Rate = { marketing: number; utility: number; authentication: number };

/** USD per delivered message, keyed by country calling code. Approximate, 2026-11. */
export const META_RATES_USD: Record<string, { country: string; rate: Rate }> = {
  '91': { country: 'India', rate: { marketing: 0.0103, utility: 0.0014, authentication: 0.0014 } }, // ≈ ₹0.86 / ₹0.115
  '971': { country: 'UAE', rate: { marketing: 0.034, utility: 0.0091, authentication: 0.0091 } },
  '966': { country: 'Saudi Arabia', rate: { marketing: 0.0455, utility: 0.0107, authentication: 0.0107 } },
  '974': { country: 'Qatar', rate: { marketing: 0.034, utility: 0.0091, authentication: 0.0091 } },
  '965': { country: 'Kuwait', rate: { marketing: 0.034, utility: 0.0091, authentication: 0.0091 } },
  '968': { country: 'Oman', rate: { marketing: 0.034, utility: 0.0091, authentication: 0.0091 } },
  '973': { country: 'Bahrain', rate: { marketing: 0.034, utility: 0.0091, authentication: 0.0091 } },
  '44': { country: 'UK', rate: { marketing: 0.0529, utility: 0.022, authentication: 0.0358 } },
  '1': { country: 'US/Canada', rate: { marketing: 0.025, utility: 0.004, authentication: 0.0135 } },
}
/** Fallback for countries not in the table: a rough mid-range guess, flagged in the UI. */
export const OTHER_RATE: Rate = { marketing: 0.04, utility: 0.008, authentication: 0.01 }

/** Display conversion only. Approximate; the Meta invoice is the source of truth. */
export const USD_TO: Record<string, number> = { USD: 1, INR: 84, AED: 3.67, SAR: 3.75, QAR: 3.64, KWD: 0.31, OMR: 0.385, BHD: 0.377, GBP: 0.79, EUR: 0.92 }

const PREFIXES = Object.keys(META_RATES_USD).sort((a, b) => b.length - a.length) // longest match first

export type CostLine = { code: string; country: string; count: number; usd: number }
export type CostEstimate = { totalUsd: number; lines: CostLine[]; unpriced: number }

/** Phones may be "+91 95265 79401", "919526579401", etc. Unparseable numbers are counted as unpriced. */
export function estimateBroadcastCost(category: TemplateCategory, phones: string[]): CostEstimate {
  const key = category.toLowerCase() as keyof Rate
  const byCode = new Map<string, CostLine>()
  let unpriced = 0
  for (const raw of phones) {
    const digits = (raw ?? '').replace(/\D/g, '').replace(/^00/, '')
    if (digits.length < 8) { unpriced++; continue }
    const code = PREFIXES.find((p) => digits.startsWith(p)) ?? 'other'
    const entry = META_RATES_USD[code]
    const line = byCode.get(code) ?? { code, country: entry?.country ?? 'Other countries', count: 0, usd: 0 }
    line.count++
    line.usd += (entry?.rate ?? OTHER_RATE)[key]
    byCode.set(code, line)
  }
  const lines = [...byCode.values()].sort((a, b) => b.usd - a.usd)
  return { totalUsd: lines.reduce((s, l) => s + l.usd, 0), lines, unpriced }
}

/** Convert for display; unknown currencies fall back to USD. */
export function convertUsd(usd: number, currency: string): { amount: number; currency: string } {
  const rate = USD_TO[currency]
  return rate ? { amount: usd * rate, currency } : { amount: usd, currency: 'USD' }
}

/** Money formatter for per-message sized amounts: keeps paise/cents (formatCurrency rounds to whole units). */
export function formatCost(usd: number, currency: string): string {
  const { amount, currency: code } = convertUsd(usd, currency)
  const digits = amount === 0 ? 0 : amount < 1 ? 3 : amount < 100 ? 2 : 0
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(digits)}`
  }
}
