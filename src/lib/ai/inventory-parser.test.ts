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

  // ============================================================
  // Punto 5 audit, H-4: parsePrice() used to Math.round() every price
  // before it reached ai_catalog_products.price (a `numeric` column
  // that fully supports decimals), silently turning $19.99 into $20.
  // These cases prove the real decimal value from the source now
  // survives all the way into the structured product row.
  // ============================================================
  describe('price precision (H-4) — decimals are preserved, never rounded', () => {
    it('a whole-number price is unaffected (existing behavior)', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '20']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(20)
    })

    it('a price with two decimals keeps them exactly — 19.99 → 19.99, never 20', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '19.99']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(19.99)
    })

    it('a larger price with two decimals keeps them exactly — 1499.95 → 1499.95', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '1499.95']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(1499.95)
    })

    it('a price with a trailing .00 is numerically the same whole value (no distinct "20.00" in JS)', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '20.00']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(20)
    })

    it('a currency-symbol + thousands-separator price with decimals keeps them exactly — RD$1,499.95 → 1499.95', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '"RD$1,499.95"']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(1499.95)
    })

    it('a price with two decimals and MORE than 3 integer digits still keeps them exactly — 12345.67 → 12345.67', () => {
      // A lone separator followed by exactly 3 digits is read as a
      // thousands group (see the locale-ambiguity test below) — but 2
      // decimal digits is unambiguous regardless of how many digits
      // come before the separator.
      const text = csv([['Nombre', 'Precio'], ['Producto', '12345.67']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(12345.67)
    })

    it('an invalid/empty price still becomes null — unchanged behavior', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', 'no-price']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBeNull()
    })

    it('the flattened KB content text is unaffected — formatCurrency() still displays whole numbers by the app-wide convention (src/lib/currency.ts), unrelated to this fix', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '19.99']])
      const parsed = parseSheetCsv(text, 'https://x/sheet.csv', undefined, 'USD')
      expect(parsed.products[0].price).toBe(19.99)
      expect(parsed.content).toContain('Producto')
      // formatCurrency's own, pre-existing whole-number-only formatting
      // (untouched by H-4) — this is the display layer, not the stored
      // catalog value asserted above.
      expect(parsed.content).not.toContain('19.99')
    })
  })

  // ============================================================
  // Real defect found auditing the AI agent (Oct 2026): this business's
  // real source report uses the Spanish/Latin-American thousands/decimal
  // convention (`.` groups thousands, `,` is the decimal point) for at
  // least some rows, while parsePrice() used to assume US/UK convention
  // unconditionally (strip `,`, leave `.` as the decimal point). A raw
  // value of "1.200" (meaning 1,200 DOP) was silently parsed as 1.2 —
  // confirmed against live production data (ai_catalog_products.price)
  // — which the agent then restated in prose as "DOP 1". Same bug
  // affected available_quantity via the identical thousands/decimal
  // ambiguity. These prove both price and quantity now disambiguate the
  // separator per-value instead of assuming one fixed locale.
  // ============================================================
  describe('locale-ambiguous thousands/decimal separators (AI agent audit)', () => {
    it('a lone dot followed by exactly 3 digits is read as thousands, not decimal — "1.200" → 1200, not 1.2', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '1.200']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(1200)
    })

    it('a lone dot with a trailing thousands group that happens to be "000" is still read as thousands — "5.000" → 5000, not 5', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '5.000']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(5000)
    })

    it('repeated dots are always thousands grouping, regardless of digit count — "1.234.567" → 1234567', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '1.234.567']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(1234567)
    })

    it('a lone dot followed by 2 digits is still read as a decimal point — "5.75" → 5.75', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '5.75']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(5.75)
    })

    it('Spanish convention with both separators — "1.200,50" (1,200.50) → 1200.5', () => {
      // Quoted — an unquoted comma would be read as a CSV field
      // separator by the parser itself, splitting the cell in two
      // before parsePrice ever sees it (same as the pre-existing
      // "RD$1,499.95" case above).
      const text = csv([['Nombre', 'Precio'], ['Producto', '"1.200,50"']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(1200.5)
    })

    it('a lone comma followed by exactly 3 digits is also read as thousands — "1,200" → 1200 (unchanged from before)', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '"1,200"']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(1200)
    })

    it('a lone comma followed by 2 digits is read as a decimal point — "19,99" → 19.99 (previously mis-parsed as 1999)', () => {
      const text = csv([['Nombre', 'Precio'], ['Producto', '"19,99"']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].price).toBe(19.99)
    })

    it('the same ambiguity is resolved identically for stock quantity — "1.500" units → 1500, not 1.5 rounded to 2', () => {
      const text = csv([['Nombre', 'Precio', 'Stock'], ['Producto', '10', '1.500']])
      expect(parseSheetCsv(text, 'https://x/sheet.csv').products[0].availableQuantity).toBe(1500)
    })
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
