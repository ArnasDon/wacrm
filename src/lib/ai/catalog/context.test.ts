import { describe, it, expect } from 'vitest'
import { catalogContextToPromptText, updateCatalogContext } from './context'
import type { ToolCallLogEntry } from '../types'

// ============================================================
// AI_Catalog_Fix_Kit FASE 19 — "Contexto": the exact scripted scenario
// (Samsung A07 → "el negro de 64" → "y el morado?") plus the Playground
// discontinuity bug this module exists to fix.
// ============================================================

const A07_128_NEGRO = { id: 'ds_1:a07-128-negro', name: 'Samsung A07 128GB Negro', brand: 'Samsung', model: 'A07', colors: ['Negro'], capacity: '128GB', size: null, price: 9000, currency: 'DOP' }
const A07_128_MORADO = { id: 'ds_1:a07-128-morado', name: 'Samsung A07 128GB Morado', brand: 'Samsung', model: 'A07', colors: ['Morado'], capacity: '128GB', size: null, price: 9000, currency: 'DOP' }
const A07_64_NEGRO = { id: 'ds_1:a07-64-negro', name: 'Samsung A07 64GB Negro', brand: 'Samsung', model: 'A07', colors: ['Negro'], capacity: '64GB', size: null, price: 7500, currency: 'DOP' }
const A07_64_MORADO = { id: 'ds_1:a07-64-morado', name: 'Samsung A07 64GB Morado', brand: 'Samsung', model: 'A07', colors: ['Morado'], capacity: '64GB', size: null, price: 7500, currency: 'DOP' }

function searchCall(query: string, products: unknown[]): ToolCallLogEntry {
  return { name: 'search_catalog', input: { query }, result: { products } }
}
function getProductCall(product: unknown): ToolCallLogEntry {
  return { name: 'get_product', input: { id: (product as { id: string }).id }, result: { product } }
}

describe('updateCatalogContext — multi-turn scenario', () => {
  it('turn 1: "¿tienen A07?" — remembers every variant search_catalog returned', () => {
    const ctx = updateCatalogContext(null, [
      searchCall('samsung a07', [A07_128_NEGRO, A07_128_MORADO, A07_64_NEGRO, A07_64_MORADO]),
    ])
    expect(ctx.lastQuery).toBe('samsung a07')
    expect(ctx.products.map((p) => p.id).sort()).toEqual(
      [A07_128_NEGRO, A07_128_MORADO, A07_64_NEGRO, A07_64_MORADO].map((p) => p.id).sort(),
    )
  })

  it('turn 2: "el negro de 64" resolved via get_product — merges without losing turn 1\'s family', () => {
    const turn1 = updateCatalogContext(null, [searchCall('samsung a07', [A07_128_NEGRO, A07_128_MORADO, A07_64_NEGRO, A07_64_MORADO])])
    const turn2 = updateCatalogContext(turn1, [getProductCall(A07_64_NEGRO)])
    // Still knows about all four — get_product upserts, never replaces
    // the whole list, so "y el morado?" on turn 3 still has candidates.
    expect(turn2.products.map((p) => p.id)).toEqual(expect.arrayContaining([A07_128_NEGRO.id, A07_128_MORADO.id, A07_64_NEGRO.id, A07_64_MORADO.id]))
  })

  it('a subsequent search REPLACES stale entries by id but keeps others (recency-first, capped)', () => {
    const turn1 = updateCatalogContext(null, [searchCall('samsung a07', [A07_64_NEGRO])])
    const turn2 = updateCatalogContext(turn1, [
      searchCall('samsung a08', [{ ...A07_64_NEGRO, id: 'ds_1:a08-64-negro', name: 'Samsung A08 64GB Negro', price: 8200 }]),
    ])
    expect(turn2.lastQuery).toBe('samsung a08')
    // New product present, most-recent-first...
    expect(turn2.products[0].id).toBe('ds_1:a08-64-negro')
    // ...but the old A07 entry is still known (not wiped).
    expect(turn2.products.some((p) => p.id === A07_64_NEGRO.id)).toBe(true)
  })

  it('never fabricates a price for a product it never actually resolved', () => {
    const ctx = updateCatalogContext(null, [searchCall('samsung a07', [A07_64_NEGRO])])
    expect(ctx.products.every((p) => typeof p.price === 'number' || p.price === null)).toBe(true)
    // Every stored price came verbatim from the tool result, not a guess.
    expect(ctx.products[0].price).toBe(A07_64_NEGRO.price)
  })

  it('get_availability/get_product_media do NOT get folded into the product list (partial data risk)', () => {
    const turn1 = updateCatalogContext(null, [searchCall('samsung a07', [A07_64_NEGRO])])
    const availabilityOnly: ToolCallLogEntry = {
      name: 'get_availability',
      input: { id: A07_64_NEGRO.id },
      result: { productId: A07_64_NEGRO.id, available: false, availableQuantity: 0 },
    }
    const turn2 = updateCatalogContext(turn1, [availabilityOnly])
    // The one product we DO know about still carries its real price —
    // an availability-only tool call must never overwrite it with a
    // partial record that has no price field.
    expect(turn2.products.find((p) => p.id === A07_64_NEGRO.id)?.price).toBe(A07_64_NEGRO.price)
  })
})

describe('catalogContextToPromptText', () => {
  it('returns null for an empty/absent context — no prompt bloat when the catalog was never touched', () => {
    expect(catalogContextToPromptText(null)).toBeNull()
    expect(catalogContextToPromptText({ lastQuery: null, products: [], updatedAt: '' })).toBeNull()
  })

  it('renders every known product with its id and last-seen price, and instructs re-confirmation', () => {
    const ctx = updateCatalogContext(null, [searchCall('samsung a07', [A07_128_NEGRO, A07_128_MORADO])])
    const text = catalogContextToPromptText(ctx)!
    expect(text).toContain(A07_128_NEGRO.id)
    expect(text).toContain('9000')
    expect(text).toContain(A07_128_MORADO.id)
    // The critical safety instruction — context is for disambiguation
    // only, never a substitute for a fresh tool call.
    expect(text.toLowerCase()).toContain('nunca respondas un precio')
  })
})

// ============================================================
// AI Sales Agent audit, Part 7/8/24: the exact scripted conversation —
// Samsung A07 → negro → de 64 → cuánto cuesta → morado → topic change
// to TV → de 50 → TCL. Verifies both that every product stays
// resolvable across the whole chain (Part 7) AND that the topic change
// is visible to the model as a distinct group with explicit guidance,
// not silently blended into one flat list (Part 8).
// ============================================================
describe('catalogContextToPromptText — topic change (Part 8)', () => {
  const TV_TCL_50 = { id: 'ds_1:tcl-50', name: 'TV TCL 50 4K', brand: 'TCL', model: null, colors: [], capacity: null, size: '50"', price: 25000, currency: 'DOP' }
  const TV_SAMSUNG_50 = { id: 'ds_1:sam-50', name: 'TV Samsung 50 QLED', brand: 'Samsung', model: null, colors: [], capacity: null, size: '50"', price: 32000, currency: 'DOP' }

  it('groups context by the query that found each product, so an old topic is visually distinct from the current one', () => {
    // Turn 1: exploring the A07.
    const turn1 = updateCatalogContext(null, [searchCall('samsung a07', [A07_64_NEGRO, A07_64_MORADO])])
    // Turn 2: "ahora quiero una tv" → "de 50" — a real topic change.
    const turn2 = updateCatalogContext(turn1, [searchCall('tv 50', [TV_TCL_50, TV_SAMSUNG_50])])

    expect(turn2.lastQuery).toBe('tv 50') // self-corrects to the new topic
    const text = catalogContextToPromptText(turn2)!

    // Both topics are still findable (the A07 stays resolvable per Part
    // 7 if the customer circles back)...
    expect(text).toContain('samsung a07')
    expect(text).toContain('tv 50')
    expect(text).toContain(A07_64_NEGRO.id)
    expect(text).toContain(TV_TCL_50.id)
    // ...but rendered as two SEPARATE labeled groups, not one flat list,
    // and the model is explicitly told to treat an unrelated new
    // message as a fresh search rather than forcing it onto the old
    // group.
    expect(text).toContain('De la búsqueda "tv 50"')
    expect(text).toContain('De la búsqueda "samsung a07"')
    expect(text.toLowerCase()).toContain('cambio de tema')
  })

  it('the full scripted conversation stays resolvable end to end: A07 → negro → 64 → morado → topic change → TV 50 → TCL', () => {
    let ctx = updateCatalogContext(null, [searchCall('samsung a07', [A07_128_NEGRO, A07_128_MORADO, A07_64_NEGRO, A07_64_MORADO])])
    ctx = updateCatalogContext(ctx, [getProductCall(A07_64_NEGRO)]) // "el negro de 64"
    ctx = updateCatalogContext(ctx, [getProductCall(A07_64_MORADO)]) // "y el morado"
    // "ahora quiero una tv" / "de 50" / "TCL" — one fresh search covers it.
    ctx = updateCatalogContext(ctx, [searchCall('tcl 50', [TV_TCL_50])])

    expect(ctx.lastQuery).toBe('tcl 50')
    // Every product touched across the whole conversation is still
    // present (capped at MAX_CONTEXT_PRODUCTS=20, well above this
    // count) — nothing was destructively dropped on the topic change.
    const ids = ctx.products.map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([A07_128_NEGRO.id, A07_128_MORADO.id, A07_64_NEGRO.id, A07_64_MORADO.id, TV_TCL_50.id]),
    )
    // The current topic (TV) is what a follow-up "¿cuánto cuesta?" would
    // resolve against — it's the most recent group, listed first.
    expect(ctx.products[0].id).toBe(TV_TCL_50.id)
    expect(ctx.products[0].fromQuery).toBe('tcl 50')
  })
})

// ============================================================
// AI Sales Agent audit (re-pass), Part 12 Escenario 1 — the exact
// scripted conversation given this turn: A26 → A07 (a DIFFERENT model,
// not a variant of A26) → morado de 64 → topic change to TV → "y de
// otra marca" → Samsung → TCL. Distinct from the earlier topic-change
// test: this checks that TWO SIMILAR BUT DIFFERENT PHONE MODELS in
// immediate sequence never get cross-contaminated (a customer asking
// about the A26 first, then the A07, must not have the A26 silently
// forgotten NOR the A07 answered with A26 data or vice versa).
// ============================================================
describe('updateCatalogContext — two different models in sequence stay independently resolvable', () => {
  const A26_NEGRO = { id: 'ds_1:a26-negro', name: 'Samsung A26 128GB Negro', brand: 'Samsung', model: 'A26', colors: ['Negro'], capacity: '128GB', size: null, price: 11500, currency: 'DOP' }
  const A26_AZUL = { id: 'ds_1:a26-azul', name: 'Samsung A26 128GB Azul', brand: 'Samsung', model: 'A26', colors: ['Azul'], capacity: '128GB', size: null, price: 11500, currency: 'DOP' }

  it('"tienen el A26 y qué colores" then "y el A07 tiene de 128" — the A26 answer is never reused for the A07 question', () => {
    // Turn 1: "Tienen el A26 y qué colores?"
    let ctx = updateCatalogContext(null, [searchCall('samsung a26', [A26_NEGRO, A26_AZUL])])
    expect(ctx.lastQuery).toBe('samsung a26')

    // Turn 2: "Bien y el A07 tiene de 128?" — a DIFFERENT model, not a
    // color/capacity follow-up of the A26. Must trigger its own fresh
    // search, not silently answer using A26 rows.
    ctx = updateCatalogContext(ctx, [searchCall('samsung a07 128', [A07_128_NEGRO, A07_128_MORADO])])
    expect(ctx.lastQuery).toBe('samsung a07 128')

    // Turn 3: "Y no tienen el morado de 64?" — back to A07, a different
    // capacity this time.
    ctx = updateCatalogContext(ctx, [getProductCall(A07_64_MORADO)])

    // Both models remain independently present and correct — the A26
    // entries were never overwritten or dropped just because the A07
    // became the active topic, and neither model's price/color data
    // bled into the other's.
    const byId = new Map(ctx.products.map((p) => [p.id, p]))
    expect(byId.get(A26_NEGRO.id)).toMatchObject({ model: 'A26', color: 'Negro', price: 11500 })
    expect(byId.get(A26_AZUL.id)).toMatchObject({ model: 'A26', color: 'Azul', price: 11500 })
    expect(byId.get(A07_128_NEGRO.id)).toMatchObject({ model: 'A07', capacity: '128GB', price: 9000 })
    expect(byId.get(A07_64_MORADO.id)).toMatchObject({ model: 'A07', capacity: '64GB', price: 7500 })
    // The rendered prompt keeps them in clearly separate, labeled
    // groups rather than one ambiguous blended list.
    const text = catalogContextToPromptText(ctx)!
    expect(text).toContain('De la búsqueda "samsung a26"')
    expect(text).toContain('De la búsqueda "samsung a07 128"')
  })
})
