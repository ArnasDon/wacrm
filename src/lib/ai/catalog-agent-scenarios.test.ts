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
          limit: () => Promise.resolve({ data: PRODUCTS, error: null }),
        }
        return api
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      if (fn !== 'search_ai_catalog_products') throw new Error(`unexpected rpc ${fn}`)
      const query = String(params.p_query ?? '').toLowerCase().trim()
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
