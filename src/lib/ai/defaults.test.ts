import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './defaults'

// ============================================================
// AI Sales Agent audit — the commercial/coverage rules added to the
// system prompt (Parts 3-6, 9-13, 16, 20-21). Previously untested
// directly; buildSystemPrompt only had indirect coverage via other
// modules' tests.
// ============================================================

describe('buildSystemPrompt — catalog accounts get the new commercial/coverage guidance', () => {
  const base = { userPrompt: null, mode: 'auto_reply' as const }

  it('includes SEARCH COVERAGE guidance (no-omission, has_more, exploratory vs exhaustive) only when catalog tools are available', () => {
    const withCatalog = buildSystemPrompt({ ...base, catalogToolsAvailable: true })
    expect(withCatalog).toContain('SEARCH COVERAGE')
    expect(withCatalog).toContain('has_more')
    expect(withCatalog.toLowerCase()).toContain('never say "these are all we have"')

    const withoutCatalog = buildSystemPrompt({ ...base, catalogToolsAvailable: false })
    expect(withoutCatalog).not.toContain('SEARCH COVERAGE')
    expect(withoutCatalog).not.toContain('has_more')
  })

  it('instructs a bare brand/attribute follow-up ("y Samsung", "y de otra marca") to continue the current category, not start an unrelated search', () => {
    const prompt = buildSystemPrompt({ ...base, catalogToolsAvailable: true })
    expect(prompt).toContain('CONTINUING VS CHANGING TOPIC')
    expect(prompt.toLowerCase()).toContain('"y de otra marca"')
  })

  it('includes GROUPING guidance that explicitly forbids inventing attributes', () => {
    const prompt = buildSystemPrompt({ ...base, catalogToolsAvailable: true })
    expect(prompt).toContain('GROUPING')
    expect(prompt.toLowerCase()).toContain('never state an attribute, feature, or spec that is not literally')
  })

  it('includes STOCK-AWARE BROWSING guidance distinguishing browsing from a specific lookup', () => {
    const prompt = buildSystemPrompt({ ...base, catalogToolsAvailable: true })
    expect(prompt).toContain('STOCK-AWARE BROWSING')
    expect(prompt).toContain('available_only')
    // The critical non-omission safeguard: a specific lookup must never
    // filter out an agotado item.
    expect(prompt.toLowerCase()).toContain('do not set `available_only`')
  })

  it('includes COMMERCIAL BEHAVIOR guidance: ambiguity handling, agotado alternatives, no invented "bueno"', () => {
    const prompt = buildSystemPrompt({ ...base, catalogToolsAvailable: true })
    expect(prompt).toContain('COMMERCIAL BEHAVIOR')
    expect(prompt.toLowerCase()).toContain('do not invent your own definition of "bueno"')
    expect(prompt.toLowerCase()).toContain('never invent a substitute that was not in the results')
  })

  it('does not add ANY of the new sections for an account with no catalog tools — byte-for-byte parity preserved', () => {
    const prompt = buildSystemPrompt({ ...base, catalogToolsAvailable: false })
    for (const marker of ['SEARCH COVERAGE', 'GROUPING —', 'STOCK-AWARE BROWSING', 'COMMERCIAL BEHAVIOR', 'CATALOG TOOLS —']) {
      expect(prompt).not.toContain(marker)
    }
  })

  it('preserves the pre-existing anti-invention and currency-fidelity rules unchanged', () => {
    const prompt = buildSystemPrompt({ ...base, catalogToolsAvailable: true })
    expect(prompt).toContain('ABSOLUTELY NEVER invent prices, stock, product names, availability')
    expect(prompt).toContain('Never state a price in a currency other than the one the tool returned')
  })

  it('omitting catalogToolsAvailable entirely still yields the pre-feature prompt (default false)', () => {
    const prompt = buildSystemPrompt(base)
    expect(prompt).not.toContain('CATALOG TOOLS')
    expect(prompt).not.toContain('SEARCH COVERAGE')
  })
})
