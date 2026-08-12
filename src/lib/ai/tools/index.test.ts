import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_AGENT_TOOLS, type AgentToolKey } from '../tool-permissions'
import { createAutoReplyTools } from './index'
import { searchCatalogues } from '@/lib/catalog/search'
import { engineSendMedia } from '@/lib/flows/meta-send'

const mocks = vi.hoisted(() => ({
  addContactTagIfAbsent: vi.fn(),
  generateReply: vi.fn(),
  loadConversationCatalogState: vi.fn(),
  rememberCatalogSearch: vi.fn(),
  rememberProductsShown: vi.fn(),
  rememberSelectedProduct: vi.fn(),
}))

vi.mock('@/lib/contacts/tag-write', () => ({
  addContactTagIfAbsent: mocks.addContactTagIfAbsent,
}))
vi.mock('@/lib/catalog/search', () => ({ searchCatalogues: vi.fn() }))
vi.mock('../knowledge', () => ({ retrieveKnowledge: vi.fn() }))
vi.mock('../generate', () => ({ generateReply: mocks.generateReply }))
vi.mock('../catalog-state', () => ({
  loadConversationCatalogState: mocks.loadConversationCatalogState,
  rememberCatalogSearch: mocks.rememberCatalogSearch,
  rememberProductsShown: mocks.rememberProductsShown,
  rememberSelectedProduct: mocks.rememberSelectedProduct,
}))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendMedia: vi.fn(),
}))

function permissions(
  ...enabled: AgentToolKey[]
): Record<AgentToolKey, boolean> {
  return Object.fromEntries(
    Object.keys(DEFAULT_AGENT_TOOLS).map((key) => [key, enabled.includes(key as AgentToolKey)]),
  ) as Record<AgentToolKey, boolean>
}

function runtime(
  db: WacrmSupabaseClient,
  enabled: AgentToolKey | AgentToolKey[],
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
    permissions: permissions(...(Array.isArray(enabled) ? enabled : [enabled])),
    onToolCall,
  })
}

const emptyCatalogState = {
  lastQuery: null,
  lastFilters: {},
  shownProductKeys: [],
  shownMediaKeys: [],
  rejectedProductKeys: [],
  selectedProductKey: null,
  selectedProductName: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.addContactTagIfAbsent.mockResolvedValue(true)
  mocks.loadConversationCatalogState.mockResolvedValue({ ...emptyCatalogState })
  mocks.rememberCatalogSearch.mockResolvedValue(undefined)
  mocks.rememberProductsShown.mockResolvedValue(undefined)
  mocks.rememberSelectedProduct.mockResolvedValue(undefined)
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
            Promise.resolve({ data: [{ id: 'tag-1', name: 'VIP' }], error: null }),
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
            table === 'deals' ? Promise.resolve({ data: [], error: null }) : chain,
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

  it('uses a fresh catalogue ref in the same run for a style opinion', async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'product-1',
        name: 'Legging Alta Performance',
        description: 'Cor: preto. Cintura alta.',
        price: 1500,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/legging.jpg',
        productUrl: null,
        category: 'legging',
        stockQuantity: 5,
        sourceName: 'LC Fitness',
      },
    ])
    mocks.generateReply.mockResolvedValue({
      text: '1. Legging Alta Performance: cintura alta e linha discreta.',
      handoff: false,
      usage: null,
    })

    const tools = runtime({} as WacrmSupabaseClient, ['search_catalog', 'get_style_opinion'])
    const searchResult = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'search_catalog',
        arguments: JSON.stringify({ query: 'legging', category: 'legging' }),
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
              expect.objectContaining({
                type: 'image_url',
                url: 'https://cdn.example.com/legging.jpg',
              }),
            ]),
          }),
        ],
      }),
    )
  })

  it('records a structured handoff', async () => {
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
      arguments: JSON.stringify({ reason: 'Sensitive complaint details' }),
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
  })

  it('uses knowledge matches as trusted monetary data', async () => {
    const { retrieveKnowledge } = await import('../knowledge')
    vi.mocked(retrieveKnowledge).mockResolvedValue(['A taxa confirmada é 250 MZN.'])
    const tools = runtime({} as WacrmSupabaseClient, 'search_knowledge')
    await tools.executeTool({
      id: 'call-1',
      name: 'search_knowledge',
      arguments: JSON.stringify({ query: 'taxa' }),
    })

    expect(tools.getTrustedPriceAmounts()).toEqual([250])
    expect(tools.wasCatalogueVerified()).toBe(false)
  })

  it('appends account-specific instructions to only the configured tool', () => {
    const tools = createAutoReplyTools({
      db: {} as WacrmSupabaseClient,
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
      config: { provider: 'openai', model: 'test-model', apiKey: 'test-key', embeddingsApiKey: null },
      permissions: permissions('search_catalog', 'schedule_visit'),
      toolInstructions: {
        schedule_visit: 'Nesta conta, não agendamos visitas aos domingos.',
      },
    })

    expect(tools.tools.find((tool) => tool.name === 'schedule_visit')?.description)
      .toContain('Account-specific guidance: Nesta conta, não agendamos visitas aos domingos.')
    expect(tools.tools.find((tool) => tool.name === 'search_catalog')?.description)
      .not.toContain('Account-specific guidance')
  })

  it('keeps search_catalog retrieval-only and filters an explicit category', async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'legging-1',
        name: 'Legging Cintura Alta',
        description: 'Cor: preta.',
        price: 2800,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/legging.jpg',
        productUrl: null,
        category: 'legging',
        stockQuantity: 5,
        sourceName: 'LC Fitness',
      },
      {
        id: 'shirt-1',
        name: 'Camiseta Preta',
        description: 'Cor: preta.',
        price: 2000,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/shirt.jpg',
        productUrl: null,
        category: 'camiseta',
        stockQuantity: 5,
        sourceName: 'LC Fitness',
      },
    ])

    const tools = runtime({} as WacrmSupabaseClient, ['search_catalog', 'send_product'])
    const result = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'search_catalog',
        arguments: JSON.stringify({
          query: 'legging',
          category: 'legging',
          color: 'preta',
          mode: 'browse',
        }),
      }),
    )

    expect(result.products).toHaveLength(1)
    expect(result.products[0].name).toBe('Legging Cintura Alta')
    expect(tools.hasPendingActions()).toBe(false)
    expect(engineSendMedia).not.toHaveBeenCalled()
  })

  it('does not return a product already shown during browse mode', async () => {
    mocks.loadConversationCatalogState.mockResolvedValue({
      ...emptyCatalogState,
      shownProductKeys: ['lc fitness:legging-1'],
    })
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'legging-1',
        name: 'Legging A',
        description: 'Cor: preta.',
        price: 2800,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/a.jpg',
        productUrl: null,
        category: 'legging',
        stockQuantity: 2,
        sourceName: 'LC Fitness',
      },
      {
        id: 'legging-2',
        name: 'Legging B',
        description: 'Cor: preta.',
        price: 3000,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/b.jpg',
        productUrl: null,
        category: 'legging',
        stockQuantity: 2,
        sourceName: 'LC Fitness',
      },
    ])

    const tools = runtime({} as WacrmSupabaseClient, 'search_catalog')
    const result = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'search_catalog',
        arguments: JSON.stringify({ query: 'legging', category: 'legging', mode: 'browse' }),
      }),
    )

    expect(result.products.map((product: { id: string }) => product.id)).toEqual(['legging-2'])
  })

  it('sends only products explicitly chosen after retrieval', async () => {
    vi.mocked(searchCatalogues).mockResolvedValue([
      {
        id: 'legging-1',
        name: 'Legging A',
        description: 'Cor: preta.',
        price: 2800,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/a.jpg',
        productUrl: null,
        category: 'legging',
        stockQuantity: 2,
        sourceName: 'LC Fitness',
      },
      {
        id: 'legging-2',
        name: 'Legging B',
        description: 'Cor: azul.',
        price: 3000,
        currency: 'MZN',
        imageUrl: 'https://cdn.example.com/b.jpg',
        productUrl: null,
        category: 'legging',
        stockQuantity: 2,
        sourceName: 'LC Fitness',
      },
    ])
    vi.mocked(engineSendMedia).mockResolvedValue({ whatsapp_message_id: 'wamid-1' } as never)
    const db = {
      from: () => {
        const chain = {
          update: () => chain,
          eq: () => Promise.resolve({ error: null }),
        }
        return chain
      },
    } as unknown as WacrmSupabaseClient

    const tools = runtime(db, ['search_catalog', 'send_product'])
    const search = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'search_catalog',
        arguments: JSON.stringify({ query: 'legging', category: 'legging' }),
      }),
    )
    expect(tools.hasPendingActions()).toBe(false)

    await tools.executeTool({
      id: 'call-2',
      name: 'send_product',
      arguments: JSON.stringify({ product_ref: search.products[1].product_ref }),
    })
    expect(tools.hasPendingActions()).toBe(true)

    const result = await tools.dispatchPendingActions()
    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(engineSendMedia).toHaveBeenCalledTimes(1)
    expect(mocks.rememberProductsShown).toHaveBeenCalledWith(
      expect.objectContaining({ productKeys: ['lc fitness:legging-2'] }),
    )
  })

  it('continues sending remaining explicitly selected photos when one send fails', async () => {
    vi.mocked(searchCatalogues).mockResolvedValue(
      ['1', '2', '3'].map((id) => ({
        id: `legging-${id}`,
        name: `Legging ${id}`,
        description: 'Cor: preta.',
        price: 1500,
        currency: 'MZN',
        imageUrl: `https://cdn.example.com/legging-${id}.jpg`,
        productUrl: null,
        category: 'legging',
        stockQuantity: 5,
        sourceName: 'LC Fitness',
      })),
    )
    const db = {
      from: () => {
        const chain = {
          update: () => chain,
          eq: () => Promise.resolve({ error: null }),
        }
        return chain
      },
    } as unknown as WacrmSupabaseClient

    vi.mocked(engineSendMedia)
      .mockResolvedValueOnce({ whatsapp_message_id: 'wamid-1' } as never)
      .mockRejectedValueOnce(new Error('WhatsApp API error'))
      .mockResolvedValueOnce({ whatsapp_message_id: 'wamid-3' } as never)

    const tools = runtime(db, ['search_catalog', 'send_product'])
    const search = JSON.parse(
      await tools.executeTool({
        id: 'call-1',
        name: 'search_catalog',
        arguments: JSON.stringify({ query: 'legging', category: 'legging' }),
      }),
    )
    for (const product of search.products) {
      await tools.executeTool({
        id: `send-${product.id}`,
        name: 'send_product',
        arguments: JSON.stringify({ product_ref: product.product_ref }),
      })
    }

    const result = await tools.dispatchPendingActions()
    expect(result).toEqual({ sent: 2, failed: 1 })
    expect(engineSendMedia).toHaveBeenCalledTimes(3)
    expect(tools.hasPendingActions()).toBe(false)
  })
})
