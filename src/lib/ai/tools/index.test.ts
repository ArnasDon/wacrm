import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_AGENT_TOOLS, type AgentToolKey } from '../tool-permissions'
import { createAutoReplyTools } from './index'

const mocks = vi.hoisted(() => ({
  addContactTagIfAbsent: vi.fn(),
}))

vi.mock('@/lib/contacts/tag-write', () => ({
  addContactTagIfAbsent: mocks.addContactTagIfAbsent,
}))
vi.mock('@/lib/catalog/search', () => ({ searchCatalogues: vi.fn() }))
vi.mock('../knowledge', () => ({ retrieveKnowledge: vi.fn() }))
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
) {
  return createAutoReplyTools({
    db,
    accountId: 'account-1',
    conversationId: 'conversation-1',
    contactId: 'contact-1',
    configOwnerUserId: 'user-1',
    config: { embeddingsApiKey: null },
    permissions: permissions(enabled),
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
})
