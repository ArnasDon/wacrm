import 'server-only'
import type { ProductDoc } from '@/lib/db/types'
import { ValidationError } from '@/lib/http/errors'
import { bool, num, optStr, str, strList } from '@/lib/http/validate'

/**
 * Validate a product payload. Prices arrive in MAJOR units from the
 * form ("12500.50") and are stored as integer minor units.
 */
export function parseProductInput(
  body: Record<string, unknown>,
  partial: boolean,
): Partial<Omit<ProductDoc, '_id' | 'accountId' | 'createdAt' | 'updatedAt'>> {
  const out: Partial<Omit<ProductDoc, '_id' | 'accountId' | 'createdAt' | 'updatedAt'>> = {}
  const has = (k: string) => !partial || k in body

  if (has('name')) out.name = str(body.name, 'name', { max: 120 })
  if (has('sku')) out.sku = optStr(body.sku, 'sku', 60)
  if (has('description')) out.description = optStr(body.description, 'description', 1000)
  if (has('category')) out.category = optStr(body.category, 'category', 60)
  if (has('unit')) out.unit = optStr(body.unit, 'unit', 20) ?? 'pcs'
  if (has('price')) out.price = Math.round(num(body.price, 'price', { min: 0, max: 1_000_000_000 }) * 100)
  if (has('trackStock') || has('stock')) {
    const track = body.trackStock === undefined ? body.stock !== null && body.stock !== '' : bool(body.trackStock, 'trackStock')
    out.stock = track ? num(body.stock ?? 0, 'stock', { min: 0, max: 10_000_000, integer: true }) : null
  }
  if (has('lowStockThreshold')) {
    const v = num(body.lowStockThreshold ?? 5, 'lowStockThreshold', { min: 0, max: 1_000_000, integer: true })
    out.lowStockThreshold = v
  }
  if (has('aliases')) out.aliases = strList(body.aliases, 'aliases', 20, 60)
  if (has('isActive')) out.isActive = body.isActive === undefined ? true : bool(body.isActive, 'isActive')
  if (!partial && out.price === 0) {
    // Allowed (free item) but almost always a mistake in a form.
    if (body.allowFree !== true) throw new ValidationError('Price must be greater than zero')
  }
  return out
}
