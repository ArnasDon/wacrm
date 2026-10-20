import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { executeCatalogTool } from './tools/catalog-tools'
import { catalogContextToPromptText, updateCatalogContext, type CatalogTurnContext } from './catalog/context'
import type { AiConfig } from './types'

// ============================================================
// AI Sales Agent audit, Part 24/27 — "pruebas de escenarios completos
// simulando conversaciones reales", not just isolated unit tests.
//
// This wires the REAL production pipeline end to end:
//   generateReply (real OpenAI-wire tool-calling loop, generate.ts)
//     → executeCatalogTool (real, catalog-tools.ts)
//       → resolver.searchCatalog/getProduct (real, catalog/resolver.ts)
//         → DataSourceCatalogProvider (real, providers/data-source-
//           provider.ts)
//   → updateCatalogContext / catalogContextToPromptText (real,
//     catalog/context.ts) threaded between turns exactly as
//     auto-reply.ts does.
//
// Only two things are faked, both deliberately at the system boundary:
//   1. The raw LLM HTTP response (`fetch`) — scripted to make the same
//      tool-call decisions a correctly-prompted real model would,
//      given the ACTUAL tool schema/system prompt this session wrote.
//      This is the one thing that cannot be exercised for real without
//      spending the account's own provider API budget against
//      production, which was not authorized this session.
//   2. Supabase itself — an in-memory `ai_data_sources`/
//      `ai_catalog_products` table plus a small stand-in for the
//      search_ai_catalog_products RPC (substring/token matching, not
//      real Postgres FTS — the RPC's own SQL is reviewed statically in
//      the migration and the tolerant fallback tier is separately unit
//      -tested in data-source-provider.test.ts).
// ============================================================

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

function config(): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: 'Tienda de electrónicos en Santo Domingo.',
    agentBehavior: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }
}

// ---- fake catalog: one active data source, a small realistic mix ----
const PRODUCTS = [
  row('p1', 'Samsung A07 128GB Negro', { brand: 'Samsung', capacity: '128GB', color: 'Negro', price: 9500 }),
  row('p2', 'Samsung A07 128GB Morado', { brand: 'Samsung', capacity: '128GB', color: 'Morado', price: 9500 }),
  row('p3', 'Samsung A07 64GB Negro', { brand: 'Samsung', capacity: '64GB', color: 'Negro', price: 7500 }),
  row('p4', 'Samsung A07 64GB Morado', { brand: 'Samsung', capacity: '64GB', color: 'Morado', price: 7500 }),
  row('p5', 'TV TCL GOOGLE TV SMART 50 4K ULTRA HD', { brand: 'TCL', price: 25000 }),
  row('p6', 'TV KOOLHOME 43 SMART', { brand: 'KOOLHOME', price: 14000 }),
  row('p7', 'TV SAMSUNG 50 QLED', { brand: 'Samsung', price: 31000 }),
  // price: null (not omitted — see row() default) on purpose: this is
  // the exact real-world shape that produced the "DOP 1" bug report
  // (AI agent audit, Oct 2026) — the product and its stock ARE known,
  // only the price is unconfirmed.
  row('p8', 'ABANICO DE PARED KGLG FS-B350 14"', { available_quantity: 11 }),
]

function row(id: string, name: string, over: Partial<Record<string, unknown>>) {
  return {
    id,
    source_product_id: id,
    sku: null,
    name,
    brand: null,
    model: null,
    description: null,
    color: null,
    variant_label: null,
    capacity: null,
    size: null,
    price: null,
    currency: 'DOP',
    available: true,
    available_quantity: 5,
    primary_image_url: null,
    images: [],
    ...over,
  }
}

function fakeDb(): SupabaseClient {
  const db = {
    from: (table: string) => {
      if (table === 'catalog_integrations') {
        // No Budun ERP integration configured for this fake account —
        // same shape resolver.ts's real caller (integrations.ts)
        // expects: .select().eq().eq().order().order() resolving to
        // an empty list.
        const api = {
          select: () => api,
          eq: () => api,
          order: () => api,
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        }
        return api
      }
      if (table === 'ai_data_sources') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'ds-1',
                        display_name: 'PRUEBA',
                        status: 'active',
                        usage: 'catalog',
                        priority: 100,
                        is_primary: false,
                        fallback_policy: 'fallback_on_not_found',
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      if (table === 'ai_catalog_products') {
        const filters: [string, unknown][] = []
        const api = {
          select: () => api,
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return api
          },
          maybeSingle: () => {
            const spid = filters.find(([c]) => c === 'source_product_id')?.[1]
            const match = PRODUCTS.find((p) => p.source_product_id === spid)
            return Promise.resolve({ data: match ?? null, error: null })
          },
          // data-source-provider.ts's fallback-scan tier chains
          // .order() before .limit() — missing it here used to throw a
          // synchronous TypeError, which (correctly, since the AI agent
          // audit fix) now surfaces as a real provider failure instead
          // of silently looking like "found nothing".
          order: () => api,
          limit: () => Promise.resolve({ data: PRODUCTS, error: null }),
        }
        return api
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      if (fn !== 'search_ai_catalog_products') throw new Error(`unexpected rpc ${fn}`)
      const query = String(params.p_query ?? '').toLowerCase().trim()
      // Lets a test simulate a genuine DB/RPC failure (distinct from a
      // real "zero matches") without touching any other scenario's
      // query — see the hadError / "errores del catálogo" scenario.
      if (query.includes('simular-error-db')) {
        return Promise.resolve({ data: null, error: { message: 'connection terminated unexpectedly' } })
      }
      const words = query.split(/\s+/).filter(Boolean)
      let matches = query
        ? PRODUCTS.filter((p) => words.some((w) => p.name.toLowerCase().includes(w)))
        : PRODUCTS.slice()
      if (params.p_available_only) matches = matches.filter((p) => p.available)
      const total = matches.length
      const offset = Number(params.p_offset ?? 0)
      const limit = Number(params.p_match_count ?? 10)
      const page = matches.slice(offset, offset + limit).map((p) => ({ ...p, total_count: total }))
      return Promise.resolve({ data: page, error: null })
    },
  }
  return db as unknown as SupabaseClient
}

/** One turn through the exact wiring auto-reply.ts uses: build the
 *  prompt (with whatever catalog context carried over from the
 *  previous turn), run the real tool-calling loop, then fold this
 *  turn's tool calls into a NEW context for the next turn. */
async function turn(args: {
  userMessage: string
  previousContext: CatalogTurnContext | null
  db: SupabaseClient
}) {
  const systemPrompt = buildSystemPrompt({
    userPrompt: config().systemPrompt,
    mode: 'auto_reply',
    catalogToolsAvailable: true,
    catalogContextText: catalogContextToPromptText(args.previousContext),
  })
  const result = await generateReply({
    config: config(),
    systemPrompt,
    messages: [{ role: 'user', content: args.userMessage }],
    tools: [
      { name: 'search_catalog', description: 'search', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_product', description: 'get', inputSchema: { type: 'object', properties: {} } },
    ],
    executeTool: executeCatalogTool(args.db, 'acct-1'),
  })
  const nextContext = updateCatalogContext(args.previousContext, result.toolCalls ?? [])
  return { ...result, nextContext }
}

afterEach(() => vi.unstubAllGlobals())

describe('Full pipeline — Scenario 1 (abridged): A07 negro de 64 → topic change → TV de 50 TCL', () => {
  it('turn 1: resolves the exact variant through a real tool call, never inventing the price', async () => {
    const fetchMock = vi
      .fn()
      // The model searches broadly first...
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"samsung a07 negro 64gb"}' } },
                ],
              },
            },
          ],
        }),
      )
      // ...then answers using ONLY what the tool returned.
      .mockResolvedValueOnce(
        okResponse({ choices: [{ message: { content: 'El Samsung A07 64GB Negro cuesta RD$7,500.' } }] }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const db = fakeDb()
    const { text, toolCalls, nextContext } = await turn({ userMessage: 'tienen el a07 negro de 64', previousContext: null, db })

    expect(text).toBe('El Samsung A07 64GB Negro cuesta RD$7,500.')
    // The tool genuinely ran against the fake catalog and found the
    // real row — the price in the reply is traceable to a real result,
    // not asserted independently of it.
    expect(toolCalls).toHaveLength(1)
    const toolProducts = (toolCalls[0].result as { products: { id: string; price: number }[] }).products
    expect(toolProducts.some((p) => p.id.endsWith(':p3') && p.price === 7500)).toBe(true)
    // Context now knows about the A07 family for a later "y el morado?".
    expect(nextContext.products.some((p) => p.id.endsWith(':p3'))).toBe(true)
  })

  it('turn 2: "ahora quiero una tv de 50" is treated as a topic change — searches fresh, does not reuse A07 context, TCL 50 found honestly', async () => {
    const turn1Context = updateCatalogContext(null, [
      { name: 'search_catalog', input: { query: 'samsung a07' }, result: { products: [{ id: 'ds_ds-1:p3', name: 'Samsung A07 64GB Negro', brand: 'Samsung', model: null, capacity: '64GB', size: null, price: 7500, currency: 'DOP' }] } },
    ])

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: 'c2', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"tv 50"}' } }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        okResponse({ choices: [{ message: { content: 'Tenemos la TV TCL 50" 4K por RD$25,000.' } }] }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const db = fakeDb()
    const { text, toolCalls, nextContext } = await turn({ userMessage: 'ahora quiero una tv de 50', previousContext: turn1Context, db })

    // The model searched for "tv 50" — NOT a variant of the A07 — and
    // the catalog context text it was given must have surfaced the
    // CAMBIO DE TEMA instruction that makes this the expected move.
    const promptSentToModel = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string
    expect(promptSentToModel.toLowerCase()).toContain('cambio de tema')
    expect(promptSentToModel).toContain('samsung a07') // old context still present, just labeled

    const searchCall = toolCalls.find((c) => c.name === 'search_catalog')!
    expect((searchCall.input as { query: string }).query).toBe('tv 50')
    const toolProducts = (searchCall.result as { products: { id: string; name: string }[] }).products
    expect(toolProducts.some((p) => p.name.includes('TCL'))).toBe(true)
    expect(text).toContain('25,000') // the real TCL price, not invented

    // The new context reflects the TV as the current topic, while the
    // old A07 group is still present (not destructively wiped).
    expect(nextContext.products[0].fromQuery).toBe('tv 50')
    expect(nextContext.products.some((p) => p.fromQuery === 'samsung a07')).toBe(true)
  })
})

describe('Full pipeline — no-omission: a broad "qué TVs tienen" surfaces every brand, with an honest has_more signal', () => {
  it('search_catalog result includes KOOLHOME, TCL, and Samsung together, and reports the real total', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      okResponse({
        choices: [
          { message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"tv","limit":20}' } }] } },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const db = fakeDb()
    const executeTool = executeCatalogTool(db, 'acct-1')
    // Drive the tool directly for this assertion (generateReply would
    // need a second scripted response we don't need for this check).
    const result = (await executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'tv', limit: 20 } })) as {
      products: { brand: string | null }[]
      total: number
      has_more: boolean
    }
    const brands = new Set(result.products.map((p) => p.brand))
    expect(brands.has('TCL')).toBe(true)
    expect(brands.has('KOOLHOME')).toBe(true)
    expect(brands.has('Samsung')).toBe(true)
    expect(result.total).toBe(3) // all 3 real TVs in the fake catalog
    expect(result.has_more).toBe(false) // limit(20) covered everything — honest, not a guess
  })
})

// ============================================================
// Playground/WhatsApp reliability audit (Oct 2026), Phase 6 — a search
// for several Samsung models that genuinely has MORE results than one
// page: the tool result itself must report `has_more: true` and the
// real `total`, never silently truncate and look complete. (The model's
// own compliance with SEARCH COVERAGE's wording is a prompt concern,
// already covered by defaults.test.ts; this proves the DATA the model
// would be reasoning from is honest.)
// ============================================================
describe('Full pipeline — several Samsung models, partial page: has_more/total stay honest, never silently truncated', () => {
  it('a 2-result page out of 5 real Samsung products reports has_more: true and the real total of 5', async () => {
    const db = fakeDb()
    const executeTool = executeCatalogTool(db, 'acct-1')
    const result = (await executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'samsung', limit: 2 } })) as {
      products: { name: string }[]
      total: number
      has_more: boolean
      returned: number
    }
    expect(result.products).toHaveLength(2)
    expect(result.total).toBe(5) // p1, p2, p3, p4, p7 — all 5 real Samsung products
    expect(result.has_more).toBe(true) // a 2-of-5 page is NEVER "las únicas opciones"
    expect(result.returned).toBe(2)
  })

  it('paginating with offset:2 after that first page reaches the remaining Samsung products instead of repeating or losing any', async () => {
    const db = fakeDb()
    const executeTool = executeCatalogTool(db, 'acct-1')
    const firstPage = (await executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'samsung', limit: 2 } })) as {
      products: { name: string }[]
    }
    const secondPage = (await executeTool({ id: 'c2', name: 'search_catalog', input: { query: 'samsung', limit: 2, offset: 2 } })) as {
      products: { name: string }[]
      has_more: boolean
    }
    const firstNames = new Set(firstPage.products.map((p) => p.name))
    const secondNames = new Set(secondPage.products.map((p) => p.name))
    // No overlap between pages — pagination advances, it doesn't repeat.
    for (const name of secondNames) expect(firstNames.has(name)).toBe(false)
    expect(secondPage.has_more).toBe(true) // still 1 more after this second page of 2 (5 total)
  })
})

// ============================================================
// Real conversation reported in the AI agent audit (Oct 2026):
//   "HOLA TIENE ABANICO DE PARED" → agent invents "DOP 1" for a
//   product whose real price was never confirmed → "VERIFICA EL
//   PRECIO" → agent flips to denying the product exists at all →
//   "SAMSUNG A16" → agent also denies ever having Samsung info.
//
// Root causes found and fixed elsewhere in this same change:
//   - inventory-parser.ts's parsePrice() mis-read a Spanish-locale
//     thousands separator as a decimal point ("1.200" → 1.2) — fixed,
//     covered by inventory-parser.test.ts's own regression tests.
//   - whitelist.ts's toToolResultProduct() now adds an explicit
//     `price_confirmed` boolean so a null price can't get "filled in"
//     by the model the way a bare JSON null can.
//
// This scenario proves the TOOL/DATA layer gives a correctly-prompted
// model everything it needs to answer honestly in both halves of the
// real conversation: existence+stock ARE confirmed when price isn't,
// and a genuinely different, unrelated product (Samsung A16, not in
// this catalog) is reported as not found WITHOUT that denial bleeding
// into unrelated later questions.
// ============================================================
describe('Full pipeline — the real "abanico de pared" bug report: null price never becomes a number, and a real not-found never poisons later turns', () => {
  it('turn 1: product found with confirmed stock, price explicitly flagged unconfirmed — the tool result makes a "DOP 1" hallucination avoidable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"abanico de pared"}' } },
                ],
              },
            },
          ],
        }),
      )
      // Scripted as the CORRECT behavior a well-instructed model should
      // produce given price_confirmed: false — never a fabricated number.
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content:
                  'Sí, tenemos el abanico de pared KGLG FS-B350 14" — 11 unidades disponibles. No tengo un precio confirmado para ese producto en este momento.',
              },
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const db = fakeDb()
    const { text, toolCalls, nextContext } = await turn({
      userMessage: 'HOLA TIENE ABANICO DE PARED',
      previousContext: null,
      db,
    })

    // The prompt actually sent to the model carries the new structural
    // rule, not just a hope that the model infers it.
    const promptSentToModel = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string
    expect(promptSentToModel).toContain('price_confirmed')

    // The real tool result: stock IS confirmed, price is explicitly NOT.
    const toolProducts = (toolCalls[0].result as {
      products: { id: string; price: number | null; price_confirmed: boolean; availableQuantity: number }[]
    }).products
    const abanico = toolProducts.find((p) => p.id.endsWith(':p8'))!
    expect(abanico.price).toBeNull()
    expect(abanico.price_confirmed).toBe(false)
    expect(abanico.availableQuantity).toBe(11)

    // The reply states the real stock and flags price as unconfirmed —
    // never a fabricated "DOP 1" or any other invented amount.
    expect(text).toContain('11 unidades')
    expect(text.toLowerCase()).toContain('no tengo un precio confirmado')
    expect(text).not.toMatch(/DOP\s*1\b/)
    expect(nextContext.products.some((p) => p.id.endsWith(':p8'))).toBe(true)
  })

  it('turn 2: a genuinely different, unrelated product (not in this catalog at all) is a real not-found — searched fresh, not confused with the abanico turn before it', async () => {
    const turn1Context = updateCatalogContext(null, [
      {
        name: 'search_catalog',
        input: { query: 'abanico de pared' },
        result: { products: [{ id: 'ds_ds-1:p8', name: 'ABANICO DE PARED KGLG FS-B350 14"', brand: null, model: null, capacity: null, size: null, price: null, currency: 'DOP' }] },
      },
    ])

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                // "nokia 3310" shares no word with anything in the fake
                // catalog (unlike "samsung a16", which would still match
                // every unrelated Samsung phone/TV on the word "samsung"
                // alone under this fake's lenient OR-based matching) —
                // isolates the "genuinely zero matches" case cleanly.
                tool_calls: [{ id: 'c2', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"nokia 3310"}' } }],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          choices: [{ message: { content: 'No encontré un Nokia 3310 en el catálogo. ¿Quieres que busque otro modelo?' } }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const db = fakeDb()
    const { text, toolCalls } = await turn({ userMessage: 'ENTONCES TIENE EL NOKIA 3310', previousContext: turn1Context, db })

    // A fresh search actually ran for THIS question — the model did not
    // just reuse/extend the abanico turn's result.
    const searchCall = toolCalls.find((c) => c.name === 'search_catalog')!
    expect((searchCall.input as { query: string }).query.toLowerCase()).toContain('nokia')
    const result = searchCall.result as { products: unknown[]; total: number | null }
    expect(result.products).toHaveLength(0) // genuinely not in this fake catalog
    expect(result.total).toBeFalsy() // 0 or null — the provider has no row to read a count from either way

    // An honest "not found" for THIS product — not a blanket denial
    // bleeding over from the unrelated abanico/price turn before it.
    expect(text.toLowerCase()).toContain('no encontré')
  })
})

// ============================================================
// AI agent audit (Oct 2026), Section 6 — "errores del catálogo" /
// Playground stability. A genuine DB/RPC failure during search_catalog
// must end the turn with a clean, visible, recoverable error — never
// silently converted into "no existe", and never a hang. This proves
// the whole real pipeline (generateReply → executeCatalogTool →
// resolver.searchCatalog → DataSourceCatalogProvider, the exact chain
// a real Playground POST runs) completes normally end to end even when
// the catalog query itself fails, which is what lets the ROUTE always
// return a clean HTTP response for the frontend's try/catch to handle
// — see ai-playground.tsx's send(), which already clears `sending` in
// a `finally` for exactly this reason.
// ============================================================
describe('Full pipeline — a genuine catalog query failure ends the turn cleanly, never a false "no existe" and never a hang', () => {
  it('search_catalog hitting a real DB/RPC error surfaces catalog_unavailable to the model, which answers honestly instead of denying the product', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"simular-error-db abanico"}' } }],
              },
            },
          ],
        }),
      )
      // Scripted as the correct behavior given {error: 'catalog_unavailable'}
      // — never "no lo tenemos", which would be indistinguishable from a
      // real not-found to the customer.
      .mockResolvedValueOnce(
        okResponse({
          choices: [{ message: { content: 'No pude verificar el catálogo en este momento. ¿Puedo intentarlo de nuevo en un momento o prefieres hablar con un agente?' } }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const db = fakeDb()
    // The real call completes and returns normally — no throw, no hang
    // — even though the underlying catalog query failed.
    const { text, toolCalls } = await turn({ userMessage: 'tiene abanico de pared', previousContext: null, db })

    const searchCall = toolCalls.find((c) => c.name === 'search_catalog')!
    expect(searchCall.result).toEqual({ error: 'catalog_unavailable' })
    expect(text.toLowerCase()).toContain('no pude verificar')
    expect(text.toLowerCase()).not.toContain('no tenemos')
    expect(text.toLowerCase()).not.toContain('no existe')
  })
})
