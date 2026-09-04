import { describe, it, expect } from 'vitest'
import { toCatalogProduct, toToolResultProduct } from './whitelist'

// ============================================================
// The whitelist is the single choke point every catalog result crosses
// before reaching the LLM (see docs/integrations/ai-data-integration/
// 01_MASTER_EXECUTION.md "WHITELIST ERP" and docs/integrations/
// budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md §6/§7). These
// tests assert the ALLOW-list holds even when a raw provider payload
// carries every forbidden field the spec names.
// ============================================================

const FORBIDDEN_RAW = {
  id: 'p1',
  source: 'Test ERP',
  name: 'Samsung Galaxy S25 256GB',
  price: 34900,
  currency: 'DOP',
  // Everything below is explicitly forbidden by the spec and must never
  // survive toCatalogProduct — note none of these are declared fields
  // on RawCatalogProductInput, so they can only leak if someone widens
  // that interface without also widening toCatalogProduct's mapping.
  imei: '359999099999999',
  IMEI_1: '359999099999999',
  IMEI_2: '359999099999998',
  serial: 'SN-ABC-123',
  serial_number: 'SN-ABC-123',
  unit_cost: 21000,
  purchase_cost: 21000,
  cost: 21000,
  margin: 13900,
  supplier: 'Acme Distribuidora',
  supplier_id: 'sup-42',
  stock_movements: [{ type: 'in', qty: 10 }],
  private_customer_data: { name: 'Jane Doe', phone: '+18095551234' },
  payments: [{ amount: 100 }],
  cash: 5000,
  accounting: { ledger: 'x' },
  payroll: { employee: 'y' },
} as unknown as Parameters<typeof toCatalogProduct>[0]

describe('toCatalogProduct — allow-list', () => {
  it('carries through only the authorized commercial fields', () => {
    const product = toCatalogProduct(FORBIDDEN_RAW)
    expect(product).toEqual({
      id: 'p1',
      name: 'Samsung Galaxy S25 256GB',
      brand: null,
      model: null,
      sku: null,
      description: null,
      variants: [],
      colors: [],
      capacity: null,
      size: null,
      price: 34900,
      currency: 'DOP',
      // No `available`/`available_quantity` in the raw input at all —
      // the safe default is "not confirmed available", never a guessed
      // true (see the "never invent" rule).
      available: false,
      availableQuantity: null,
      primaryImage: null,
      images: [],
      source: 'Test ERP',
    })
  })

  it('never exposes IMEI/serial/cost/margin/supplier — the object has no such keys', () => {
    const product = toCatalogProduct(FORBIDDEN_RAW) as unknown as Record<string, unknown>
    for (const forbidden of [
      'imei', 'IMEI_1', 'IMEI_2', 'serial', 'serial_number', 'unit_cost',
      'purchase_cost', 'cost', 'margin', 'supplier', 'supplier_id',
      'stock_movements', 'private_customer_data', 'payments', 'cash',
      'accounting', 'payroll',
    ]) {
      expect(product).not.toHaveProperty(forbidden)
    }
    // Serialize what would actually go over the wire to the LLM and
    // scan for the forbidden values too — belt and suspenders against
    // a value leaking under a permitted key name.
    const serialized = JSON.stringify(toToolResultProduct(product as never))
    expect(serialized).not.toContain('359999099999999')
    expect(serialized).not.toContain('SN-ABC-123')
    expect(serialized).not.toContain('Acme Distribuidora')
  })

  it('toToolResultProduct also drops the internal `source` field', () => {
    const product = toCatalogProduct(FORBIDDEN_RAW)
    const result = toToolResultProduct(product)
    expect(result).not.toHaveProperty('source')
  })

  it('derives `available` from available_quantity when the field is absent', () => {
    const inStock = toCatalogProduct({ id: 'p2', name: 'X', source: 's', available_quantity: 3 })
    expect(inStock.available).toBe(true)
    const outOfStock = toCatalogProduct({ id: 'p3', name: 'X', source: 's', available_quantity: 0 })
    expect(outOfStock.available).toBe(false)
  })

  it('falls back to a generic name when the source omits one', () => {
    const product = toCatalogProduct({ id: 'p4', source: 's' })
    expect(product.name).toBe('Producto')
  })

  it('drops malformed image entries (missing url) instead of throwing', () => {
    const product = toCatalogProduct({
      id: 'p5',
      name: 'X',
      source: 's',
      primary_image: { alt: 'no url here' },
      images: [{ url: 'https://example.com/a.jpg' }, { alt: 'bad' }, 'not-an-object'],
    })
    expect(product.primaryImage).toBeNull()
    expect(product.images).toEqual([{ url: 'https://example.com/a.jpg' }])
  })
})
