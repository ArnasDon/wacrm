/** Select a room rate sheet only after the stay dates and party are known.
 * Mixed weekday/weekend stays use the calculated breakdown instead. */
export function roomBannerVariant(stay: { check_in?: string | null; check_out?: string | null; guests?: number | null }): 'weekday' | 'weekend' | null {
  if (!stay.guests || !Number.isInteger(stay.guests) || stay.guests < 1) return null
  const { check_in: start, check_out: end } = stay
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
  const first = Date.parse(start + 'T00:00:00Z'), last = Date.parse(end + 'T00:00:00Z')
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first || last - first > 366 * 86400000) return null
  if (new Date(first).toISOString().slice(0, 10) !== start || new Date(last).toISOString().slice(0, 10) !== end) return null
  const variants = new Set<string>()
  for (let t = first; t < last; t += 86400000) {
    const day = new Date(t).getUTCDay()
    variants.add(day === 5 || day === 6 ? 'weekend' : 'weekday')
  }
  return variants.size === 1 ? [...variants][0] as 'weekday' | 'weekend' : null
}
