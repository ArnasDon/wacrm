import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_AGENT_TOOLS, type AgentToolKey } from '../tool-permissions'
import { createAutoReplyTools } from './index'
import { searchCatalogues } from '@/lib/catalog/search'

const mocks = vi.hoisted(() => ({
  addContactTagIfAbsent: vi.fn(),
  generateReply: vi.fn(),
}))

vi.mock('@/lib/contacts/tag-write', () => ({
  addContactTagIfAbsent: mocks.addContactTagIfAbsent,
}))
vi.mock('@/lib/catalog/search', () => ({ searchCatalogues: vi.fn() }))
vi.mock('../knowledge', () => ({ retrieveKnowledge: vi.fn() }))
vi.mock('../generate', () => ({ generateReply: mocks.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendInteractiveButtons: vi.fn(),
  engineSendMedia: vi.fn(),
}))

function permissions(
  enabled: AgentToolKey,
): Record<AgentToolKey, boolean> {
  return Object.fromEntries(
    Object.keys(DEFAULT_AGENT_TOOLS).map((key) => [key, key === enabled]),
  ) as Record<AgentToolKey, boolean>
}

function runtime(
  db: WacrmSupabaseClient,
  enabled: AgentToolKey,
  agentId?: string,
  onToolCall?: Parameters<typeof createAutoReplyTools>[0]['onToolCall'],
) {
  return createAutoReplyTools({
    db,
    accountId: 'account-1',
    conversationId: 'conversation-1',
    contactId: 'contact-1',
    configOwnerUserId: 'user-1',
    config: {
      agentId,
      embeddingsApiKey: null,
      provider: 'openai',
      model: 'test-model',
      apiKey: 'test-key',
    },
    permissions: permissions(enabled),
    onToolCall,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.addContactTagIfAbsent.mockResolvedValue(true)
})

describe('CRM agent tools', () => {
  it('adds an existing account tag to the current contact', async () => {
    const db = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () =>
            Promise.resolve({
              data: [{ id: 'tag-1', name: 'VIP' }],
              error: null,
            }),
        }
        return chain
      },
    } as unknown as WacrmSupabaseClient

    const tools = runtime(db, 'add_tag')
    const result = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'add_tag',
        arguments: JSON.stringify({ tag_name: 'VIP' }),
      }),
    )

    expect(result).toMatchObject({ ok: true, added: true })
    expect(mocks.addContactTagIfAbsent).toHaveBeenCalledWith(db, {
      accountId: 'account-1',
      contactId: 'contact-1',
      tagId: 'tag-1',
    })
  })

  it('creates an idempotent open deal in the first pipeline stage', async () => {
    let inserted: Record<string, unknown> | null = null
    const db = {
      from: (table: string) => {
        const row =
          table === 'contacts'
            ? { id: 'contact-1' }
            : table === 'pipelines'
              ? { id: 'pipeline-1', name: 'Vendas' }
              : table === 'accounts'
                ? { default_currency: 'MZN' }
                : table === 'pipeline_stages'
                  ? { id: 'stage-1', name: 'Novo lead' }
                  : null
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () =>
            table === 'deals'
              ? Promise.resolve({ data: [], error: null })
              : chain,
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
          insert: (payload: Record<string, unknown>) => {
            inserted = payload
            return chain
          },
          single: () =>
            Promise.resolve({
              data: { id: 'deal-1', title: 'Renovação anual' },
              error: null,
            }),
        }
        return chain
      },
    } as unknown as WacrmSupabaseClient

    const tools = runtime(db, 'create_deal')
    const result = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'create_deal',
        arguments: JSON.stringify({
          title: 'Renovação anual',
          value: 12500,
          notes: 'Cliente confirmou interesse.',
        }),
      }),
    )

    expect(result).toMatchObject({ ok: true, created: true })
    expect(inserted).toMatchObject({
      account_id: 'account-1',
      conversation_id: 'conversation-1',
      contact_id: 'contact-1',
      pipeline_id: 'pipeline-1',
      stage_id: 'stage-1',
      currency: 'MZN',
      status: 'open',
    })
  })

  it('schedules a store visit for a valid future datetime', async () => {
    let inserted: Record<string, unknown> | null = null
    const db = {
      from: () => {
        const chain = {
          insert: (payload: Record<string, unknown>) => {
            inserted = payload
            return chain
          },
          select: () => chain,
          single: () =>
            Promise.resolve({
              data: { id: 'visit-1', scheduled_at: '2026-08-20T13:00:00.000Z' },
              error: null,
            }),
        }
        return chain
      },
    } as unknown as WacrmSupabaseClient

    const tools = runtime(db, 'schedule_visit')
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString()
    const result = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'schedule_visit',
        arguments: JSON.stringify({ scheduled_at: future, notes: 'Quer experimentar leggings.' }),
      }),
    )

    expect(result).toMatchObject({ ok: true, scheduled: true })
    expect(inserted).toMatchObject({
      account_id: 'account-1',
      contact_id: 'contact-1',
      conversation_id: 'conversation-1',
      notes: 'Quer experimentar leggings.',
    })
    expect(tools.getScheduledVisit()).toMatchObject({ notes: 'Quer experimentar leggings.' })
  })

  it('rejects scheduling a visit in the past', async () => {
    const tools = runtime({} as WacrmSupabaseClient, 'schedule_visit')
    const past = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()

    await expect(
      tools.executeTool({
        id: 'call-1',
        name: 'schedule_visit',
        arguments: JSON.stringify({ scheduled_at: past }),
      }),
    ).rejects.toThrow('scheduled_at must be in the future.')
    expect(tools.getScheduledVisit()).toBeNull()
  })

  it('gives a style opinion using the real photo of a product found earlier in the conversation', async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'product-1',
        name: 'Legging Alta Performance',
        description: null,
        price: 1500,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/legging.jpg',
        productUrl: null,
        category: 'Leggings',
        stockQuantity: 5,
        sourceName: 'LC Fitness',
      },
    ])
    mocks.generateReply.mockResolvedValue({
      text: '1. Legging Alta Performance: cintura alta e tecido flexível, óptima para o seu tipo de corpo.',
      handoff: false,
      usage: null,
    })

    const tools = createAutoReplyTools({
      db: {} as WacrmSupabaseClient,
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
      config: { provider: 'openai', model: 'test-model', apiKey: 'test-key', embeddingsApiKey: null },
      permissions: {
        ...Object.fromEntries(
          Object.keys(DEFAULT_AGENT_TOOLS).map((key) => [key, false]),
        ),
        search_catalog: true,
        get_style_opinion: true,
      } as Record<AgentToolKey, boolean>,
    })
    const searchResult = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'search_catalog',
        arguments: JSON.stringify({ query: 'legging' }),
      }),
    )
    const productRef = searchResult.products[0].product_ref

    const result = JSON.parse(
      await tools.executeTool({
        id: 'call-2',
        name: 'get_style_opinion',
        arguments: JSON.stringify({
          product_refs: [productRef],
          customer_description: 'Sou baixinha e prefiro roupas mais reservadas.',
        }),
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.opinion).toContain('cintura alta')
    expect(mocks.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'image_url', url: 'https://cdn.example.com/legging.jpg' }),
            ]),
          }),
        ],
      }),
    )
  })

  it('records a structured handoff without trusting customer-facing text', async () => {
    const tools = runtime({} as WacrmSupabaseClient, 'handoff_human')
    await tools.executeTool({
      id: 'call-1',
      name: 'handoff_human',
      arguments: JSON.stringify({
        reason: 'Reclamação exige decisão humana.',
        summary: 'Cliente recebeu o artigo errado.',
      }),
    })

    expect(tools.getHandoffRequest()).toEqual({
      reason: 'Reclamação exige decisão humana.',
      summary: 'Cliente recebeu o artigo errado.',
    })
    expect(tools.hasPendingActions()).toBe(false)
  })

  it('does not expose a disabled CRM mutation', () => {
    const tools = runtime({} as WacrmSupabaseClient, 'handoff_human')
    expect(tools.tools.map((tool) => tool.name)).toEqual(['handoff_human'])
  })

  it('logs only safe call metadata, without arguments or results', async () => {
    let logged: Record<string, unknown> | null = null
    const db = {
      from: (table: string) => {
        expect(table).toBe('agent_tool_calls')
        return {
          insert: (payload: Record<string, unknown>) => {
            logged = payload
            return Promise.resolve({ error: null })
          },
        }
      },
    } as unknown as WacrmSupabaseClient
    const tools = runtime(db, 'handoff_human', 'agent-1')

    await tools.executeTool({
      id: 'secret-call-id',
      name: 'handoff_human',
      arguments: JSON.stringify({
        reason: 'Sensitive complaint details',
      }),
    })

    expect(logged).toMatchObject({
      account_id: 'account-1',
      agent_id: 'agent-1',
      conversation_id: 'conversation-1',
      tool_key: 'handoff_human',
      succeeded: true,
    })
    expect(JSON.stringify(logged)).not.toContain('Sensitive complaint')
    expect(JSON.stringify(logged)).not.toContain('secret-call-id')
  })

  it('reports safe timing metadata to the turn trace', async () => {
    const onToolCall = vi.fn()
    const db = {
      from: () => ({ insert: () => Promise.resolve({ error: null }) }),
    } as unknown as WacrmSupabaseClient
    const tools = runtime(db, 'handoff_human', 'agent-1', onToolCall)

    await tools.executeTool({
      id: 'private-id',
      name: 'handoff_human',
      arguments: JSON.stringify({ reason: 'Private reason' }),
    })

    expect(onToolCall).toHaveBeenCalledWith({
      name: 'handoff_human',
      ms: expect.any(Number),
      succeeded: true,
    })
    expect(JSON.stringify(onToolCall.mock.calls)).not.toContain('Private reason')
    expect(JSON.stringify(onToolCall.mock.calls)).not.toContain('private-id')
  })

  it('exposes only monetary facts returned by trusted tool data', async () => {
    const { retrieveKnowledge } = await import('../knowledge')
    vi.mocked(retrieveKnowledge).mockResolvedValue([
      'A taxa confirmada na política é 250 MZN.',
    ])
    const db = {
      from: () => ({ insert: () => Promise.resolve({ error: null }) }),
    } as unknown as WacrmSupabaseClient
    const tools = runtime(db, 'search_knowledge', 'agent-1')
    await tools.executeTool({
      id: 'call-1',
      name: 'search_knowledge',
      arguments: JSON.stringify({ query: 'taxa' }),
    })

    expect(tools.getTrustedPriceAmounts()).toEqual([250])
    expect(tools.wasCatalogueVerified()).toBe(false)
  })
})
