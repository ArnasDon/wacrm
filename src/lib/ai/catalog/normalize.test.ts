import { describe, it, expect } from 'vitest'
import { levenshtein, normalizeText, rankBySignificantTokens, significantTokens } from './normalize'

describe('normalizeText', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizeText('Cámara Réflex')).toBe('camara reflex')
  })

  it('collapses hyphens/underscores/slashes to spaces', () => {
    expect(normalizeText('Samsung-A07')).toBe('samsung a07')
    expect(normalizeText('A_07')).toBe('a 07')
  })

  it('reduces every inch expression to a bare number, matching a source with NO unit at all', () => {
    // This is the exact AI_Catalog_Fix_Kit FASE 8 scenario: the real
    // product name never says "pulgadas" — it must still be reachable.
    for (const q of ['50"', '50in', '50 in', '50 inch', '50 inches', '50 pulgadas', '50 pulgada']) {
      expect(normalizeText(q)).toContain('50')
      expect(normalizeText(q)).not.toMatch(/pulgada|inch|"/)
    }
  })

  it('glues storage/RAM units (they already appear glued in real catalog names)', () => {
    expect(normalizeText('64 GB')).toBe('64gb')
    expect(normalizeText('64GB')).toBe('64gb')
    expect(normalizeText('4 GB RAM')).toBe('4gb ram')
  })

  it('does NOT alter the numeric value itself (no "50 → 500" style corruption)', () => {
    expect(normalizeText('50 pulgadas')).not.toContain('500')
    expect(normalizeText('64GB')).not.toContain('128')
  })
})

describe('significantTokens — model code recovery', () => {
  it('produces the glued form for a spaced/hyphenated model code, without dropping the split form', () => {
    for (const raw of ['Samsung A07', 'Samsung-A07', 'A 07', 'A-07', 'A07']) {
      const tokens = significantTokens(normalizeText(raw))
      expect(tokens).toContain('a07')
    }
  })

  it('drops filler stopwords but keeps meaningful short tokens like a bare size number', () => {
    const tokens = significantTokens(normalizeText('la tcl de 50 pulgadas'))
    expect(tokens).toContain('tcl')
    expect(tokens).toContain('50')
    expect(tokens).not.toContain('la')
    expect(tokens).not.toContain('de')
  })

  it('applies the controlled tv synonym group', () => {
    expect(significantTokens(normalizeText('televisor'))).toContain('tv')
    expect(significantTokens(normalizeText('smart tv'))).toContain('tv')
  })
})

describe('levenshtein', () => {
  it('is 0 for identical strings and correct for simple edits', () => {
    expect(levenshtein('disponible', 'disponible')).toBe(0)
    expect(levenshtein('dispnible', 'disponible')).toBe(1) // one dropped letter
  })
})

describe('rankBySignificantTokens — the reported real-world scenarios', () => {
  const CATALOG = [
    { name: 'TV TCL GOOGLE TV SMART 50 4K ULTRA HD RESOLUTION' },
    { name: 'TV TCL GOOGLE TV SMART 65 4K ULTRA HD RESOLUTION' },
    { name: 'SAMSUNG A07 128GB + 4GB NEGRO' },
    { name: 'SAMSUNG A07 128GB + 4GB MORADO' },
    { name: 'SAMSUNG A07 64GB + 4GB NEGRO' },
    { name: 'SAMSUNG A05 128GB + 4GB NEGRO' }, // decoy — must NOT rank for "A07" queries
    { name: 'AIRE ACONDICIONADO DLC INVERTER 12000 BTU' },
  ]
  const text = (p: { name: string }) => p.name

  it('"la tcl de 50 pulgadas" finds the 50" TCL even though the name never says "pulgadas"', () => {
    const ranked = rankBySignificantTokens('la tcl de 50 pulgadas', CATALOG, text)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].item.name).toContain('TV TCL')
    expect(ranked[0].item.name).toContain('50')
    // The 65" TCL must not outrank (or worse, silently replace) the 50" one.
    expect(ranked[0].item.name).not.toContain('65')
  })

  it('"TCL 50\\"" and "smart tv tcl" and the exact name all resolve to the same product', () => {
    for (const q of ['TCL 50"', 'tcl de 50 pulgadas', 'smart tv tcl 50', 'TV TCL GOOGLE TV SMART 50 4K ULTRA HD RESOLUTION']) {
      const ranked = rankBySignificantTokens(q, CATALOG, text)
      expect(ranked[0]?.item.name).toBe('TV TCL GOOGLE TV SMART 50 4K ULTRA HD RESOLUTION')
    }
  })

  it('"a 07" and "a-07" resolve to Samsung A07 rows, never to the A05 decoy', () => {
    for (const q of ['a 07', 'a-07', 'A07', 'samsung a 07']) {
      const ranked = rankBySignificantTokens(q, CATALOG, text)
      const names = ranked.map((r) => r.item.name)
      expect(names.some((n) => n.includes('A07'))).toBe(true)
      expect(names).not.toContain('SAMSUNG A05 128GB + 4GB NEGRO')
    }
  })

  it('tolerates a minor typo ("A07" vs a hypothetical "A0O7" style slip) without matching an unrelated model', () => {
    const ranked = rankBySignificantTokens('samsng a07', CATALOG, text) // "samsng" missing a letter
    expect(ranked[0]?.item.name).toContain('A07')
  })

  it('returns nothing for a query with no real overlap — never a false positive', () => {
    const ranked = rankBySignificantTokens('bicicleta electrica', CATALOG, text)
    expect(ranked).toEqual([])
  })

  it('never lets "50" match "500" or "5" — numeric values are not fuzzy', () => {
    const withDecoys = [...CATALOG, { name: 'REFRIGERADOR 500 LITROS' }, { name: 'CABLE HDMI 5 METROS' }]
    const ranked = rankBySignificantTokens('tcl 50 pulgadas', withDecoys, text)
    const names = ranked.map((r) => r.item.name)
    expect(names).not.toContain('REFRIGERADOR 500 LITROS')
    expect(names).not.toContain('CABLE HDMI 5 METROS')
  })
})

// ============================================================
// FASE FINAL DE AUDITORÍA — every query variant explicitly listed for
// review, run against a MULTI-CATEGORY catalog (phones, TVs, A/C, fans)
// to prove the logic is generic, not hardcoded for any one brand/kind.
// Each group asserts every equivalent phrasing resolves to the same
// top result, and that distinct real variants (different price/stock)
// are never conflated.
// ============================================================
describe('rankBySignificantTokens — full audit query list (generic across categories)', () => {
  const STORE = [
    // Phones — model code + capacity + color, no dedicated columns
    { name: 'SAMSUNG A07 128GB NEGRO', price: 9000, stock: 5 },
    { name: 'SAMSUNG A07 128GB MORADO', price: 9000, stock: 3 },
    { name: 'SAMSUNG A07 128GB VERDE', price: 9000, stock: 0 },
    { name: 'SAMSUNG A07 64GB NEGRO', price: 7500, stock: 2 },
    { name: 'SAMSUNG A07 64GB MORADO', price: 7500, stock: 0 },
    { name: 'SAMSUNG A05 128GB NEGRO', price: 8500, stock: 4 }, // decoy: different model
    // TVs — size with no unit at all in the real name
    { name: 'TV TCL GOOGLE TV SMART 50 4K ULTRA HD RESOLUTION', price: 24500, stock: 6 },
    { name: 'TV TCL GOOGLE TV SMART 65 4K ULTRA HD RESOLUTION', price: 38500, stock: 1 },
    // Appliances — proves the logic isn't phone/TV-specific
    { name: 'AIRE ACONDICIONADO VIDVIE 12000 BTU SPLIT INVERTER', price: 26500, stock: 4 },
    { name: 'ABANICO RECARGABLE STARZ', price: 3000, stock: 10 },
  ]
  const text = (p: { name: string }) => p.name

  const samsungA07Queries = ['Samsung A07', 'Samsung A 07', 'Samsung A-07', 'A07', 'a 07', 'a-07']
  it.each(samsungA07Queries)('%s → Samsung A07 rows, never the A05 decoy', (q) => {
    const ranked = rankBySignificantTokens(q, STORE, text)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked.every((r) => r.item.name.includes('A07'))).toBe(true)
    expect(ranked.some((r) => r.item.name.includes('A05'))).toBe(false)
  })

  const tcl50Queries = ['50 pulgadas', '50"', '50 pulgadas TCL', 'TCL 50', 'TV TCL de 50', 'la TCL de 50']
  it.each(tcl50Queries)('%s → the 50" TCL, never the 65" one', (q) => {
    const ranked = rankBySignificantTokens(q, STORE, text)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0].item.name).toContain('50')
    expect(ranked[0].item.name).not.toContain('65')
  })

  it('"esa TCL" / "esa de 50" alone are pure anaphora — outside a normalizer\'s job', () => {
    // Neither phrase names a brand/attribute a text search can act on;
    // resolving them requires the conversational catalog CONTEXT (see
    // context.test.ts), not the search layer. Documented here so the
    // boundary between the two mechanisms is explicit, not assumed.
    expect(rankBySignificantTokens('esa', STORE, text)).toEqual([])
  })

  const capacityQueries = ['64GB', '64 GB', 'de 64', 'el negro de 64']
  it.each(capacityQueries)('%s → actually finds the 64GB row, with its own price — never the 128GB one', (q) => {
    const ranked = rankBySignificantTokens(q, STORE, text)
    const a07_64 = ranked.find((r) => r.item.name === 'SAMSUNG A07 64GB NEGRO')
    // Must genuinely be found, not just "if present" — this is the real
    // regression check: "de 64" bare must resolve, not silently return
    // nothing because its own merge-noise token ("de64") can't match.
    expect(a07_64).toBeDefined()
    expect(a07_64!.item.price).toBe(7500)
    // The 128GB variant must NEVER appear for an explicit "64" query —
    // that would be exactly the capacity-merge bug this guards against.
    expect(ranked.some((r) => r.item.name === 'SAMSUNG A07 128GB NEGRO')).toBe(false)
  })

  it('"la morada" / "el verde" match on color alone across different products (generic, not Samsung-specific)', () => {
    const morada = rankBySignificantTokens('morado', STORE, text)
    expect(morada.some((r) => r.item.name.includes('MORADO'))).toBe(true)
    const verde = rankBySignificantTokens('verde', STORE, text)
    expect(verde.some((r) => r.item.name.includes('VERDE'))).toBe(true)
  })

  it('a non-phone, non-TV category (A/C, fan) is found the same way — the logic is generic', () => {
    const ac = rankBySignificantTokens('aire acondicionado vidvie 12000', STORE, text)
    expect(ac[0]?.item.name).toContain('AIRE ACONDICIONADO')
    const fan = rankBySignificantTokens('abanico starz', STORE, text)
    expect(fan[0]?.item.name).toContain('ABANICO')
  })

  it('every 128GB variant keeps its OWN price/stock — never inherited from another color', () => {
    const results = rankBySignificantTokens('samsung a07 128gb', STORE, text)
    const negro = results.find((r) => r.item.name.includes('NEGRO'))!
    const verde = results.find((r) => r.item.name.includes('VERDE'))!
    expect(negro.item.price).toBe(9000)
    expect(verde.item.price).toBe(9000) // same price here, but from ITS OWN row
    expect(negro.item.stock).toBe(5)
    expect(verde.item.stock).toBe(0) // different stock — proves rows are independent, not merged
  })
})
