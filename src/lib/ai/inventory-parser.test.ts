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

// ============================================================
// Column selection (AI Sales Agent audit — column-selection pass):
// selectedColumns must filter EVERY representation the parser
// produces — the flattened KB content (already did, unchanged), the
// persisted preview snapshot, AND the structured catalog `products` —
// not just the KB text. This is what makes "el agente IA solo debe
// recibir las columnas seleccionadas" actually true end to end, and
// what "Ver datos" showing only selected columns is built on.
// ============================================================
describe('parseSheetCsv — column selection filters every representation', () => {
  const SHEET = csv([
    ['Nombre', 'Precio', 'Cantidad', 'Marca', 'Modelo'],
    ['Producto X', '1500', '10', 'MarcaX', 'ModeloX'],
  ])

  it('metadata.columns always lists every real header, regardless of selection', () => {
    const parsed = parseSheetCsv(SHEET, 'https://x/sheet.csv', ['Nombre', 'Precio'])
    expect(parsed.metadata.columns).toEqual(['Nombre', 'Precio', 'Cantidad', 'Marca', 'Modelo'])
  })

  it('metadata.previewColumns / preview.sample only contain the SELECTED columns', () => {
    const parsed = parseSheetCsv(SHEET, 'https://x/sheet.csv', ['Nombre', 'Precio'])
    expect(parsed.metadata.previewColumns).toEqual(['Nombre', 'Precio'])
    expect(parsed.preview.sample).toEqual([{ Nombre: 'Producto X', Precio: '1500' }])
    expect(parsed.preview.sample[0]).not.toHaveProperty('Marca')
  })

  it('an excluded role column is null on the structured product row, even though the sheet has it', () => {
    const parsed = parseSheetCsv(SHEET, 'https://x/sheet.csv', ['Nombre', 'Precio', 'Cantidad']) // Marca/Modelo excluded
    expect(parsed.products).toHaveLength(1)
    expect(parsed.products[0]).toMatchObject({ name: 'Producto X', price: 1500, availableQuantity: 10 })
    expect(parsed.products[0].brand).toBeNull()
    expect(parsed.products[0].model).toBeNull()
  })

  it('selecting every real column is equivalent to no selection at all', () => {
    const all = parseSheetCsv(SHEET, 'https://x/sheet.csv', ['Nombre', 'Precio', 'Cantidad', 'Marca', 'Modelo'])
    const none = parseSheetCsv(SHEET, 'https://x/sheet.csv')
    expect(all.products).toEqual(none.products)
    expect(all.preview.sample).toEqual(none.preview.sample)
  })

  it('an unselected name column still falls back to the first cell, so a row is never silently lost over it', () => {
    const parsed = parseSheetCsv(SHEET, 'https://x/sheet.csv', ['Precio']) // Nombre excluded
    expect(parsed.products).toHaveLength(1)
    expect(parsed.products[0].name).toBe('Producto X') // recovered via the column-0 fallback
  })

  // AI Sales Agent audit (final pass), Part 9 — the exact "internal
  // cost column must never reach the agent" scenario, verified across
  // BOTH representations the agent can see: the flattened KB `content`
  // text AND the structured `products` rows that become
  // ai_catalog_products.
  it('a sensitive/internal column excluded from selection never appears in KB content OR structured products', () => {
    const withInternalCost = csv([
      ['Nombre', 'Precio', 'Cantidad', 'Costo_Interno'],
      ['Producto X', '1500', '10', '900'],
    ])
    const parsed = parseSheetCsv(withInternalCost, 'https://x/sheet.csv', ['Nombre', 'Precio', 'Cantidad'])

    // Not in the flattened KB text (what retrieveKnowledge chunks/embeds).
    expect(parsed.content).not.toContain('Costo_Interno')
    expect(parsed.content).not.toContain('900')
    // Not in preview.sample (what "Ver datos" / preview_sample stores).
    expect(parsed.preview.sample[0]).not.toHaveProperty('Costo_Interno')
    // Not on the structured product row under any field — description
    // is the most likely accidental leak point for an unrecognized
    // column, so check the whole object, not just the obvious fields.
    const product = parsed.products[0]
    expect(Object.values(product)).not.toContain('900')
    expect(JSON.stringify(product)).not.toContain('Costo_Interno')
  })
})
