// ============================================================
// Money helpers. Amounts are integer minor units everywhere
// (kobo for NGN). Only the UI and PDFs format to major units.
// Safe for client and server.
// ============================================================

export function toMinor(major: number): number {
  return Math.round(major * 100)
}

export function toMajor(minor: number): number {
  return minor / 100
}

export function formatMoney(minor: number, currency = 'NGN'): string {
  const major = minor / 100
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: major % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    return `${currency} ${major.toFixed(2)}`
  }
}

/**
 * PDF-safe variant: the standard PDF fonts can't render "₦", so
 * PDFs spell the currency code instead ("NGN 12,500").
 */
export function formatMoneyPlain(minor: number, currency = 'NGN'): string {
  const major = minor / 100
  const n = major.toLocaleString('en-NG', {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${currency} ${n}`
}
