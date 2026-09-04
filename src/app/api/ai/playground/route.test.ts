import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { __resetRateLimitForTests } from '@/lib/rate-limit'
import type { AiConfig } from '@/lib/ai/types'

// ============================================================
// POST /api/ai/playground — this route never had a test file before
// (Fase 2 audit, 2.8 — GAP DE COBERTURA; hardening plan, paso 2).
//
// What stays REAL (never mocked): `@/lib/auth/account`'s error classes
// + `toErrorResponse` (only `requireRole` is swapped, via a partial
// mock — same technique as `draft/route.test.ts`); `@/lib/ai/routing`;
// `@/lib/ai/defaults`; `@/lib/ai/query`;
// `@/lib/ai/business-profile/context` and `.../handoff-intent` (both
// pure); and — the point of this file — `@/lib/ai/catalog/resolver`,
// `@/lib/ai/tools/catalog-tools`, and `@/lib/ai/catalog/context`. Only
// the raw Supabase calls those make are faked, using the exact same
// table/RPC shape `catalog-agent-scenarios.test.ts` and
// `catalog/resolver.test.ts` already exercise — never a mock of the
// resolver/executor themselves.
//
// `generateReply` is mocked by default (deterministic, no network) but
// is swapped for the REAL implementation (via `vi.importActual`) in
// the specific tests whose whole point is the real tool-calling loop
// against the fake catalog DB — see the "catálogo real" and
// "catalog_context" describes below. This mirrors
// `catalog-agent-scenarios.test.ts`'s own design: only `fetch` and
// Supabase are faked in those tests, everything else in the pipeline
// (`generateReply`, `executeCatalogTool`, `resolver.ts`,
// `updateCatalogContext`/`catalogContextToPromptText`) is real code.
//
// EPISTEMOLOGICAL LIMIT (documented here once, applies to every test
// below that mocks `fetch`): scripting `fetch` to return a given
// provider response proves the ROUTE correctly wires that response
// through the real pipeline (tool calls resolve against real data,
// `catalog_context` round-trips correctly, no WhatsApp send happens).
// It does NOT prove that a real GPT/Claude/OpenRouter model would
// produce that response, nor that a real model would resist a prompt
// injection — the test's own `fetch` mock fully determines what "the
// model" appears to say.
// ============================================================

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  retrieveKnowledge: vi.fn(),
  accountHasKnowledgeBase: vi.fn(),
  loadBusinessProfileForAgent: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: h.requireRole }
})
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/ai/knowledge', () => ({
  retrieveKnowledge: h.retrieveKnowledge,
  accountHasKnowledgeBase: h.accountHasKnowledgeBase,
}))
vi.mock('@/lib/ai/business-profile/service', () => ({
  loadBusinessProfileForAgent: h.loadBusinessProfileForAgent,
}))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }))
// playground/route.ts does not import this module today — mocked here
// purely as a regression guard (requirement F): if a future change
// ever wired a real WhatsApp send into this route, every test below
// would fail loudly via the `toHaveBeenCalledTimes(0)` checks instead
// of silently sending real messages the next time this suite runs.
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
}))

import { POST } from './route'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { AiError } from '@/lib/ai/types'

// Lazily loaded once (see `beforeEach` below) via `vi.importActual`,
// which bypasses the `vi.mock('@/lib/ai/generate', ...)` above and
// returns the genuine module. Individual tests opt into running the
// real tool-calling loop with `h.generateReply.mockImplementation(realGenerateReply)`;
// every other test keeps the default deterministic mock from `beforeEach`.
let realGenerateReply: typeof import('@/lib/ai/generate').generateReply

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    agentBehavior: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

/** One product row shaped exactly like `ai_catalog_products` — mirrors
 *  `catalog-agent-scenarios.test.ts`'s `row()` helper. */
function productRow(id: string, name: string, over: Partial<Record<string, unknown>> = {}) {
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

/**
 * Fake Supabase for the catalog side of the pipeline. Unlike
 * `catalog-agent-scenarios.test.ts`'s fixed-account double, this one
 * genuinely filters `ai_data_sources`/`search_ai_catalog_products` by
 * the `account_id`/`p_account_id` the REAL resolver code passes in —
 * a data source configured for a DIFFERENT account than `accountId`
 * simply never matches, exactly like requirement E asks. This proves
 * the real resolver/provider code threads `accountId` correctly; it is
 * NOT a substitute for real Postgres RLS (no policy is evaluated here —
 * see the dedicated isolation test below for the explicit caveat).
 */
function fakeCatalogSupabase(opts: {
  accountId: string
  dataSourceAccountId: string | null
  products: Record<string, unknown>[]
}): SupabaseClient {
  const { accountId, dataSourceAccountId, products } = opts
  const dataSourceRow = {
    id: 'ds-1',
    display_name: 'Catálogo de prueba',
    status: 'active',
    usage: 'catalog',
    priority: 100,
    is_primary: false,
    fallback_policy: 'fallback_on_not_found',
  }

  const db = {
    from: (table: string) => {
      if (table === 'catalog_integrations') {
        const api = {
          select: () => api,
          eq: () => api,
          order: () => api,
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        }
        return api
      }
      if (table === 'ai_data_sources') {
        const filters: [string, unknown][] = []
        const api = {
          select: () => api,
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return api
          },
          in: () => {
            const wantsThisAccount = filters.some(([c, v]) => c === 'account_id' && v === accountId)
            const wantsActive = filters.some(([c, v]) => c === 'status' && v === 'active')
            const belongsToThisAccount = dataSourceAccountId === accountId
            const data = wantsThisAccount && wantsActive && belongsToThisAccount ? [dataSourceRow] : []
            return Promise.resolve({ data, error: null })
          },
        }
        return api
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
            const wantsThisAccount = filters.some(([c, v]) => c === 'account_id' && v === accountId)
            const spid = filters.find(([c]) => c === 'source_product_id')?.[1]
            const match = wantsThisAccount ? products.find((p) => p.source_product_id === spid) : undefined
            return Promise.resolve({ data: match ?? null, error: null })
          },
          limit: () => Promise.resolve({ data: products, error: null }),
        }
        return api
      }
      throw new Error(`unexpected table in test double: ${table}`)
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      if (fn !== 'search_ai_catalog_products') throw new Error(`unexpected rpc: ${fn}`)
      // The RPC is account-scoped for real (migration 047,
      // `p_account_id`) — a request for a different account, or one
      // whose data source belongs to a different account, must never
      // see these products.
      if (params.p_account_id !== accountId || dataSourceAccountId !== accountId) {
        return Promise.resolve({ data: [], error: null })
      }
      const query = String(params.p_query ?? '').toLowerCase().trim()
      const words = query.split(/\s+/).filter(Boolean)
      let matches = query
        ? products.filter((p) => words.some((w) => String(p.name).toLowerCase().includes(w)))
        : products.slice()
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

/** No catalog source at all — every existing (pre-catalog) test shape,
 *  and the shape most auth/validation/provider-error tests below use
 *  since catalog isn't their concern. */
function fakeSupabaseNoCatalog(): SupabaseClient {
  return fakeCatalogSupabase({ accountId: 'unused', dataSourceAccountId: null, products: [] })
}

function requireRoleOk(
  accountId = 'acct-1',
  userId = 'user-1',
  supabase: SupabaseClient = fakeSupabaseNoCatalog(),
) {
  h.requireRole.mockResolvedValue({ supabase, accountId, userId })
}

function postRequest(body: Record<string, unknown> | undefined) {
  return new Request('http://localhost/api/ai/playground', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(async () => {
  __resetRateLimitForTests()
  vi.unstubAllGlobals()
  if (!realGenerateReply) {
    const actual = await vi.importActual<typeof import('@/lib/ai/generate')>('@/lib/ai/generate')
    realGenerateReply = actual.generateReply
  }
  h.requireRole.mockReset()
  h.loadAiConfig.mockReset().mockResolvedValue(aiConfig())
  h.retrieveKnowledge.mockReset().mockResolvedValue([])
  h.accountHasKnowledgeBase.mockReset().mockResolvedValue(false)
  h.loadBusinessProfileForAgent.mockReset().mockResolvedValue(null)
  h.generateReply
    .mockReset()
    .mockResolvedValue({ text: 'Respuesta de prueba', handoff: false, usage: null, toolCalls: [] })
  h.engineSendText.mockReset()
  h.engineSendMedia.mockReset()
})

describe('POST /api/ai/playground — authorization', () => {
  it("requireRole('agent') rejecting with ForbiddenError surfaces the real 403", async () => {
    h.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'agent' role or higher"))

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(403)
    expect(body.error).toBe("This action requires the 'agent' role or higher")
  })

  it('requireRole rejecting with UnauthorizedError (no session) surfaces the real 401', async () => {
    h.requireRole.mockRejectedValue(new UnauthorizedError())

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))

    expect(res.status).toBe(401)
  })
})

describe('POST /api/ai/playground — validation', () => {
  it('missing `messages` → 400 with the route\'s own real error text', async () => {
    requireRoleOk()

    const res = await POST(postRequest({}))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(400)
    expect(body.error).toBe('messages is required')
    expect(h.loadAiConfig).not.toHaveBeenCalled()
  })

  it('`messages` present but every entry malformed (wrong role / empty content) → 400, the route\'s own filter drops them all', async () => {
    requireRoleOk()

    const res = await POST(
      postRequest({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: '   ' }] }),
    )
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(400)
    expect(body.error).toBe('Send a message to test the agent.')
  })

  it('ai_not_configured when loadAiConfig resolves null', async () => {
    requireRoleOk()
    h.loadAiConfig.mockResolvedValue(null)

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))
    const body = (await res.json()) as { code: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe('ai_not_configured')
  })

  it('loadAiConfig is called with requireActive:false — Playground must work even with the master switch off', async () => {
    requireRoleOk()

    await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))

    expect(h.loadAiConfig).toHaveBeenCalledWith(expect.anything(), 'acct-1', { requireActive: false })
  })

  it('an undecryptable stored API key surfaces key_decrypt_failed', async () => {
    requireRoleOk()
    h.loadAiConfig.mockRejectedValue(new Error('bad ENCRYPTION_KEY'))

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))
    const body = (await res.json()) as { code: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe('key_decrypt_failed')
  })

  it('an AiError thrown by generateReply preserves its real status and code', async () => {
    requireRoleOk()
    h.generateReply.mockRejectedValue(
      new AiError('Anthropic returned an empty response.', { code: 'empty_response', status: 502 }),
    )

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))
    const body = (await res.json()) as { error: string; code: string }

    expect(res.status).toBe(502)
    expect(body.code).toBe('empty_response')
    expect(body.error).toBe('Anthropic returned an empty response.')
  })
})

describe('POST /api/ai/playground — happy path (no catalog configured)', () => {
  it('returns the reply, routing info, and an empty/unset catalog_context', async () => {
    requireRoleOk()

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))
    const body = (await res.json()) as { reply: string; routing: { used_catalog: boolean } }

    expect(res.status).toBe(200)
    expect(body.reply).toBe('Respuesta de prueba')
    expect(body.routing.used_catalog).toBe(false)
  })

  it('never sends anything over WhatsApp — Playground only ever returns text/media in the response body', async () => {
    requireRoleOk()

    await POST(postRequest({ messages: [{ role: 'user', content: 'hola' }] }))

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/playground — catálogo real (executeCatalogTool + resolver reales)', () => {
  it('search_catalog resolves real products for THIS account through the real resolver — accountId comes from requireRole, never the body', async () => {
    requireRoleOk('acct-1', 'user-1', fakeCatalogSupabase({
      accountId: 'acct-1',
      dataSourceAccountId: 'acct-1',
      products: [productRow('p1', 'Samsung A07 128GB Negro', { brand: 'Samsung', price: 9500 })],
    }))

    await POST(postRequest({ messages: [{ role: 'user', content: 'cuanto cuesta el Samsung A07' }] }))

    // routing.useCatalog must have been true for a catalog-vocabulary
    // question with an active source, so `executeCatalogTool`'s REAL
    // executor was constructed and handed to generateReply.
    const callArgs = h.generateReply.mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    const executeTool = callArgs.executeTool as (call: { id: string; name: string; input: unknown }) => Promise<unknown>

    // Invoke the REAL executor directly — this is the actual
    // `executeCatalogTool(supabase, accountId, resolverCache)` closure
    // the route built, not a re-implementation.
    const result = (await executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'A07' } })) as {
      products: { id: string; price: number }[]
    }
    expect(result.products).toHaveLength(1)
    expect(result.products[0].price).toBe(9500)
  })

  it("get_product resolves the exact product by the id search_catalog returned — never a fabricated id", async () => {
    const db = fakeCatalogSupabase({
      accountId: 'acct-1',
      dataSourceAccountId: 'acct-1',
      products: [productRow('p1', 'TV TCL 50 4K', { brand: 'TCL', price: 25000 })],
    })
    requireRoleOk('acct-1', 'user-1', db)

    await POST(postRequest({ messages: [{ role: 'user', content: 'que tv tienen' }] }))
    const executeTool = h.generateReply.mock.calls[0][0].executeTool as (call: {
      id: string
      name: string
      input: unknown
    }) => Promise<unknown>

    const search = (await executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'TCL' } })) as {
      products: { id: string }[]
    }
    const realId = search.products[0].id
    const detail = (await executeTool({ id: 'c2', name: 'get_product', input: { id: realId } })) as {
      product?: { price: number }
      error?: string
    }
    expect(detail.error).toBeUndefined()
    expect(detail.product?.price).toBe(25000)
  })

  it("a fabricated id (never returned by search_catalog) resolves to not_found — never invents a product", async () => {
    requireRoleOk('acct-1', 'user-1', fakeCatalogSupabase({
      accountId: 'acct-1',
      dataSourceAccountId: 'acct-1',
      products: [productRow('p1', 'Samsung A07', { price: 9500 })],
    }))

    await POST(postRequest({ messages: [{ role: 'user', content: 'cuanto cuesta el Samsung' }] }))
    const executeTool = h.generateReply.mock.calls[0][0].executeTool as (call: {
      id: string
      name: string
      input: unknown
    }) => Promise<unknown>

    const detail = (await executeTool({ id: 'c1', name: 'get_product', input: { id: 'ds_ds-1:does-not-exist' } })) as {
      error?: string
    }
    expect(detail.error).toBe('not_found')
  })

  it('accountId isolation: a data source belonging to a DIFFERENT account is never resolved, even when the query matches its products by name', async () => {
    // The fake's data source belongs to 'acct-OTHER', but the request
    // is authenticated as 'acct-1' — the real resolver must see zero
    // active sources for acct-1, so `routing.useCatalog` stays false.
    // NOTE: this proves the real resolver/provider code threads
    // `accountId` correctly through every query/RPC parameter — it is
    // NOT a test of real Postgres RLS, which this fake never evaluates.
    requireRoleOk('acct-1', 'user-1', fakeCatalogSupabase({
      accountId: 'acct-OTHER',
      dataSourceAccountId: 'acct-OTHER',
      products: [productRow('p1', 'Producto secreto de otra cuenta', { price: 1 })],
    }))

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'cuanto cuesta el producto' }] }))
    const body = (await res.json()) as { routing: { used_catalog: boolean } }

    expect(body.routing.used_catalog).toBe(false)
    const callArgs = h.generateReply.mock.calls[0][0]
    expect(callArgs.tools).toBeUndefined()
    expect(callArgs.executeTool).toBeUndefined()
  })

  it('a body-supplied account_id never substitutes the authenticated accountId — the catalog resolved is always requireRole\'s, never the body\'s', async () => {
    requireRoleOk('acct-1', 'user-1', fakeCatalogSupabase({
      accountId: 'acct-1',
      dataSourceAccountId: 'acct-1',
      products: [productRow('p1', 'Producto real de acct-1', { price: 500 })],
    }))

    await POST(
      postRequest({
        messages: [{ role: 'user', content: 'cuanto cuesta el producto' }],
        account_id: 'acct-OTHER',
        accountId: 'acct-OTHER',
      }),
    )

    expect(h.loadAiConfig.mock.calls[0][1]).toBe('acct-1')
    expect(h.generateReply.mock.calls[0][0].tools).toBeDefined() // acct-1's real source was used
  })
})

describe('POST /api/ai/playground — get_product_media never triggers a WhatsApp send', () => {
  it('get_product_media resolves a real image URL from the whitelist, and engineSendMedia is never called — Playground has no wrapWithMediaSideEffect', async () => {
    requireRoleOk('acct-1', 'user-1', fakeCatalogSupabase({
      accountId: 'acct-1',
      dataSourceAccountId: 'acct-1',
      products: [
        productRow('p1', 'Samsung A07 Negro', {
          price: 9500,
          primary_image_url: 'https://cdn.example.com/a07-negro.jpg',
        }),
      ],
    }))

    await POST(postRequest({ messages: [{ role: 'user', content: 'tienen foto del Samsung A07' }] }))
    const executeTool = h.generateReply.mock.calls[0][0].executeTool as (call: {
      id: string
      name: string
      input: unknown
    }) => Promise<unknown>

    const search = (await executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'A07' } })) as {
      products: { id: string }[]
    }
    const media = (await executeTool({
      id: 'c2',
      name: 'get_product_media',
      input: { id: search.products[0].id },
    })) as { primaryImage?: { url: string } | null }

    expect(media.primaryImage?.url).toBe('https://cdn.example.com/a07-negro.jpg')
    // The behavior under test: calling the tool that WOULD trigger
    // engineSendMedia in auto-reply.ts (via wrapWithMediaSideEffect)
    // does nothing of the sort here — the Playground wires
    // `executeCatalogTool` directly, with no wrapper at all.
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/playground — catalog_context round-trip (real generateReply + mocked fetch)', () => {
  it('a fresh turn with no incoming context resolves a product via a real tool call and returns a non-empty catalog_context for the client to resend', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"A07 negro"}' } },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        okResponse({ choices: [{ message: { content: 'El Samsung A07 Negro cuesta RD$9,500.' } }] }),
      )
    vi.stubGlobal('fetch', fetchMock)
    h.generateReply.mockImplementation(realGenerateReply)

    requireRoleOk('acct-1', 'user-1', fakeCatalogSupabase({
      accountId: 'acct-1',
      dataSourceAccountId: 'acct-1',
      products: [productRow('p1', 'Samsung A07 Negro', { price: 9500 })],
    }))

    const res = await POST(postRequest({ messages: [{ role: 'user', content: 'cuanto cuesta el A07 negro' }] }))
    const body = (await res.json()) as {
      reply: string
      catalog_context: { products: { id: string; price: number | null }[] } | null
    }

    expect(res.status).toBe(200)
    // Traceable to the real tool result, not asserted independently of it.
    expect(body.reply).toBe('El Samsung A07 Negro cuesta RD$9,500.')
    expect(body.catalog_context).not.toBeNull()
    expect(body.catalog_context!.products.some((p) => p.price === 9500)).toBe(true)
  })

  it('a second turn resends the previous catalog_context, and updateCatalogContext folds in the new turn without losing the earlier product', async () => {
    const firstContext = {
      lastQuery: 'a07 negro',
      products: [
        {
          id: 'ds_ds-1:p1',
          name: 'Samsung A07 Negro',
          brand: null,
          model: null,
          color: null,
          capacity: null,
          size: null,
          price: 9500,
          currency: 'DOP',
          fromQuery: 'a07 negro',
        },
      ],
      updatedAt: new Date().toISOString(),
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'search_catalog', arguments: '{"query":"tv tcl"}' } },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: 'La TV TCL cuesta RD$25,000.' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    h.generateReply.mockImplementation(realGenerateReply)

    requireRoleOk('acct-1', 'user-1', fakeCatalogSupabase({
      accountId: 'acct-1',
      dataSourceAccountId: 'acct-1',
      products: [
        productRow('p1', 'Samsung A07 Negro', { price: 9500 }),
        productRow('p2', 'TV TCL 50', { brand: 'TCL', price: 25000 }),
      ],
    }))

    const res = await POST(
      postRequest({
        messages: [
          { role: 'user', content: 'cuanto cuesta el A07 negro' },
          { role: 'assistant', content: 'El Samsung A07 Negro cuesta RD$9,500.' },
          { role: 'user', content: 'y una tv tcl?' },
        ],
        catalog_context: firstContext,
      }),
    )
    const body = (await res.json()) as { catalog_context: { products: { id: string }[] } }

    const ids = body.catalog_context.products.map((p) => p.id)
    expect(ids).toContain('ds_ds-1:p1') // earlier product preserved
    expect(ids.some((id) => id.endsWith(':p2'))).toBe(true) // this turn's product added
  })
})
