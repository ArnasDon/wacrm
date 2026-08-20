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

    let installationCost: number | null = null
    if (row.installation_cost !== undefined && row.installation_cost !== null && row.installation_cost !== '') {
      const parsed = Number(row.installation_cost)
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { ok: false, error: `price_options[${index}].installation_cost must be a non-negative number` }
      }
      installationCost = parsed
    }

    const imageUrls = Array.isArray(row.image_urls)
      ? row.image_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      : []

    options.push({ label, price, installation_cost: installationCost, image_urls: imageUrls })
  }

  return { ok: true, options }
}
