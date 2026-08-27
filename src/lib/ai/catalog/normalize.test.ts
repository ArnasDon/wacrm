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
