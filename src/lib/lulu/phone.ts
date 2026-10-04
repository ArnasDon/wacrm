/**
 * Normalise a customer mobile from BigQuery into the international form
 * WACRM requires (leading "+", country code). Defaults to Saudi Arabia
 * (+966) for local formats like 05XXXXXXXX / 5XXXXXXXX. Returns null if
 * the value can't be made into a plausible number.
 */
export function normalizeMobile(raw: string | null | undefined, defaultCountry = "966"): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, "");
  const hadPlus = digits.startsWith("+");
  digits = digits.replace(/\+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!hadPlus) {
    if (digits.startsWith("0") && digits.length === 10) digits = defaultCountry + digits.slice(1);
    else if (digits.length === 9 && digits.startsWith("5")) digits = defaultCountry + digits;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}
