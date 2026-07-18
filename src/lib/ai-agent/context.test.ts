import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Query = {
  table: string
  filters: Array<[column: string, operator: 'eq' | 'in', value: unknown]>
  orders: Array<{ column: string; ascending: boolean }>
  limit?: number
  select?: string
}

const h = vi.hoisted(() => ({
  state: {
    rows: {} as Record<string, Row[]>,
    errors: {} as Record<string, string | undefined>,
    queries: [] as Query[],
  },
}))

vi.mock('../flows/admin-client', () => {
  function builder(table: string) {
    const query: Query = { table, filters: [], orders: [] }

    const result = () => {
      const errorMessage = h.state.errors[table]
      let rows = [...(h.state.rows[table] ?? [])]

      for (const [column, operator, value] of query.filters) {
        rows = rows.filter((row) => operator === 'eq'
          ? row[column] === value
          : (value as unknown[]).includes(row[column]))
      }

      for (const { column, ascending } of query.orders) {
        rows.sort((left, right) => {
          const comparison = String(left[column] ?? '').localeCompare(String(right[column] ?? ''))
          return ascending ? comparison : -comparison
        })
      }

      if (query.limit !== undefined) rows = rows.slice(0, query.limit)
      h.state.queries.push({ ...query, filters: [...query.filters], orders: [...query.orders] })

      return { data: rows, error: errorMessage ? { message: errorMessage } : null }
    }

    const client = {
      select: (value: string) => {
        query.select = value
        return client
      },
      eq: (column: string, value: unknown) => {
        query.filters.push([column, 'eq', value])
        return client
      },
      in: (column: string, value: unknown[]) => {
        query.filters.push([column, 'in', value])
        return client
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        query.orders.push({ column, ascending: options?.ascending ?? true })
        return client
      },
      limit: (value: number) => {
        query.limit = value
        return client
      },
      maybeSingle: async () => {
        const { data, error } = result()
        return { data: data[0] ?? null, error }
      },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    }

    return client
  }

  return { supabaseAdmin: () => ({ from: builder }) }
})

import { buildAiAgentContext } from './context'

const accountId = 'account-1'
const conversationId = 'conversation-1'
const contactId = 'contact-1'

beforeEach(() => {
  h.state.rows = {
    conversations: [conversation()],
    messages: [
      message({ id: 'message-3', created_at: '2026-07-17T12:03:00.000Z' }),
      message({ id: 'message-1', created_at: '2026-07-17T12:01:00.000Z' }),
      message({ id: 'other-account-message', conversation_id: 'other-conversation' }),
    ],
    deals: [],
    pipelines: [],
    pipeline_stages: [],
  }
  h.state.errors = {}
  h.state.queries = []
})

describe('buildAiAgentContext', () => {
  it('scopes the conversation lookup by account and id and returns no unrelated rows', async () => {
    h.state.rows.conversations.push(conversation({ id: 'other-conversation', account_id: 'other-account' }))

    const context = await buildAiAgentContext(input())

    expect(queryFor('conversations').filters).toEqual(expect.arrayContaining([
      ['account_id', 'eq', accountId],
      ['id', 'eq', conversationId],
    ]))
    expect(queryFor('conversations').select).toContain('contact:contacts(id, phone, name, email, company)')
    expect(context.conversation.id).toBe(conversationId)
    expect(context.messages).not.toContainEqual(expect.objectContaining({ id: 'other-account-message' }))
  })

  it('loads messages newest first from the database but returns them oldest-to-newest within maxMessages', async () => {
    h.state.rows.messages.push(message({ id: 'message-2', created_at: '2026-07-17T12:02:00.000Z' }))

    const context = await buildAiAgentContext(input({ maxMessages: 2 }))

    expect(queryFor('messages').orders).toContainEqual({ column: 'created_at', ascending: false })
    expect(queryFor('messages').limit).toBe(2)
    expect(context.messages.map((item) => item.id)).toEqual(['message-2', 'message-3'])
  })

  it('uses at least one message when maxMessages is zero', async () => {
    await buildAiAgentContext(input({ maxMessages: 0 }))

    expect(queryFor('messages').limit).toBe(1)
  })

  it('prefers a conversation-linked active deal over the contact fallback', async () => {
    h.state.rows.deals = [
      deal({ id: 'contact-deal', conversation_id: null }),
      deal({ id: 'conversation-deal', conversation_id: conversationId }),
    ]

    const context = await buildAiAgentContext(input())

    expect(context.activeDeal?.id).toBe('conversation-deal')
    expect(queriesFor('deals')).toHaveLength(1)
    expect(queryFor('deals').filters).toContainEqual(['conversation_id', 'eq', conversationId])
  })

  it('uses a contact-linked active deal when no conversation-linked active deal exists', async () => {
    h.state.rows.deals = [deal({ id: 'contact-deal', conversation_id: null })]

    const context = await buildAiAgentContext(input())

    expect(context.activeDeal?.id).toBe('contact-deal')
    expect(queriesFor('deals')).toHaveLength(2)
    expect(queriesFor('deals')[1].filters).toEqual(expect.arrayContaining([
      ['account_id', 'eq', accountId],
      ['contact_id', 'eq', contactId],
      ['status', 'in', ['open', 'active']],
    ]))
  })

  it('returns pipelines with their stages grouped and sorted by position', async () => {
    h.state.rows.pipelines = [
      pipeline({ id: 'pipeline-2', name: 'Sales', created_at: '2026-07-17T12:02:00.000Z' }),
      pipeline({ id: 'pipeline-1', name: 'Support', created_at: '2026-07-17T12:01:00.000Z' }),
    ]
    h.state.rows.pipeline_stages = [
      stage({ id: 'stage-2', pipeline_id: 'pipeline-1', position: 2 }),
      stage({ id: 'stage-1', pipeline_id: 'pipeline-1', position: 1 }),
      stage({ id: 'stage-3', pipeline_id: 'pipeline-2', position: 1 }),
      stage({ id: 'other-stage', pipeline_id: 'other-pipeline', position: 1 }),
    ]

    const context = await buildAiAgentContext(input())

    expect(context.pipelines).toEqual([
      expect.objectContaining({ id: 'pipeline-1', stages: [expect.objectContaining({ id: 'stage-1' }), expect.objectContaining({ id: 'stage-2' })] }),
      expect.objectContaining({ id: 'pipeline-2', stages: [expect.objectContaining({ id: 'stage-3' })] }),
    ])
    expect(queryFor('pipeline_stages').filters).toContainEqual(['pipeline_id', 'in', ['pipeline-1', 'pipeline-2']])
  })

  it('does not query stages when the account has no pipelines', async () => {
    const context = await buildAiAgentContext(input())

    expect(context.pipelines).toEqual([])
    expect(queriesFor('pipeline_stages')).toHaveLength(0)
  })

  it.each([
    ['conversations', 'AI conversation context lookup failed: database unavailable'],
    ['messages', 'AI message context lookup failed: database unavailable'],
    ['deals', 'AI deal context lookup failed: database unavailable'],
    ['pipelines', 'AI pipeline context lookup failed: database unavailable'],
    ['pipeline_stages', 'AI pipeline stage context lookup failed: database unavailable'],
  ])('throws the required error for %s lookup failures', async (table, expected) => {
    if (table === 'pipeline_stages') h.state.rows.pipelines = [pipeline()]
    h.state.errors[table] = 'database unavailable'

    await expect(buildAiAgentContext(input())).rejects.toThrow(expected)
  })

  it('throws when the scoped conversation does not exist', async () => {
    h.state.rows.conversations = [conversation({ id: 'other-conversation' })]

    await expect(buildAiAgentContext(input())).rejects.toThrow('AI conversation context not found')
  })
})

function input(overrides: Partial<Parameters<typeof buildAiAgentContext>[0]> = {}) {
  return { accountId, conversationId, maxMessages: 10, ...overrides }
}

function queryFor(table: string) {
  const query = queriesFor(table)[0]
  if (!query) throw new Error(`Expected query for ${table}`)
  return query
}

function queriesFor(table: string) {
  return h.state.queries.filter((query) => query.table === table)
}

function conversation(overrides: Row = {}): Row {
  return {
    id: conversationId,
    account_id: accountId,
    contact_id: contactId,
    status: 'open',
    assigned_agent_id: null,
    last_message_text: 'Hello',
    last_message_at: '2026-07-17T12:03:00.000Z',
    created_at: '2026-07-17T12:00:00.000Z',
    updated_at: '2026-07-17T12:03:00.000Z',
    contact: { id: contactId, phone: '+5511999999999', name: 'Ada', email: 'ada@example.com', company: 'Acme' },
    ...overrides,
  }
}

function message(overrides: Row = {}): Row {
  return {
    id: 'message-1',
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'Hello',
    media_url: null,
    message_id: null,
    created_at: '2026-07-17T12:01:00.000Z',
    ...overrides,
  }
}

function deal(overrides: Row = {}): Row {
  return {
    id: 'deal-1',
    account_id: accountId,
    pipeline_id: 'pipeline-1',
    stage_id: 'stage-1',
    contact_id: contactId,
    conversation_id: conversationId,
    title: 'Expansion',
    value: 1250,
    currency: 'BRL',
    expected_close_date: null,
    status: 'open',
    created_at: '2026-07-17T12:00:00.000Z',
    ...overrides,
  }
}

function pipeline(overrides: Row = {}): Row {
  return { id: 'pipeline-1', account_id: accountId, name: 'Support', created_at: '2026-07-17T12:00:00.000Z', ...overrides }
}

function stage(overrides: Row = {}): Row {
  return { id: 'stage-1', pipeline_id: 'pipeline-1', name: 'New', position: 1, color: '#00aa00', ...overrides }
}
