import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
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
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
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
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      // FASE 11 — DataSourceCatalogProvider.searchCatalog() calls this
      // RPC for real (never mocked at the provider level) in the
      // integration test below; every other existing test never
      // configures an active data source that would reach it, so this
      // branch is inert for them.
      if (name === 'search_ai_catalog_products') {
        return Promise.resolve({ data: h.state.catalogProductRows, error: null })
      }
      return Promise.resolve({ data: h.state.claim, error: null })
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
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
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
