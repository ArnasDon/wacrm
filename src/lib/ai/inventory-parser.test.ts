import { describe, it, expect } from 'vitest'
import { parseSheetCsv, InventoryError } from './inventory-parser'

// ============================================================
// Covers the structured `products` extraction added for catalog-usage
// Data Sources (see src/lib/ai/data-sources/service.ts), plus the
// parsing-edge-case checklist from docs/integrations/ai-data-integration/
// 01_MASTER_EXECUTION.md ("PRUEBAS OBLIGATORIAS" → Data Sources):
// headers diferentes, columnas faltantes, campos vacíos, precios,
// caracteres especiales, variantes.
//
// parseSheetCsv is used (rather than the file/Excel variants) because
// it needs no binary fixture — a CSV string is enough to exercise the
// shared `buildInventory`/`buildProductRows` logic.
// ============================================================

function csv(rows: string[][]): string {
  return rows.map((r) => r.join(',')).join('\n')
}

describe('parseSheetCsv — structured product rows', () => {
  it('extracts sku/name/price/stock/color/capacity/brand/model/image via header synonyms', () => {
    const text = csv([
      ['SKU', 'Nombre', 'Marca', 'Modelo', 'Precio', 'Stock', 'Color', 'Capacidad', 'Imagen'],
      ['SAM-S25-256', 'Samsung Galaxy S25', 'Samsung', 'S25', '34900', '4', 'Negro', '256GB', 'https://x/img.jpg'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv', undefined, 'DOP')
    expect(parsed.products).toHaveLength(1)
    expect(parsed.products[0]).toMatchObject({
      sku: 'SAM-S25-256',
      name: 'Samsung Galaxy S25',
      brand: 'Samsung',
      model: 'S25',
      price: 34900,
      availableQuantity: 4,
      color: 'Negro',
      capacity: '256GB',
      imageUrl: 'https://x/img.jpg',
    })
  })

  it('keeps distinct variant rows (256GB vs 512GB) as separate products with their own price', () => {
    const text = csv([
      ['Nombre', 'Capacidad', 'Precio', 'Stock'],
      ['Samsung Galaxy S25', '256GB', '34900', '4'],
      ['Samsung Galaxy S25', '512GB', '39900', '2'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv', undefined, 'DOP')
    expect(parsed.products).toHaveLength(2)
    const byCapacity = Object.fromEntries(parsed.products.map((p) => [p.capacity, p.price]))
    // The 512GB row's price must never bleed into the 256GB row or
    // vice versa — this is the code-level half of the "no variant
    // price reuse" guardrail.
    expect(byCapacity['256GB']).toBe(34900)
    expect(byCapacity['512GB']).toBe(39900)
  })

  it('tolerates a header set with columns in a different order', () => {
    const text = csv([
      ['Precio', 'Nombre', 'Stock'],
      ['100', 'Widget', '5'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv')
    expect(parsed.products[0]).toMatchObject({ name: 'Widget', price: 100, availableQuantity: 5 })
  })

  it('handles a missing price/stock column by leaving those fields null, not throwing', () => {
    const text = csv([
      ['Nombre'],
      ['Solo un nombre'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv')
    expect(parsed.products).toHaveLength(1)
    expect(parsed.products[0]).toMatchObject({ name: 'Solo un nombre', price: null, availableQuantity: null })
  })

  it('drops a row with no name and no usable first cell', () => {
    const text = csv([
      ['Nombre', 'Precio'],
      ['', '100'],
      ['Real product', '200'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv')
    expect(parsed.products).toHaveLength(1)
    expect(parsed.products[0].name).toBe('Real product')
  })

  it('treats an empty price cell as null rather than 0', () => {
    const text = csv([
      ['Nombre', 'Precio'],
      ['Sin precio', ''],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv')
    expect(parsed.products[0].price).toBeNull()
  })

  it('parses prices with currency symbols and thousands separators', () => {
    const text = csv([
      ['Nombre', 'Precio'],
      ['Producto', '"RD$34,900.00"'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv')
    expect(parsed.products[0].price).toBe(34900)
  })

  it('preserves special / accented characters in the name', () => {
    const text = csv([
      ['Nombre', 'Precio'],
      ['Cámara réflex — edición ñoño 100%', '500'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv')
    expect(parsed.products[0].name).toBe('Cámara réflex — edición ñoño 100%')
  })

  it('rejects a file with no data rows', () => {
    expect(() => parseSheetCsv('Nombre,Precio', 'https://example.com/sheet.csv')).toThrow(InventoryError)
  })

  it('still produces the flattened KB `content` text alongside `products` (knowledge/both usage)', () => {
    const text = csv([
      ['Nombre', 'Precio', 'Stock'],
      ['Widget', '100', '5'],
    ])
    const parsed = parseSheetCsv(text, 'https://example.com/sheet.csv', undefined, 'USD')
    expect(parsed.content).toContain('Widget')
    expect(parsed.content).toContain('Stock: 5 unidades')
  })
})
