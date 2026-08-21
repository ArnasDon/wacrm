// ============================================================
// Shared validation for a product's price_options payload (migration
// 075) — used by both POST /api/products and PATCH /api/products/[id]
// so create and update enforce the exact same rules. Pure function, no
// I/O, easy to unit test.
// ============================================================

export const MAX_PRICE_OPTIONS = 2

export interface ParsedPriceOption {
  label: string
  price: number
  installation_cost: number | null
  image_urls: string[]
}

export type ParsePriceOptionsResult =
  | { ok: true; options: ParsedPriceOption[] }
  | { ok: false; error: string }

export type ParseInstallationCostResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string }

/**
 * Validates a single optional installation-cost field — shared by the
 * product's own base price (migration 076) and each price option
 * (migration 075). Absent/null/empty-string all mean "not set."
 */
export function parseInstallationCost(raw: unknown, fieldName = 'installation_cost'): ParseInstallationCostResult {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null }
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: `${fieldName} must be a non-negative number` }
  }
  return { ok: true, value: parsed }
}

/**
 * Validates the raw `price_options` array from a request body. Every
 * field beyond `label`/`price` is optional per product decision — a
 * price option only needs a label and a price; installation cost and
 * extra photos are extras.
 */
export function parsePriceOptions(raw: unknown): ParsePriceOptionsResult {
  if (raw === undefined) return { ok: true, options: [] }
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'price_options must be an array' }
  }
  if (raw.length > MAX_PRICE_OPTIONS) {
    return { ok: false, error: `A product may have at most ${MAX_PRICE_OPTIONS} additional price options` }
  }

  const options: ParsedPriceOption[] = []
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: `price_options[${index}] must be an object` }
    }
    const row = entry as Record<string, unknown>

    const label = typeof row.label === 'string' ? row.label.trim() : ''
    if (!label) {
      return { ok: false, error: `price_options[${index}].label is required` }
    }

    const price = Number(row.price)
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: `price_options[${index}].price must be a non-negative number` }
    }

    const installationCost = parseInstallationCost(row.installation_cost, `price_options[${index}].installation_cost`)
    if (!installationCost.ok) {
      return { ok: false, error: installationCost.error }
    }

    const imageUrls = Array.isArray(row.image_urls)
      ? row.image_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      : []

    options.push({ label, price, installation_cost: installationCost.value, image_urls: imageUrls })
  }

  return { ok: true, options }
}
