import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildSystemPromptBlocks } from './defaults'

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

// ============================================================
// buildSystemPromptBlocks — Anthropic-only prompt caching (AI
// optimization project, FASE 8). `buildSystemPrompt`'s plain-string
// output is the CANONICAL content — every scenario below verifies
// `buildSystemPromptBlocks` reflects EXACTLY that same content (nothing
// added, nothing removed, only regrouped by cacheability), and that
// nothing per-account/per-conversation ever lands in the cacheable
// (`stable`) half.
// ============================================================
describe('buildSystemPromptBlocks — content parity with buildSystemPrompt', () => {
  /** Reassembles the flat prompt buildSystemPrompt would produce from
   *  the stable/dynamic split, then compares the two as an
   *  order-independent multiset of '\n\n'-delimited fragments — proves
   *  "reordered, never altered" generically, without hardcoding which
   *  section landed on which side. */
  function sameContent(flat: string, blocks: { stable: string; dynamic: string }) {
    const reconstructed = blocks.dynamic ? `${blocks.stable}\n\n${blocks.dynamic}` : blocks.stable
    expect(reconstructed.split('\n\n').sort()).toEqual(flat.split('\n\n').sort())
  }

  const SCENARIOS: Array<[string, Parameters<typeof buildSystemPrompt>[0]]> = [
    ['minimal draft, nothing configured', { userPrompt: null, mode: 'draft' }],
    ['minimal auto_reply, nothing configured', { userPrompt: null, mode: 'auto_reply' }],
    [
      'catalog + knowledge + business profile + catalog context + userPrompt + timeContext, all at once',
      {
        userPrompt: 'Somos una ferretería en Santo Domingo.',
        mode: 'auto_reply',
        knowledge: ['[Horario] Lunes a viernes 9am-6pm.', '[Devoluciones] 30 días con recibo.'],
        timeContext: 'Current date and time: Monday, January 5, 2026, 3:45 PM (America/Santo_Domingo)',
        catalogToolsAvailable: true,
        catalogContextText: 'CATALOG CONTEXT — last product discussed: TCL 50" (ds_1:x).',
        businessProfileContext: 'BUSINESS PROFILE — fuente estructurada OFICIAL...\n\nNombre: Ferretería El Tornillo',
      },
    ],
    [
      'catalog only, no knowledge/business profile',
      { userPrompt: null, mode: 'auto_reply', catalogToolsAvailable: true },
    ],
    [
      'knowledge only, no catalog',
      { userPrompt: null, mode: 'draft', knowledge: ['[1] Some excerpt.'] },
    ],
    [
      'business profile only',
      { userPrompt: null, mode: 'auto_reply', businessProfileContext: 'BUSINESS PROFILE — ...\n\nNombre: X' },
    ],
  ]

  it.each(SCENARIOS)('%s — stable+dynamic reconstruct the exact same content as the flat prompt', (_label, args) => {
    const flat = buildSystemPrompt(args)
    const blocks = buildSystemPromptBlocks(args)
    sameContent(flat, blocks)
  })

  it('never drops a rule: every substring the flat-prompt tests above check for also survives in the stable half', () => {
    const args: Parameters<typeof buildSystemPrompt>[0] = { userPrompt: null, mode: 'auto_reply', catalogToolsAvailable: true }
    const { stable: stableText } = buildSystemPromptBlocks(args)
    for (const marker of [
      'SEARCH COVERAGE',
      'has_more',
      'GROUPING',
      'STOCK-AWARE BROWSING',
      'COMMERCIAL BEHAVIOR',
      'CATALOG TOOLS —',
      'EXTERNAL LIMIT REACHED',
      'ABSOLUTELY NEVER invent prices, stock, product names, availability',
      'Never state a price in a currency other than the one the tool returned',
    ]) {
      expect(stableText).toContain(marker)
    }
  })

  it('the stable half never contains retrieved Knowledge excerpts, catalog context, Business Profile data, the account\'s own business context, or the current time', () => {
    const args: Parameters<typeof buildSystemPrompt>[0] = {
      userPrompt: 'CONFIDENTIAL_USER_PROMPT_MARKER',
      mode: 'auto_reply',
      knowledge: ['CONFIDENTIAL_KNOWLEDGE_EXCERPT_MARKER'],
      timeContext: 'CONFIDENTIAL_TIME_MARKER',
      catalogToolsAvailable: true,
      catalogContextText: 'CONFIDENTIAL_CATALOG_CONTEXT_MARKER',
      businessProfileContext: 'CONFIDENTIAL_BUSINESS_PROFILE_DATA_MARKER',
    }
    const { stable: stableText, dynamic: dynamicText } = buildSystemPromptBlocks(args)
    for (const marker of [
      'CONFIDENTIAL_USER_PROMPT_MARKER',
      'CONFIDENTIAL_KNOWLEDGE_EXCERPT_MARKER',
      'CONFIDENTIAL_TIME_MARKER',
      'CONFIDENTIAL_CATALOG_CONTEXT_MARKER',
      'CONFIDENTIAL_BUSINESS_PROFILE_DATA_MARKER',
    ]) {
      expect(stableText).not.toContain(marker)
      expect(dynamicText).toContain(marker)
    }
    // The RULE sections themselves are exactly the opposite — present
    // in stable, absent from dynamic.
    for (const marker of ['CATALOG TOOLS —', 'KNOWLEDGE BASE —', 'BUSINESS PROFILE RULES —']) {
      expect(stableText).toContain(marker)
      expect(dynamicText).not.toContain(marker)
    }
  })

  it('stable is never empty (the base guidelines are always present); dynamic is empty only when nothing dynamic was supplied', () => {
    const { stable: stableText, dynamic: dynamicText } = buildSystemPromptBlocks({ userPrompt: null, mode: 'draft' })
    expect(stableText.length).toBeGreaterThan(0)
    expect(dynamicText).toBe('')
  })
})
