import { describe, it, expect } from 'vitest'
import { routeAiContext } from './routing'

// ============================================================
// Routing — AI optimization project, FASE 5. Covers exactly the
// mandatory test matrix from the routing authorization (18 cases),
// plus genericity checks (a hardware store / restaurant / clinic,
// never just phone-store examples) and the "no resource available"
// edge cases the REGLA PRINCIPAL depends on.
//
// routeAiContext is pure — no DB, no network, no model call — so every
// case here is a plain input/output assertion.
// ============================================================

const BOTH = { hasCatalog: true, hasKnowledge: true }

describe('routeAiContext — greetings and simple acknowledgements (Casos 1-2)', () => {
  it('1. "Hola" → neither', () => {
    expect(routeAiContext({ message: 'Hola', ...BOTH }).decision).toBe('neither')
  })

  it('2. "Gracias" → neither', () => {
    expect(routeAiContext({ message: 'Gracias', ...BOTH }).decision).toBe('neither')
  })

  it('a greeting never triggers useCatalog/useKnowledge even when both are available', () => {
    const result = routeAiContext({ message: 'Buenos días', ...BOTH })
    expect(result).toEqual({ decision: 'neither', useCatalog: false, useKnowledge: false })
  })
})

describe('routeAiContext — Knowledge-only questions (Casos 3-5)', () => {
  it('3. "¿Dónde están ubicados?" → knowledge', () => {
    const result = routeAiContext({ message: '¿Dónde están ubicados?', ...BOTH })
    expect(result).toEqual({ decision: 'knowledge', useCatalog: false, useKnowledge: true })
  })

  it('4. "¿Cuál es el horario?" → knowledge', () => {
    expect(routeAiContext({ message: '¿Cuál es el horario?', ...BOTH }).decision).toBe('knowledge')
  })

  it('5. "¿Hacen delivery?" → knowledge', () => {
    expect(routeAiContext({ message: '¿Hacen delivery?', ...BOTH }).decision).toBe('knowledge')
  })

  it('"¿Aceptan tarjeta?" → knowledge (payment methods, no product mentioned)', () => {
    expect(routeAiContext({ message: '¿Aceptan tarjeta?', ...BOTH }).decision).toBe('knowledge')
  })
})

describe('routeAiContext — catalog-only questions (Casos 6-8)', () => {
  it('6. "¿Cuánto cuesta el Samsung A56?" → catalog', () => {
    const result = routeAiContext({ message: '¿Cuánto cuesta el Samsung A56?', ...BOTH })
    expect(result).toEqual({ decision: 'catalog', useCatalog: true, useKnowledge: false })
  })

  it('7. "¿Tienen el A56?" → catalog', () => {
    expect(routeAiContext({ message: '¿Tienen el A56?', ...BOTH }).decision).toBe('catalog')
  })

  it('8. "¿Hay en negro?" → catalog', () => {
    expect(routeAiContext({ message: '¿Hay en negro?', ...BOTH }).decision).toBe('catalog')
  })

  // FASE 11 (facets) — Regla 10/Escenario 19: these are the exact
  // phrasings the facets feature exists to answer ("qué marcas/colores/
  // opciones tienen"); routing must keep sending them to catalog
  // unmodified — no new "facets" route was created.
  it('"¿Qué marcas tienen?" → catalog (facets integration, FASE 11)', () => {
    expect(routeAiContext({ message: '¿Qué marcas tienen?', ...BOTH }).decision).toBe('catalog')
  })

  it('"¿Qué colores tienen?" → catalog (facets integration, FASE 11)', () => {
    expect(routeAiContext({ message: '¿Qué colores tienen?', ...BOTH }).decision).toBe('catalog')
  })

  it('9. "¿Cuántos quedan?" → catalog when catalog context is active', () => {
    const result = routeAiContext({ message: '¿Cuántos quedan?', ...BOTH, catalogContextActive: true })
    expect(result.decision).toBe('catalog')
  })

  it('"¿cuántos quedan?" is catalog on its own vocabulary too ("quedan"), independent of context — the context test above is not the only path', () => {
    const result = routeAiContext({ message: '¿Cuántos quedan?', ...BOTH, catalogContextActive: false })
    expect(result.decision).toBe('catalog')
  })
})

describe('routeAiContext — mixed questions (Casos 10-12)', () => {
  it('10. "¿Cuánto cuesta el A56 y hacen delivery?" → both', () => {
    const result = routeAiContext({ message: '¿Cuánto cuesta el A56 y hacen delivery?', ...BOTH })
    expect(result).toEqual({ decision: 'both', useCatalog: true, useKnowledge: true })
  })

  it('11. "¿Tienen televisores y hacen delivery?" → both', () => {
    expect(routeAiContext({ message: '¿Tienen televisores y hacen delivery?', ...BOTH }).decision).toBe('both')
  })

  it('12. "¿Dónde están y qué celulares tienen?" → both', () => {
    expect(routeAiContext({ message: '¿Dónde están y qué celulares tienen?', ...BOTH }).decision).toBe('both')
  })

  it('"¿Hay disponible y aceptan tarjeta?" → both (from the phase spec\'s own extra examples)', () => {
    expect(routeAiContext({ message: '¿Hay disponible y aceptan tarjeta?', ...BOTH }).decision).toBe('both')
  })
})

describe('routeAiContext — multiturn / catalog-context continuation (Casos 13-14)', () => {
  it('13. previous turn about the A56, then "¿y en negro?" → catalog', () => {
    const result = routeAiContext({ message: '¿Y en negro?', ...BOTH, catalogContextActive: true })
    expect(result.decision).toBe('catalog')
  })

  it('14. previous turn about the A56, then "¿hacen delivery?" → both when Knowledge is available', () => {
    const result = routeAiContext({ message: '¿Hacen delivery?', ...BOTH, catalogContextActive: true })
    expect(result).toEqual({ decision: 'both', useCatalog: true, useKnowledge: true })
  })

  it('a content-free follow-up ("¿cuál recomiendas?") stays on catalog when context is active, even with zero catalog vocabulary', () => {
    const result = routeAiContext({ message: '¿Cuál recomiendas?', ...BOTH, catalogContextActive: true })
    expect(result.useCatalog).toBe(true)
  })

  it('the SAME content-free follow-up, with NO active context, falls to the conservative ambiguous branch (both, since both are available)', () => {
    const result = routeAiContext({ message: '¿Cuál recomiendas?', ...BOTH, catalogContextActive: false })
    expect(result.decision).toBe('both')
  })
})

describe('routeAiContext — Comprobación crítica F: exhaustive listing requests never lose catalog access', () => {
  it('"dame todos los TCL" carries no generic catalog vocabulary of its own, but still gets useCatalog=true via the ambiguous fallback', () => {
    // Brand names ("TCL") are deliberately NOT part of routing.ts's
    // vocabulary (genericity requirement) — this proves the ambiguous
    // branch, not a brand-specific rule, is what keeps this working:
    // has_more/total/pagination themselves are entirely search_catalog's
    // concern and are never touched by routing.
    const result = routeAiContext({ message: 'Dame todos los TCL', hasCatalog: true, hasKnowledge: false })
    expect(result.useCatalog).toBe(true)
  })

  it('"muéstrame todas las opciones" (a fully generic exhaustive request) also keeps catalog attached', () => {
    const result = routeAiContext({ message: 'Muéstrame todas las opciones', hasCatalog: true, hasKnowledge: true })
    expect(result.useCatalog).toBe(true)
  })
})

describe('routeAiContext — respects real account capabilities (Casos 15-16, 18)', () => {
  it('15. account with no catalog + a product question → catalog is never activated', () => {
    const result = routeAiContext({
      message: '¿Cuánto cuesta el A56?',
      hasCatalog: false,
      hasKnowledge: true,
    })
    expect(result.useCatalog).toBe(false)
  })

  it('16. account with no Knowledge + a business question → Knowledge is never attempted', () => {
    const result = routeAiContext({
      message: '¿Dónde están ubicados?',
      hasCatalog: true,
      hasKnowledge: false,
    })
    expect(result.useKnowledge).toBe(false)
  })

  it('18. account with neither source → neither, no error, no extra work', () => {
    const result = routeAiContext({ message: '¿Cuánto cuesta?', hasCatalog: false, hasKnowledge: false })
    expect(result).toEqual({ decision: 'neither', useCatalog: false, useKnowledge: false })
  })

  it('a strong catalog signal cannot force catalog on when hasCatalog is false — decision degrades to what IS real', () => {
    const result = routeAiContext({
      message: '¿Cuánto cuesta y tienen en negro?',
      hasCatalog: false,
      hasKnowledge: true,
    })
    expect(result.useCatalog).toBe(false)
    expect(result.decision).not.toBe('catalog')
  })
})

describe('routeAiContext — ambiguity (Caso 17)', () => {
  it('17. a genuinely ambiguous message → both, when both resources are available', () => {
    const result = routeAiContext({ message: 'Necesito ayuda con algo', ...BOTH })
    expect(result).toEqual({ decision: 'both', useCatalog: true, useKnowledge: true })
  })

  it('an ambiguous message with only catalog available → catalog (the one real resource), never neither', () => {
    const result = routeAiContext({ message: 'Necesito ayuda con algo', hasCatalog: true, hasKnowledge: false })
    expect(result.decision).toBe('catalog')
  })

  it('an ambiguous message with only Knowledge available → knowledge (the one real resource), never neither', () => {
    const result = routeAiContext({ message: 'Necesito ayuda con algo', hasCatalog: false, hasKnowledge: true })
    expect(result.decision).toBe('knowledge')
  })
})

// ============================================================
// Genericity — the same module, unmodified, must work for any kind of
// business. None of these examples exist anywhere in routing.ts's own
// vocabulary lists (no brand/category nouns are hardcoded there) — the
// generic "qué X tienen/hay/manejan" pattern and the generic commerce/
// business-info words are what carry these, exactly as intended.
// ============================================================
describe('routeAiContext — genericity across business types', () => {
  it('hardware store: "¿qué tornillos manejan?" → catalog, via the generic category-question pattern', () => {
    expect(routeAiContext({ message: '¿Qué tornillos manejan?', ...BOTH }).decision).toBe('catalog')
  })

  it('restaurant: "¿qué platos tienen sin gluten?" → catalog', () => {
    expect(routeAiContext({ message: '¿Qué platos tienen sin gluten?', ...BOTH }).decision).toBe('catalog')
  })

  it('clothing store: "¿tienen tallas grandes?" → catalog (talla is generic attribute vocabulary)', () => {
    expect(routeAiContext({ message: '¿Tienen tallas grandes?', ...BOTH }).decision).toBe('catalog')
  })

  it('hair salon: "¿cuánto cuesta el corte?" → catalog (services priced like products)', () => {
    expect(routeAiContext({ message: '¿Cuánto cuesta el corte?', ...BOTH }).decision).toBe('catalog')
  })

  it('any business: "¿cuál es su dirección?" → knowledge', () => {
    expect(routeAiContext({ message: '¿Cuál es su dirección?', ...BOTH }).decision).toBe('knowledge')
  })

  it('any business: "¿hacen envíos a otras zonas?" → knowledge', () => {
    expect(routeAiContext({ message: '¿Hacen envíos a otras zonas?', ...BOTH }).decision).toBe('knowledge')
  })
})

describe('routeAiContext — normalization tolerance', () => {
  it('is accent/case-insensitive (matches SEARCH COVERAGE\'s own tolerant-input philosophy)', () => {
    expect(routeAiContext({ message: 'CUANTO CUESTA EL A56', ...BOTH }).decision).toBe('catalog')
    expect(routeAiContext({ message: 'cuánto cuesta el a56', ...BOTH }).decision).toBe('catalog')
  })

  it('ignores stray punctuation around a greeting', () => {
    expect(routeAiContext({ message: '¡¡Hola!!', ...BOTH }).decision).toBe('neither')
  })
})
