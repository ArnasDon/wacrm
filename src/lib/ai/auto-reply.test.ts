import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { executeCatalogTool } from './tools/catalog-tools'
import { updateCatalogContext, type CatalogTurnContext } from './catalog/context'
import { supabaseAdmin } from './admin-client'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  latestCustomerMessageId: vi.fn(),
  retrieveKnowledge: vi.fn(),
  accountHasKnowledgeBase: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    // Rows resolveCatalogProviders() would find for ai_data_sources —
    // empty by default (no active catalog source, matching every test
    // written before catalog tools existed); routing tests below set
    // this to a real active row to make hasActiveCatalogSources() true.
    dataSources: [] as Record<string, unknown>[],
    // F2 — when true, the conversations.update().eq(...) call inside
    // handOffToHuman() rejects, simulating the pending/handoff fallback
    // itself failing (e.g. DB unreachable) on top of a provider failure.
    failHandoffUpdate: false as boolean,
    // Business Profile (FASE 6) — unconfigured by default; individual
    // tests set these to exercise buildBusinessProfileContext()/
    // detectHandoffIntent() against real-shaped rows.
    businessProfileRow: null as Record<string, unknown> | null,
    departments: [] as Record<string, unknown>[],
    contacts: [] as Record<string, unknown>[],
    // Internal catalog rows (FASE 11) — what search_ai_catalog_products
    // would return for the account's DataSourceCatalogProvider. Empty by
    // default; the FASE 11 integration test below sets this to exercise
    // the REAL executeCatalogTool → resolver → DataSourceCatalogProvider
    // → facets chain (never mocked out), unlike every other test in this
    // file which only checks that tools/executeTool were ATTACHED.
    catalogProductRows: [] as Record<string, unknown>[],
    // H-6 — the AI-processing claim's own events (acquire/release/
    // release_or_continue), tracked SEPARATELY from `rpcCalls` (which
    // every pre-H-6 test asserts on exactly, for claim_ai_reply_slot/
    // search_ai_catalog_products only) so none of those assertions need
    // to change for a mechanism they were never testing.
    aiProcessingEvents: [] as string[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({
  buildConversationContext: h.buildConversationContext,
  // H-6 — the drain loop's "marker" query. A fixed, distinct value is
  // enough for every pre-H-6 test: they never inspect it, and the fake
  // conversations.update()/rpc() handlers below don't need it to match
  // anything real to correctly model "nothing newer arrived" (the
  // default every one of those tests implicitly relies on).
  latestCustomerMessageId: h.latestCustomerMessageId,
}))
vi.mock('./knowledge', () => ({
  retrieveKnowledge: h.retrieveKnowledge,
  accountHasKnowledgeBase: h.accountHasKnowledgeBase,
}))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
}))
// Generic chainable query-builder double: every method returns itself
// so an arbitrary .select().eq().eq().order().order() (or .in(), etc.)
// call sequence type-checks, and the object is thenable so `await`-ing
// it at any point in the chain resolves to `{data, error: null}`.
// Used for tables the catalog resolver touches (catalog_integrations /
// ai_data_sources) — defaulting to an empty result keeps every existing
// test's behavior identical to before those tables existed (no active
// catalog source → hasActiveCatalogSources() is false → no tools
// attached → generateReply is called exactly as these tests expect).
function chainable(data: unknown) {
  // maybeSingle()/single() resolve to the first row of `data` (or `data`
  // itself when it isn't an array) — the resolver paths that use this
  // helper never call either, but Business Profile's getBusinessProfile
  // (a single row via .maybeSingle()) does, so this needs to reflect
  // whatever the test actually configured rather than always null.
  const singleRow = Array.isArray(data) ? (data[0] ?? null) : data
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: () => Promise.resolve({ data: singleRow, error: null }),
    single: () => Promise.resolve({ data: singleRow, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data, error: null }),
  }
  return obj
}

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'catalog_integrations') {
        return chainable([])
      }
      if (table === 'ai_data_sources') {
        return chainable(h.state.dataSources)
      }
      // Business Profile (FASE 6) — unconfigured by default (empty
      // departments/contacts, no profile row) so every pre-existing test
      // sees byte-for-byte the same behavior as before this feature
      // existed. Tests that care about Business Profile/handoff-intent
      // override these via h.state.businessProfile*/Contacts.
      if (table === 'account_business_profiles') {
        return chainable(h.state.businessProfileRow ? [h.state.businessProfileRow] : [])
      }
      if (table === 'account_business_departments') {
        return chainable(h.state.departments)
      }
      if (table === 'account_business_contacts') {
        return chainable(h.state.contacts)
      }
      // conversations. `.select().eq().maybeSingle()` always echoes the
      // single, mutable h.state.conv — every existing test only exercises
      // ONE dispatch pass, so re-reading it fresh (as processOneTurn's
      // H-6 restructuring now does) is behaviorally identical to the old
      // single upfront read for all of them.
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          // H-6 — the claim acquire (`{ai_processing_started_at: <iso>}`
          // + `.or(...)`) and the unconditional safety-net release
          // (`{ai_processing_started_at: null}`, no `.or()`) both land
          // here. Modeled as a real conditional UPDATE against the
          // single mutable h.state.conv, exactly mirroring what
          // PostgREST does against a real row — tracked into
          // aiProcessingEvents, NEVER into updatePayload (which every
          // pre-H-6 test asserts holds exactly the handoff/catalog-
          // context payload).
          const isAiProcessingClaim =
            Object.keys(payload).length === 1 && 'ai_processing_started_at' in payload
          if (isAiProcessingClaim) {
            let orExpr: string | null = null
            const api = {
              eq: () => api,
              or: (expr: string) => {
                orExpr = expr
                return api
              },
              select: () => api,
              maybeSingle: () => Promise.resolve(evaluateClaim(true)),
              then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
                Promise.resolve(evaluateClaim(false)).then(resolve, reject),
            }
            function evaluateClaim(single: boolean) {
              const current = (h.state.conv?.ai_processing_started_at as string | null | undefined) ?? null
              const matches =
                !orExpr ||
                orExpr.split(',').some((clause) => {
                  const [col, op, val] = clause.split('.')
                  if (col !== 'ai_processing_started_at') return false
                  if (op === 'is') return val === 'null' ? current === null : String(current) === val
                  if (op === 'lt') return typeof current === 'string' && current < val
                  return false
                })
              if (!matches) return { data: null, error: null }
              if (h.state.conv) Object.assign(h.state.conv, payload)
              h.state.aiProcessingEvents.push(
                payload.ai_processing_started_at === null ? 'release' : 'claim',
              )
              const row = { id: 'conv-1' }
              return { data: single ? row : [row], error: null }
            }
            return api
          }

          // Every other conversations.update() call (handoff, ai_catalog_
          // context) — unchanged behavior.
          h.state.updatePayload = payload
          if (h.state.conv) Object.assign(h.state.conv, payload)
          return {
            eq: () =>
              h.state.failHandoffUpdate
                ? Promise.reject(new Error('conversations update failed (simulated)'))
                : Promise.resolve({ error: null }),
          }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      // H-6 — release_or_continue_ai_processing is tracked in
      // aiProcessingEvents, never in rpcCalls (see that field's own
      // comment). Default: nothing newer arrived — release immediately,
      // matching every pre-H-6 test's implicit "one pass and done".
      if (name === 'release_or_continue_ai_processing') {
        h.state.aiProcessingEvents.push('release_or_continue')
        if (h.state.conv) h.state.conv.ai_processing_started_at = null
        // A RETURNS TABLE function's data comes back as an array of rows
        // (real convention — see insert_inbound_customer_message,
        // migration 053) — the real code reads `data?.[0]`, never
        // `.maybeSingle()`.
        return chainable([{ released: true, latest_message_id: null }])
      }
      h.state.rpcCalls.push({ name, args })
      // FASE 11 — DataSourceCatalogProvider.searchCatalog() calls this
      // RPC for real (never mocked at the provider level) in the
      // integration test below; every other existing test never
      // configures an active data source that would reach it, so this
      // branch is inert for them.
      if (name === 'search_ai_catalog_products') {
        return chainable(h.state.catalogProductRows)
      }
      return chainable(h.state.claim)
    },
  }),
}))

import { dispatchInboundToAiReply, wrapWithMediaSideEffect } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

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

beforeEach(() => {
  // The per-account rate limiter (checkRateLimit, RATE_LIMITS
  // .aiAutoReplyAccount — 30/60s) is a real, module-level, in-memory
  // Map, never mocked in this file. Every test calls
  // dispatchInboundToAiReply(ARGS) with the SAME accountId ('acct-1'),
  // so without this reset, the cumulative count across every test that
  // has already run in this file eventually crosses the real 30-request
  // window and starts failing UNRELATED, later tests non-deterministically
  // (this surfaced only now, once the file's total dispatch count grew
  // past 30 — hardening plan, Paso 6). Resetting here does not change
  // what any test asserts; it only makes the real rate limiter's state
  // deterministic per test, exactly like every other piece of shared
  // state below.
  __resetRateLimitForTests()
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.dataSources = []
  h.state.businessProfileRow = null
  h.state.departments = []
  h.state.contacts = []
  h.state.catalogProductRows = []
  h.state.failHandoffUpdate = false
  h.state.aiProcessingEvents = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  // Not "hi" — that's a real greeting under routing.ts's own vocabulary
  // and would route to 'neither', which is correct behavior but would
  // silently defeat every test below that doesn't itself care about
  // routing and just expects the pre-FASE-5 "always ground the reply"
  // behavior. A message with no specific catalog/Knowledge vocabulary
  // AND no greeting match falls into routing's conservative ambiguous
  // branch instead, which is the closest equivalent to "always attempt
  // everything available" for tests that aren't testing routing itself.
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Necesito ayuda con mi pedido' }])
  h.latestCustomerMessageId.mockResolvedValue('msg-1')
  h.retrieveKnowledge.mockResolvedValue([])
  h.accountHasKnowledgeBase.mockResolvedValue(true)
  // toolCalls is a required field on the real GenerateResult (never
  // optional/undefined — see generate.ts::parseGeneration, which always
  // defaults it to []); matching that here is what exercises the real
  // usage-logging code path (toolCalls.length, etc.) instead of masking
  // it behind a mock that's looser than the actual contract.
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false, usage: null, toolCalls: [] })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('threads systemPromptBlocks (Anthropic prompt caching, FASE 8) alongside the plain systemPrompt, reflecting the same retrieved content', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    const call = h.generateReply.mock.calls[0][0] as {
      systemPrompt: string
      systemPromptBlocks: { stable: string; dynamic: string }
    }
    expect(call.systemPromptBlocks.stable).toContain('KNOWLEDGE BASE —')
    expect(call.systemPromptBlocks.dynamic).toContain('Returns accepted within 30 days.')
    // Never duplicated into the wrong half.
    expect(call.systemPromptBlocks.stable).not.toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

// ============================================================
// Routing (AI optimization project, FASE 5) — proves the wiring in
// auto-reply.ts itself, not routing.ts's own decision logic (fully
// covered in routing.test.ts). An active data source makes
// hasActiveCatalogSources() true for these so "catalog IS available
// but routing didn't need it this turn" is actually exercised, not
// just "catalog was never configured".
// ============================================================
describe('dispatchInboundToAiReply — routing (FASE 5)', () => {
  const ACTIVE_DATA_SOURCE = [
    {
      id: 'ds-1',
      display_name: 'Catálogo',
      status: 'active',
      usage: 'catalog',
      priority: 100,
      is_primary: true,
      fallback_policy: 'fallback_on_not_found',
    },
  ]

  it('a greeting skips Knowledge retrieval AND catalog tool attachment, even with both available', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Hola' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).not.toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].tools).toBeUndefined()
  })

  it('a Knowledge-only question attaches Knowledge but NOT catalog tools, even though catalog is available', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Cuál es el horario?' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].tools).toBeUndefined()
  })

  it('a catalog-only question attaches catalog tools but skips Knowledge retrieval, even though Knowledge is available', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Cuánto cuesta el producto?' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).not.toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].tools).toBeDefined()
    expect(h.generateReply.mock.calls[0][0].executeTool).toBeDefined()
  })

  it('a mixed question ("¿cuánto cuesta y hacen delivery?") attaches BOTH', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Cuánto cuesta el producto y hacen delivery?' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].tools).toBeDefined()
  })

  it('Escenario D (global audit): mixed question also attaches Business Profile — three FASE 5/6 gates share one system prompt without cross-contamination', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.state.businessProfileRow = { account_id: 'acct-1', business_name: 'Ferretería El Tornillo', delivery_enabled: true, delivery_description: 'Entrega en 24h' }
    h.retrieveKnowledge.mockResolvedValue(['Aceptamos tarjeta y efectivo.'])
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Cuánto cuesta el producto y hacen delivery?' },
    ])
    await dispatchInboundToAiReply(ARGS)
    const call = h.generateReply.mock.calls[0][0] as { systemPrompt: string; tools: unknown }
    // All three FASE 5/6 gates fired together for the same 'both' turn —
    // catalog tools attached, Knowledge rules present, AND Business
    // Profile (piggybacking on the same useKnowledge gate) present too.
    expect(call.tools).toBeDefined()
    expect(call.systemPrompt).toContain('CATALOG TOOLS')
    expect(call.systemPrompt).toContain('KNOWLEDGE BASE —')
    expect(call.systemPrompt).toContain('BUSINESS PROFILE RULES —')
    expect(call.systemPrompt).toContain('Ferretería El Tornillo')
    // Never mixed: the delivery answer lives only in the Business
    // Profile section, never fabricated into the catalog rules text.
    expect(call.systemPrompt).toContain('Entrega en 24h')
  })

  it('never attaches catalog tools when the account has no active catalog source, regardless of the message', async () => {
    h.state.dataSources = [] // no active source — the pre-FASE-5 case
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Cuánto cuesta y tienen en negro?' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply.mock.calls[0][0].tools).toBeUndefined()
  })

  it('a follow-up with no catalog vocabulary still routes to catalog when ai_catalog_context is active', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_catalog_context: {
        lastQuery: 'A56',
        products: [
          { id: 'ds_ds-1:x', name: 'A56', brand: 'Samsung', model: 'A56', color: null, capacity: null, size: null, price: 100, currency: 'USD', fromQuery: 'A56' },
        ],
        updatedAt: new Date().toISOString(),
      },
    }
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Y en negro?' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply.mock.calls[0][0].tools).toBeDefined()
  })
})

// ============================================================
// Business Profile + handoff wiring (AI optimization project, FASE 6).
// Proves the auto-reply.ts INTEGRATION (routing gate reuse, prompt
// assembly, deterministic department/contact resolution, and the
// conversation-update side effect) — the pure logic underneath is
// covered exhaustively in business-profile/context.test.ts and
// business-profile/handoff-intent.test.ts. Covers the remaining
// end-to-end scenarios from the mandatory 44-test matrix: Business
// Profile routing (33), and Handoff (26-30).
// ============================================================
describe('dispatchInboundToAiReply — Business Profile routing (33)', () => {
  it('33. "¿Dónde están?" piggybacks on the Knowledge gate and injects Business Profile into the prompt', async () => {
    h.state.businessProfileRow = {
      account_id: 'acct-1',
      business_name: 'Ferretería El Tornillo',
      address: 'Av. Reforma 123',
      city: 'CDMX',
      state: null,
      country: null,
    }
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Dónde están ubicados?' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled() // Knowledge-routed, per routing.test.ts
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('BUSINESS PROFILE')
    expect(systemPrompt).toContain('Av. Reforma 123')
  })

  it('a greeting attaches neither Knowledge nor Business Profile, even with a profile configured', async () => {
    h.state.businessProfileRow = { account_id: 'acct-1', business_name: 'Ferretería El Tornillo' }
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Hola' }])
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('BUSINESS PROFILE')
  })
})

describe('dispatchInboundToAiReply — handoff (26-30)', () => {
  it('26/27/28. general handoff: no text sent, conversation marked pending, summary registered, no department/contact', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con una persona' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled() // 26 — nothing customer-visible sent
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      status: 'pending', // 27 — the CRM's existing "needs a human" state, reused
      ai_handoff_department_id: null,
      ai_handoff_contact_id: null,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('AI agent handed off') // 28
  })

  it('handoff to a named department resolves ai_handoff_department_id against the account\'s real departments', async () => {
    h.state.departments = [
      { id: 'd1', account_id: 'acct-1', name: 'Ventas', description: null, active: true, sort_order: 100, created_at: 't', updated_at: 't' },
    ]
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con ventas' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_handoff_department_id: 'd1', ai_handoff_contact_id: null })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('departamento de Ventas')
  })

  it('handoff to a named contact resolves ai_handoff_contact_id AND assigns their linked_user_id, even over a configured default handoff agent', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-default' }))
    h.state.contacts = [
      {
        id: 'c1', account_id: 'acct-1', department_id: null, name: 'Carlos Pérez', role_title: null,
        phone: null, whatsapp: null, email: null, notes: null, active: true, sort_order: 100,
        linked_user_id: 'user-carlos', created_at: 't', updated_at: 't',
      },
    ]
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con Carlos' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_handoff_contact_id: 'c1',
      // The specifically-matched contact's own login wins over the
      // account's generic default handoff agent (business-profile/
      // handoff-intent.ts's whole point — a specific match is more
      // useful to a human than the shared fallback queue).
      assigned_agent_id: 'user-carlos',
    })
  })

  it('a general handoff (no specific contact matched) still falls back to the configured default handoff agent', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-default' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con una persona' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ assigned_agent_id: 'agent-default', ai_handoff_contact_id: null })
  })

  it('30. handoff never writes account_id — accountId only ever flows in as a read-scoping argument', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).not.toHaveProperty('account_id')
  })

  it('an unresolvable department name falls back to a general handoff, never a guess', async () => {
    h.state.departments = [
      { id: 'd1', account_id: 'acct-1', name: 'Ventas', description: null, active: true, sort_order: 100, created_at: 't', updated_at: 't' },
    ]
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con recursos humanos' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_handoff_department_id: null, ai_handoff_contact_id: null })
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true, usage: null, toolCalls: [] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

// ============================================================
// wrapWithMediaSideEffect — the only place a catalog tool result
// triggers an actual WhatsApp send. Tested directly (not through the
// full dispatch path) since it's the one piece of this feature with a
// real external side effect.
// ============================================================
// ============================================================
// Facets / catalog aggregations — AI optimization project, FASE 11.
// Every other test in this file mocks `generateReply` entirely, so it
// only proves tools/executeTool were ATTACHED, never that a real tool
// round trip works. This block instead pulls the REAL `executeTool`
// closure `dispatchInboundToAiReply` built (wrapping the genuine
// executeCatalogTool → resolver.searchCatalog → DataSourceCatalogProvider
// chain, never re-mocked) and invokes it directly — proving the full
// real path: routing → catalog tool attachment → search_catalog →
// facets, while Knowledge/Business Profile keep working in the SAME
// dispatch (Rule 15's "no basta con probar una función aislada").
// ============================================================
describe('dispatchInboundToAiReply — facets integration (FASE 11)', () => {
  const ACTIVE_DATA_SOURCE = [
    {
      id: 'ds-1',
      display_name: 'Catálogo',
      status: 'active',
      usage: 'catalog',
      priority: 100,
      is_primary: true,
      fallback_policy: 'fallback_on_not_found',
    },
  ]

  function productRow(overrides: Record<string, unknown>) {
    return {
      id: 'row-1',
      source_product_id: 'sku-1',
      sku: 'SKU-1',
      name: 'TV Samsung 50"',
      brand: 'Samsung',
      model: '50Q60',
      description: null,
      color: 'Negro',
      variant_label: null,
      capacity: null,
      size: '50"',
      price: 25000,
      currency: 'DOP',
      available: true,
      available_quantity: 3,
      primary_image_url: null,
      images: null,
      total_count: 2,
      ...overrides,
    }
  }

  it('real end-to-end: routing → catalog tool → search_catalog → facets, without breaking Knowledge or Business Profile in the same dispatch', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.state.catalogProductRows = [
      productRow({ id: 'row-1', source_product_id: 'sku-1', brand: 'Samsung', color: 'Negro', price: 25000 }),
      productRow({ id: 'row-2', source_product_id: 'sku-2', brand: 'TCL', color: 'Blanco', price: 18000, name: 'TV TCL 50"' }),
    ]
    h.state.businessProfileRow = { account_id: 'acct-1', business_name: 'Electro Caribe', delivery_enabled: true, delivery_description: 'Entrega en 48h' }
    h.retrieveKnowledge.mockResolvedValue(['Aceptamos tarjeta y efectivo.'])
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Qué marcas de televisores tienen y hacen delivery?' },
    ])

    await dispatchInboundToAiReply(ARGS)

    // Knowledge and Business Profile are unaffected by catalog/facets —
    // same 'both' routing gate as every FASE 5/6 scenario.
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const call = h.generateReply.mock.calls[0][0] as {
      systemPrompt: string
      tools: unknown
      executeTool: (req: { id: string; name: string; input: unknown }) => Promise<unknown>
    }
    expect(call.tools).toBeDefined()
    expect(call.systemPrompt).toContain('Electro Caribe') // Business Profile still present
    expect(call.systemPrompt).toContain('FACETS —') // the new prompt rule is there too

    // The REAL tool executor — not a mock — actually resolves through
    // DataSourceCatalogProvider (hitting the mocked RPC only) and
    // computes real facets from the two fixture rows above.
    const result = (await call.executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'televisor' } })) as {
      products: unknown[]
      total: number
      facets?: { brands?: string[]; colors?: string[]; priceRange?: { min: number; max: number } }
    }
    expect(result.products).toHaveLength(2)
    expect(result.facets?.brands).toEqual(['Samsung', 'TCL'])
    expect(result.facets?.colors).toEqual(['Blanco', 'Negro'])
    expect(result.facets?.priceRange).toEqual({ min: 18000, max: 25000 })

    // No handoff, no crash — the conversation update never fires.
    expect(h.state.updatePayload).toBeNull()
  })

  it('account isolation: the RPC receives THIS account\'s id, never anything the tool input could influence', async () => {
    h.state.dataSources = ACTIVE_DATA_SOURCE
    h.state.catalogProductRows = [productRow({})]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Qué marcas tienen?' }])

    await dispatchInboundToAiReply(ARGS)
    const call = h.generateReply.mock.calls[0][0] as {
      executeTool: (req: { id: string; name: string; input: unknown }) => Promise<unknown>
    }
    // A malicious account_id in the tool input has no path to the query.
    await call.executeTool({ id: 'c1', name: 'search_catalog', input: { query: 'tv', account_id: 'someone-elses-account' } })

    const rpcCall = h.state.rpcCalls.find((c) => c.name === 'search_ai_catalog_products')
    expect((rpcCall?.args as { p_account_id: string }).p_account_id).toBe('acct-1')
  })
})

// ============================================================
// F2 — provider failure must escalate to a human via the SAME
// deterministic pending/handoff route a model-requested handoff uses,
// never leave the inbound silently unanswered with nobody told, and
// never send the customer a fabricated reply.
// ============================================================
describe('dispatchInboundToAiReply — F2: provider failure', () => {
  it('a generic Error from generateReply marks the conversation pending/handoff and sends nothing to the customer', async () => {
    h.generateReply.mockRejectedValue(new Error('network error'))

    await dispatchInboundToAiReply(ARGS)

    // No fabricated reply, and the reply-slot RPC is never even attempted.
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)

    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      status: 'pending',
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('provider error')
  })

  it('an AiError (e.g. a timeout) from generateReply is handled the exact same functional way as a plain thrown error', async () => {
    const { AiError } = await import('./types')
    h.generateReply.mockRejectedValue(
      new AiError('The AI provider took too long to respond.', { code: 'timeout', status: 504 }),
    )

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      status: 'pending',
    })
  })

  it("still resolves a department from the customer's own message on a provider failure, same deterministic resolution a model-requested handoff uses", async () => {
    h.state.departments = [
      {
        id: 'd1', account_id: 'acct-1', name: 'Ventas', description: null,
        active: true, sort_order: 100, created_at: 't', updated_at: 't',
      },
    ]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con ventas' }])
    h.generateReply.mockRejectedValue(new Error('provider is down'))

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ ai_handoff_department_id: 'd1' })
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('never throws and never sends anything, even when the handoff fallback itself also fails', async () => {
    h.state.failHandoffUpdate = true
    h.generateReply.mockRejectedValue(new Error('network error'))

    // The module's own contract ("it owns its try/catch and NEVER
    // throws") must hold even when BOTH the provider call and the
    // fallback it triggers fail.
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('wrapWithMediaSideEffect', () => {
  const target = { accountId: 'acct-1', userId: 'user-1', conversationId: 'conv-1', contactId: 'contact-1' }

  beforeEach(() => h.engineSendMedia.mockClear())

  it('sends the resolved primary image via engineSendMedia on a successful get_product_media call', async () => {
    const base = vi.fn().mockResolvedValue({
      productId: 'ds_1:sku-1',
      primaryImage: { url: 'https://x/img.jpg' },
      images: [{ url: 'https://x/img.jpg' }],
    })
    h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'wamid-1' })
    const wrapped = wrapWithMediaSideEffect(base, target)

    const result = await wrapped({ id: 'c1', name: 'get_product_media', input: { id: 'ds_1:sku-1' } })

    expect(h.engineSendMedia).toHaveBeenCalledWith({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      kind: 'image',
      link: 'https://x/img.jpg',
    })
    // The tool result the model sees is unchanged by the side effect.
    expect(result).toEqual({
      productId: 'ds_1:sku-1',
      primaryImage: { url: 'https://x/img.jpg' },
      images: [{ url: 'https://x/img.jpg' }],
    })
  })

  it('does not send anything for a get_product_media call that errored (not_found / no_media_available)', async () => {
    const base = vi.fn().mockResolvedValue({ error: 'no_media_available' })
    const wrapped = wrapWithMediaSideEffect(base, target)
    await wrapped({ id: 'c2', name: 'get_product_media', input: {} })
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })

  it('never sends media for a different tool (search_catalog / get_product / get_availability)', async () => {
    const base = vi.fn().mockResolvedValue({ products: [{ primaryImage: { url: 'https://x/img.jpg' } }] })
    const wrapped = wrapWithMediaSideEffect(base, target)
    await wrapped({ id: 'c3', name: 'search_catalog', input: {} })
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })

  it('swallows an engineSendMedia failure — the tool result still reaches the model', async () => {
    const base = vi.fn().mockResolvedValue({ primaryImage: { url: 'https://x/img.jpg' }, images: [] })
    h.engineSendMedia.mockImplementationOnce(() => Promise.reject(new Error('WhatsApp not configured')))
    const wrapped = wrapWithMediaSideEffect(base, target)
    const result = await wrapped({ id: 'c4', name: 'get_product_media', input: {} })
    expect(result).toMatchObject({ primaryImage: { url: 'https://x/img.jpg' } })
  })
})

// ============================================================
// SEAM — dispatchInboundToAiReply → generateReply REAL (hardening
// plan, Paso 3 / Fase 2 audit gap 2.8 §18). Every OTHER describe block
// in this file mocks `./generate` entirely (`h.generateReply` is a
// plain `vi.fn()`) — that proves what `auto-reply.ts` DOES with a
// given AI response, never that the real provider adapter/tool-calling
// loop (`generate.ts` → `providers/openai-compatible.ts`) actually
// produces that response correctly from a real dispatch.
// `catalog-agent-scenarios.test.ts` proves the reverse half (real
// `generateReply` + real `executeCatalogTool`/resolver, invoked
// directly, never through `dispatchInboundToAiReply`). Nothing
// connects both halves in one test — this block closes exactly that
// gap, and only that gap.
//
// `h.generateReply` (from the shared `vi.mock('./generate', ...)` at
// the top of this file) is given the REAL implementation via
// `mockImplementation(realGenerateReply)` for every test below —
// `./generate` itself is never un-mocked (the shared mock declaration
// can't be removed without breaking every other describe block in this
// file), but the function every test in this block actually executes
// IS the genuine `generateReply` → real provider adapter → real
// tool-calling loop. Only `fetch` (the provider's HTTP call) and the
// admin-client Supabase double (already shared by the whole file) are
// mocked.
//
// EPISTEMOLOGICAL LIMIT — applies to every test below: scripting
// `fetch` proves the CODE wires `dispatchInboundToAiReply` →
// `generateReply` → the real tool-calling loop → `executeCatalogTool`
// → the resolver → `engineSendText`/`ai_catalog_context`/handoff
// correctly. It does NOT prove that a real GPT/Claude/OpenRouter model
// would produce the scripted response, resist a prompt injection,
// never invent a price/stock value, or always decide correctly when to
// hand off — `fetch`'s mock fully determines what "the model" appears
// to say. This test must never be cited as evidence for R2; R2 remains
// exactly `RIESGO POTENCIAL / NO VERIFICADO`.
// ============================================================
describe('dispatchInboundToAiReply — SEAM: real generateReply + real tool-calling loop (hardening, Paso 3)', () => {
  let realGenerateReply: typeof import('./generate').generateReply

  const SEAM_ACTIVE_DATA_SOURCE = [
    {
      id: 'ds-seam',
      display_name: 'Catálogo de prueba',
      status: 'active',
      usage: 'catalog',
      priority: 100,
      is_primary: true,
      fallback_policy: 'fallback_on_not_found',
    },
  ]

  function seamProductRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'row-seam-1',
      source_product_id: 'sku-seam-1',
      sku: 'SKU-SEAM-1',
      name: 'Samsung A07 64GB Negro',
      brand: 'Samsung',
      model: 'A07',
      description: null,
      color: 'Negro',
      variant_label: null,
      capacity: '64GB',
      size: null,
      price: 7500,
      currency: 'DOP',
      available: true,
      available_quantity: 3,
      primary_image_url: null,
      images: null,
      total_count: 1,
      ...overrides,
    }
  }

  function okFetchResponse(json: unknown): Response {
    return { ok: true, status: 200, json: async () => json } as unknown as Response
  }

  function errFetchResponse(status: number, json: unknown): Response {
    return { ok: false, status, json: async () => json } as unknown as Response
  }

  beforeEach(async () => {
    if (!realGenerateReply) {
      const actual = await vi.importActual<typeof import('./generate')>('./generate')
      realGenerateReply = actual.generateReply
    }
    h.generateReply.mockImplementation(realGenerateReply)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('main scenario: fetch (tool call) → real generateReply → real executeCatalogTool → real resolver → fetch (final text) → real engineSendText, with the smuggled account_id ignored and ai_catalog_context persisted from the REAL tool result', async () => {
    h.state.dataSources = SEAM_ACTIVE_DATA_SOURCE
    h.state.catalogProductRows = [seamProductRow()]
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Cuánto cuesta el Samsung A07 negro de 64GB?' },
    ])

    const FINAL_TEXT = 'El Samsung A07 64GB Negro cuesta RD$7,500 y hay 3 disponibles.'
    const fetchMock = vi
      .fn()
      // Turn 1 — the (mocked) provider requests a catalog lookup. The
      // tool-call arguments smuggle an `account_id` — proving the real
      // `executeCatalogTool` never reads it (requirement 5).
      .mockResolvedValueOnce(
        okFetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_catalog',
                      arguments: JSON.stringify({ query: 'A07 negro 64', account_id: 'attacker-account' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      // Turn 2 — answers using exactly the fixture's real price/stock.
      .mockResolvedValueOnce(okFetchResponse({ choices: [{ message: { content: FINAL_TEXT } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await dispatchInboundToAiReply(ARGS)

    // fetch → generateReply (REAL) → dispatchInboundToAiReply (REAL) →
    // engineSendText, with the exact text the second fetch produced.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: FINAL_TEXT }))

    // accountId used by the resolver/RPC is the real one from ARGS —
    // never the smuggled tool-call argument.
    const rpcCall = h.state.rpcCalls.find((c) => c.name === 'search_ai_catalog_products')
    expect((rpcCall?.args as { p_account_id: string } | undefined)?.p_account_id).toBe('acct-1')

    // The SECOND request sent to the provider actually carries the
    // REAL tool result (not a value asserted independently of it) —
    // this is the wire-level proof that the pipeline delivered the
    // genuine resolver output back to "the model".
    const secondRequestBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    const toolMessage = (secondRequestBody.messages as { role: string; content: string }[]).find(
      (m) => m.role === 'tool',
    )
    expect(toolMessage?.content).toContain('7500')
    expect(toolMessage?.content).toContain('Samsung A07 64GB Negro')

    // ai_catalog_context persisted after the dispatch corresponds to
    // the REAL product the tool resolved — not fabricated in the test.
    expect(h.state.updatePayload).toMatchObject({
      ai_catalog_context: expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({ price: 7500, name: 'Samsung A07 64GB Negro' }),
        ]),
      }),
    })
  })

  it('handoff scenario: fetch returns [[HANDOFF]] directly (no tool call) → real generateReply parses it → real detectHandoffIntent resolves the named department', async () => {
    h.state.departments = [
      { id: 'd1', account_id: 'acct-1', name: 'Ventas', description: null, active: true, sort_order: 100, created_at: 't', updated_at: 't' },
    ]
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Quiero hablar con Ventas, por favor.' },
    ])

    const fetchMock = vi.fn().mockResolvedValueOnce(
      okFetchResponse({
        choices: [{ message: { content: 'Ya te comunico con un asesor. [[HANDOFF]]' } }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await dispatchInboundToAiReply(ARGS)

    expect(fetchMock).toHaveBeenCalledTimes(1) // no tools attached — no catalog configured
    expect(h.engineSendText).not.toHaveBeenCalled() // the sentinel is never customer-visible
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      status: 'pending',
      ai_handoff_department_id: 'd1', // real detectHandoffIntent resolution
      ai_handoff_contact_id: null,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('departamento de Ventas')
  })

  // ----------------------------------------------------------
  // Paso 7 — purchase intent without handoff (hardening plan).
  //
  // EPISTEMOLOGICAL LIMIT (see the block-level comment above, and
  // R2 — RIESGO POTENCIAL / NO VERIFICADO, unchanged): `fetch` is
  // scripted, in this ONE test, to return a normal commercial reply
  // with no `[[HANDOFF]]` sentinel. This proves ONLY that — given
  // that specific provider response — the application's own code
  // does not invent or force a handoff on top of it. It does NOT
  // prove, and must never be cited as proving, that a real
  // GPT/Claude/OpenRouter model will always respond this way to
  // "quiero comprar el Samsung A07 64GB Negro", nor that it will
  // never decide to emit [[HANDOFF]] for a purchase-intent message.
  // Whether a real model hands off on purchase intent is entirely a
  // matter of the real model's own behavior against the prompt text
  // (STOCK-AWARE BROWSING / COMMERCIAL BEHAVIOR in defaults.ts) — no
  // code in `auto-reply.ts` special-cases "purchase intent" at all;
  // it only ever branches on `handoff || !text` from whatever
  // `generateReply` returned.
  // ----------------------------------------------------------
  it('Paso 7 — a commercial reply with NO [[HANDOFF]] never gets turned into a handoff by the application code, even for an explicit purchase-intent message', async () => {
    h.state.dataSources = SEAM_ACTIVE_DATA_SOURCE
    h.state.catalogProductRows = [seamProductRow()] // Samsung A07 64GB Negro, price 7500
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Quiero comprar el Samsung A07 64GB Negro.' },
    ])

    const FINAL_TEXT =
      'Perfecto, el Samsung A07 64GB Negro cuesta RD$7,500 y tenemos 3 disponibles. ¿Deseas continuar con la compra?'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okFetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'search_catalog', arguments: '{"query":"Samsung A07 64GB Negro"}' },
                  },
                ],
              },
            },
          ],
        }),
      )
      // A normal commercial reply — no sentinel anywhere in this text.
      .mockResolvedValueOnce(okFetchResponse({ choices: [{ message: { content: FINAL_TEXT } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await dispatchInboundToAiReply(ARGS)

    expect(fetchMock).toHaveBeenCalledTimes(2)

    // The application did not invent a handoff: the only conversations
    // update that happened is the ai_catalog_context write (real tool
    // result), never the handoff shape (status/ai_autoreply_disabled).
    // If `handOffToHuman()` had run, it would have made its OWN,
    // LATER `.update()` call that overwrites `h.state.updatePayload`
    // with exactly that handoff shape — its absence here is the
    // observable proof `handOffToHuman` was never invoked.
    expect(h.state.updatePayload).not.toHaveProperty('status')
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).toMatchObject({
      ai_catalog_context: expect.objectContaining({
        products: expect.arrayContaining([expect.objectContaining({ price: 7500 })]),
      }),
    })

    // The normal commercial flow continued: exactly the provider's
    // final text was sent to the customer.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: FINAL_TEXT }))

    // The product/price the reply is grounded in is traceable to the
    // REAL tool result the second request actually carried — not
    // asserted independently of it.
    const secondRequestBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    const toolMessage = (secondRequestBody.messages as { role: string; content: string }[]).find(
      (m) => m.role === 'tool',
    )
    expect(toolMessage?.content).toContain('7500')
  })

  it('provider-failure scenario: fetch returns a real 500 → real generateReply throws a real AiError → the existing F2 handoff fires, same as the fully-mocked F2 tests', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Hola, necesito ayuda' }])

    const fetchMock = vi.fn().mockResolvedValueOnce(
      errFetchResponse(500, { error: { message: 'internal server error' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true, status: 'pending' })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'The AI agent could not generate a reply (provider error)',
    )
  })
})

// ============================================================
// wrapWithMediaSideEffect + executeCatalogTool — REAL composition
// (hardening plan, Paso 5 / Fase 2 audit 2.8 §18 — "cierra un supuesto
// hoy solo confirmado por inspección de código"). Every existing test
// in the `wrapWithMediaSideEffect` describe above wraps a fully-mocked
// `base` (`vi.fn()`), so the guarantee that the URL sent to
// `engineSendMedia` actually comes from `executeCatalogTool` → the
// real `resolver.ts`/`DataSourceCatalogProvider` → the real
// `whitelist.ts` — never from anything the model's tool-call `input`
// could influence — was previously proven only by reading the code,
// not by a test. This block wraps the REAL `executeCatalogTool`
// (unmocked, same as the SEAM/adversarial-scenarios tests), so the URL
// asserted below is genuinely traceable to the fake Supabase fixture,
// through every real layer in between.
//
// `engineSendMedia` is the only mock here — it is the real WhatsApp
// send boundary and is already mocked file-wide (see the
// `@/lib/flows/meta-send` mock at the top of this file); nothing else
// is mocked in this describe block.
// ============================================================
describe('wrapWithMediaSideEffect + executeCatalogTool — real composition (hardening, Paso 5)', () => {
  function mediaProductRow(id: string, name: string, over: Partial<Record<string, unknown>> = {}) {
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

  /** Account-aware fake — a data source belonging to a DIFFERENT
   *  account than the one `executeCatalogTool` is scoped to must never
   *  resolve, exactly like the resolver's own real account filters. */
  function fakeMediaCatalogDb(opts: {
    dataSourceAccountId: string
    requestedAccountId: string
    products: Record<string, unknown>[]
  }): SupabaseClient {
    const { dataSourceAccountId, requestedAccountId, products } = opts
    const belongsToRequester = dataSourceAccountId === requestedAccountId
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
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () =>
                    Promise.resolve({
                      data: belongsToRequester
                        ? [
                            {
                              id: 'ds-media-1',
                              display_name: 'Catálogo con fotos',
                              status: 'active',
                              usage: 'catalog',
                              priority: 100,
                              is_primary: false,
                              fallback_policy: 'fallback_on_not_found',
                            },
                          ]
                        : [],
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
              const match = belongsToRequester ? products.find((p) => p.source_product_id === spid) : undefined
              return Promise.resolve({ data: match ?? null, error: null })
            },
            limit: () => Promise.resolve({ data: belongsToRequester ? products : [], error: null }),
          }
          return api
        }
        throw new Error(`unexpected table in test double: ${table}`)
      },
      rpc: (fn: string, params: Record<string, unknown>) => {
        if (fn !== 'search_ai_catalog_products') throw new Error(`unexpected rpc: ${fn}`)
        if (!belongsToRequester || params.p_account_id !== requestedAccountId) {
          return Promise.resolve({ data: [], error: null })
        }
        const query = String(params.p_query ?? '').toLowerCase().trim()
        const words = query.split(/\s+/).filter(Boolean)
        const matches = query
          ? products.filter((p) => words.some((w) => String(p.name).toLowerCase().includes(w)))
          : products.slice()
        return Promise.resolve({ data: matches.map((p) => ({ ...p, total_count: matches.length })), error: null })
      },
    }
    return db as unknown as SupabaseClient
  }

  const target = { accountId: 'acct-1', userId: 'user-1', conversationId: 'conv-1', contactId: 'contact-1' }

  beforeEach(() => h.engineSendMedia.mockClear())

  it('PRUEBA 1 — engineSendMedia receives exactly the URL the REAL executeCatalogTool/resolver/whitelist resolved for acct-1 — never an independently invented one', async () => {
    const REAL_URL = 'https://cdn.example.com/a07-real.jpg'
    const db = fakeMediaCatalogDb({
      dataSourceAccountId: 'acct-1',
      requestedAccountId: 'acct-1',
      products: [mediaProductRow('p1', 'Samsung A07 Negro', { price: 9500, primary_image_url: REAL_URL })],
    })
    h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'wamid-real' })

    const wrapped = wrapWithMediaSideEffect(executeCatalogTool(db, 'acct-1'), target)
    const search = (await wrapped({ id: 'c1', name: 'search_catalog', input: { query: 'A07' } })) as {
      products: { id: string }[]
    }
    expect(search.products).toHaveLength(1)
    const realId = search.products[0].id

    const mediaResult = (await wrapped({ id: 'c2', name: 'get_product_media', input: { id: realId } })) as {
      primaryImage?: { url: string } | null
      images: unknown[]
    }

    // Traceable: the URL came from the fixture, through the real
    // resolver/whitelist, not asserted independently of it.
    expect(mediaResult.primaryImage?.url).toBe(REAL_URL)
    expect(h.engineSendMedia).toHaveBeenCalledTimes(1)
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-1', kind: 'image', link: REAL_URL }),
    )
    // The result the model sees is unmutated by the side effect —
    // exact equality against the real CatalogMedia shape (`productId`
    // included), not a partial/loose match.
    expect(mediaResult).toEqual({ productId: realId, primaryImage: { url: REAL_URL }, images: [] })
  })

  it('PRUEBA 1b — accountId isolation: acct-1\'s executor never resolves or sends acct-2\'s product/image', async () => {
    const db = fakeMediaCatalogDb({
      dataSourceAccountId: 'acct-2',
      requestedAccountId: 'acct-1',
      products: [mediaProductRow('secret', 'Producto secreto de acct-2', { primary_image_url: 'https://cdn.example.com/secret.jpg' })],
    })

    const wrapped = wrapWithMediaSideEffect(executeCatalogTool(db, 'acct-1'), target)
    const search = (await wrapped({ id: 'c1', name: 'search_catalog', input: { query: 'producto' } })) as {
      products: unknown[]
    }

    expect(search.products).toHaveLength(0) // acct-1 sees none of acct-2's catalog
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })

  it('PRUEBA 2 — primaryImage takes precedence over images[0] when their URLs are DIFFERENT — never the fallback when a primary exists', async () => {
    const PRIMARY_URL = 'https://example.com/PRIMARY.jpg'
    const FALLBACK_URL = 'https://example.com/FALLBACK.jpg'
    const db = fakeMediaCatalogDb({
      dataSourceAccountId: 'acct-1',
      requestedAccountId: 'acct-1',
      products: [
        mediaProductRow('p1', 'TV TCL 50', {
          price: 25000,
          primary_image_url: PRIMARY_URL,
          images: [{ url: FALLBACK_URL }],
        }),
      ],
    })
    h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'wamid-precedence' })

    const wrapped = wrapWithMediaSideEffect(executeCatalogTool(db, 'acct-1'), target)
    const search = (await wrapped({ id: 'c1', name: 'search_catalog', input: { query: 'TCL' } })) as {
      products: { id: string }[]
    }
    const realId = search.products[0].id

    const mediaResult = (await wrapped({ id: 'c2', name: 'get_product_media', input: { id: realId } })) as {
      primaryImage?: { url: string } | null
      images: { url: string }[]
    }

    // Both real, DISTINCT URLs really exist on the resolved product —
    // this is what makes the precedence assertion below meaningful.
    expect(mediaResult.primaryImage?.url).toBe(PRIMARY_URL)
    expect(mediaResult.images).toEqual([{ url: FALLBACK_URL }])

    expect(h.engineSendMedia).toHaveBeenCalledTimes(1)
    expect(h.engineSendMedia).toHaveBeenCalledWith(expect.objectContaining({ link: PRIMARY_URL }))
    // Never the fallback, even though it's present and different.
    expect(h.engineSendMedia).not.toHaveBeenCalledWith(expect.objectContaining({ link: FALLBACK_URL }))

    // Unmutated for the model either way — exact equality against the
    // real CatalogMedia shape (`productId` included).
    expect(mediaResult).toEqual({
      productId: realId,
      primaryImage: { url: PRIMARY_URL },
      images: [{ url: FALLBACK_URL }],
    })
  })
})

// ============================================================
// ai_catalog_context persistence — REAL updateCatalogContext vs. what
// auto-reply.ts actually persists (hardening plan, Paso 6 / Fase 2
// audit 2.8 §18 — "sin aserción dedicada a su valor exacto persistido
// fuera del escenario de facets"). `updateCatalogContext` itself is
// already unit-tested as a pure function (catalog/context.test.ts);
// what was NOT tested is the "glue" — that `auto-reply.ts` actually
// calls `.update({ ai_catalog_context: ... })` with EXACTLY what that
// pure function computes from the real toolCalls, not some other
// value.
//
// The tool call fed to `generateReply` below is produced by calling
// the REAL `executeCatalogTool` once, in this test's own setup,
// against the SAME fake Supabase (`h.state.dataSources`/
// `catalogProductRows`, via the mocked `./admin-client`) that
// `dispatchInboundToAiReply` itself will use internally — so the
// product in the expectation is never a hand-typed duplicate; it's the
// literal object the real catalog pipeline resolved.
//
// This double-checks a real Supabase double, never real Postgres/RLS —
// same caveat as every other catalog test in this file.
// ============================================================
describe('ai_catalog_context persistence — real glue between updateCatalogContext and auto-reply.ts (hardening, Paso 6)', () => {
  it('conversations.update({ ai_catalog_context }) receives EXACTLY updateCatalogContext(null, toolCalls) — same real toolCalls, field by field', async () => {
    h.state.dataSources = [
      {
        id: 'ds-context-1',
        display_name: 'Catálogo',
        status: 'active',
        usage: 'catalog',
        priority: 100,
        is_primary: true,
        fallback_policy: 'fallback_on_not_found',
      },
    ]
    h.state.catalogProductRows = [
      {
        id: 'row-ctx-1',
        source_product_id: 'sku-ctx-1',
        sku: 'SKU-CTX-1',
        name: 'TV Samsung 50" QLED',
        brand: 'Samsung',
        model: '50Q60',
        description: null,
        color: 'Negro',
        variant_label: null,
        capacity: null,
        size: '50"',
        price: 25000,
        currency: 'DOP',
        available: true,
        available_quantity: 4,
        primary_image_url: null,
        images: null,
        total_count: 1,
      },
    ]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Cuánto cuesta el TV Samsung 50?' }])

    // Resolve the REAL tool call once — against the exact same fake
    // Supabase (via the mocked ./admin-client) dispatchInboundToAiReply
    // will use internally.
    const realExecuteTool = executeCatalogTool(supabaseAdmin(), 'acct-1')
    const realSearchResult = await realExecuteTool({
      id: 'call_1',
      name: 'search_catalog',
      input: { query: 'Samsung 50' },
    })
    const toolCalls = [{ name: 'search_catalog', input: { query: 'Samsung 50' }, result: realSearchResult }]

    h.generateReply.mockResolvedValue({
      text: 'El TV Samsung 50" QLED cuesta RD$25,000.',
      handoff: false,
      usage: null,
      toolCalls,
    })

    await dispatchInboundToAiReply(ARGS)

    // Expected value computed independently, via the REAL pure
    // function, from the SAME toolCalls object fed to generateReply
    // above — never a hand-typed product.
    const expectedContext = updateCatalogContext(null, toolCalls)
    expect(expectedContext.products).toHaveLength(1) // sanity: the fixture actually produced a product

    const persisted = h.state.updatePayload?.ai_catalog_context as CatalogTurnContext | undefined
    expect(persisted).toBeDefined()

    expect(persisted!.lastQuery).toBe(expectedContext.lastQuery)
    expect(persisted!.products).toEqual(expectedContext.products)
    // Field-by-field against the actual CatalogContextProduct shape —
    // not "contains a product", the EXACT product.
    expect(persisted!.products[0]).toEqual({
      id: expectedContext.products[0].id,
      name: expectedContext.products[0].name,
      brand: expectedContext.products[0].brand,
      model: expectedContext.products[0].model,
      color: expectedContext.products[0].color,
      capacity: expectedContext.products[0].capacity,
      size: expectedContext.products[0].size,
      price: expectedContext.products[0].price,
      currency: expectedContext.products[0].currency,
      fromQuery: expectedContext.products[0].fromQuery,
    })
    // Sanity on the actual values, not just self-consistency against
    // `expectedContext` — traceable to the fixture above.
    expect(persisted!.products[0]).toMatchObject({
      name: 'TV Samsung 50" QLED',
      brand: 'Samsung',
      color: 'Negro',
      capacity: null,
      size: '50"',
      price: 25000,
      currency: 'DOP',
    })

    // `updatedAt` is `new Date().toISOString()`, computed independently
    // inside `updateCatalogContext` on each call (once by
    // auto-reply.ts internally, once here for `expectedContext`) — a
    // few ms apart. A literal equality on this ONE field would be
    // flaky by construction, so it is verified deterministically
    // instead: present, and a genuinely valid ISO-8601 timestamp
    // (round-trips through `new Date(...).toISOString()` unchanged).
    // No other field is exempted from exact comparison — see above.
    expect(typeof persisted!.updatedAt).toBe('string')
    expect(new Date(persisted!.updatedAt).toISOString()).toBe(persisted!.updatedAt)
  })
})
