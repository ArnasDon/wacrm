import { beforeEach, describe, expect, it, vi } from 'vitest'

type Json = Record<string, unknown>

const h = vi.hoisted(() => ({
  state: {
    afterPromises: [] as Promise<unknown>[],
    whatsappConfigRows: [] as Json[],
    whatsappReplayRows: [] as Json[],
    messageRows: [] as Json[],
    conversationRows: [] as Json[],
    broadcastRecipientRows: [] as Json[],
  },
  mocks: {
    findExistingContact: vi.fn(),
    runAutomationsForTrigger: vi.fn(),
    dispatchInboundToFlows: vi.fn(),
    dispatchInboundToAgent: vi.fn(),
    dispatchWebhookEvent: vi.fn(),
  },
}))

vi.mock('next/server', () => ({
  after: (fn: () => unknown | Promise<unknown>) => {
    h.state.afterPromises.push(Promise.resolve().then(fn))
  },
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}))

vi.mock('@supabase/supabase-js', () => {
  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }

  function asArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) return value
    if (value == null) return []
    return [value]
  }

  function sortRows(rows: Json[], key: string, ascending: boolean) {
    return [...rows].sort((a, b) => {
      const av = a[key]
      const bv = b[key]
      if (av === bv) return 0
      if (av == null) return ascending ? -1 : 1
      if (bv == null) return ascending ? 1 : -1
      return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
    })
  }

  function tableRows(table: string): Json[] {
    if (table === 'whatsapp_config') return h.state.whatsappConfigRows
    if (table === 'whatsapp_webhook_replays') return h.state.whatsappReplayRows
    if (table === 'messages') return h.state.messageRows
    if (table === 'conversations') return h.state.conversationRows
    if (table === 'broadcast_recipients') return h.state.broadcastRecipientRows
    return []
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select' as 'select' | 'insert' | 'update' | 'delete',
      payload: undefined as unknown,
      filters: [] as Array<(row: Json) => boolean>,
      orderBys: [] as Array<{ key: string; ascending: boolean }>,
      limit: undefined as number | undefined,
      selectOptions: undefined as { count?: 'exact'; head?: boolean } | undefined,
    }

    function apply(rows: Json[]) {
      let next = rows.filter((row) => ops.filters.every((test) => test(row)))
      for (const order of ops.orderBys) {
        next = sortRows(next, order.key, order.ascending)
      }
      if (typeof ops.limit === 'number') next = next.slice(0, ops.limit)
      return next
    }

    function finalize() {
      if (ops.table === 'whatsapp_webhook_replays' && ops.type === 'insert') {
        const row = clone(ops.payload as Json)
        const duplicate = h.state.whatsappReplayRows.some(
          (existing) => existing.dedupe_key === row.dedupe_key,
        )
        if (duplicate) {
          return {
            data: null,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' },
          }
        }
        const inserted = {
          id: `replay-${h.state.whatsappReplayRows.length + 1}`,
          ...row,
        }
        h.state.whatsappReplayRows.push(inserted)
        return { data: clone(inserted), error: null }
      }

      if (ops.table === 'messages' && ops.type === 'insert') {
        const row = {
          id: `msg-${h.state.messageRows.length + 1}`,
          created_at: '2026-07-01T10:00:00.000Z',
          ...clone(ops.payload as Json),
        }
        h.state.messageRows.push(row)
        return { data: clone(row), error: null }
      }

      if (ops.type === 'update') {
        const rows = apply(tableRows(ops.table))
        rows.forEach((row) => Object.assign(row, clone(ops.payload)))
        return { data: null, error: null }
      }

      if (ops.type === 'delete') {
        const rows = apply(tableRows(ops.table))
        if (ops.table === 'whatsapp_webhook_replays') {
          h.state.whatsappReplayRows = h.state.whatsappReplayRows.filter((row) => !rows.includes(row))
        } else if (ops.table === 'messages') {
          h.state.messageRows = h.state.messageRows.filter((row) => !rows.includes(row))
        } else if (ops.table === 'conversations') {
          h.state.conversationRows = h.state.conversationRows.filter((row) => !rows.includes(row))
        }
        return { data: null, error: null }
      }

      const rows = apply(tableRows(ops.table))
      if (ops.selectOptions?.count === 'exact') {
        return { data: null, error: null, count: rows.length }
      }
      return { data: clone(rows), error: null }
    }

    const q: Record<string, unknown> = {
      select: (_columns?: string, options?: { count?: 'exact'; head?: boolean }) => {
        ops.selectOptions = options
        return q
      },
      insert: (payload: unknown) => {
        ops.type = 'insert'
        ops.payload = payload
        return q
      },
      update: (payload: unknown) => {
        ops.type = 'update'
        ops.payload = payload
        return q
      },
      delete: () => {
        ops.type = 'delete'
        return q
      },
      eq: (key: string, value: unknown) => {
        ops.filters.push((row) => row[key] === value)
        return q
      },
      in: (key: string, values: unknown[]) => {
        ops.filters.push((row) => values.includes(row[key]))
        return q
      },
      lt: (key: string, value: unknown) => {
        ops.filters.push((row) => {
          const current = row[key]
          if (typeof current === 'string' && typeof value === 'string') {
            return current < value
          }
          if (typeof current === 'number' && typeof value === 'number') {
            return current < value
          }
          return false
        })
        return q
      },
      like: () => q,
      order: (key: string, options?: { ascending?: boolean }) => {
        ops.orderBys.push({ key, ascending: options?.ascending ?? true })
        return q
      },
      limit: (value: number) => {
        ops.limit = value
        return q
      },
      maybeSingle: () => {
        const result = finalize()
        if (result.error) return Promise.resolve(result)
        const rows = asArray<Json>(result.data as Json[] | Json | null)
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      single: () => {
        const result = finalize()
        if (result.error) return Promise.resolve(result)
        const rows = asArray<Json>(result.data as Json[] | Json | null)
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(finalize()).then(onFulfilled, onRejected),
    }

    return q
  }

  return {
    createClient: () => ({
      from: (table: string) => builder(table),
    }),
  }
})

vi.mock('@/lib/whatsapp/phone-utils', () => ({
  normalizePhone: (value: string) => value,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'test-secret',
}))

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: h.mocks.findExistingContact,
  isUniqueViolation: (error: unknown) => (error as { code?: string } | null)?.code === '23505',
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.mocks.runAutomationsForTrigger,
}))

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.mocks.dispatchInboundToFlows,
}))

vi.mock('@/lib/ai/agent-dispatch', () => ({
  dispatchInboundToAgent: h.mocks.dispatchInboundToAgent,
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.mocks.dispatchWebhookEvent,
}))

import { POST } from './route'

async function flushAfterQueue() {
  await Promise.all(h.state.afterPromises)
  h.state.afterPromises = []
}

async function waitForMockCall(mock: { mock: { calls: unknown[] } }, count = 1) {
  for (let i = 0; i < 20; i += 1) {
    if (mock.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  h.state.afterPromises = []
  h.state.whatsappConfigRows = [
    {
      id: 'cfg-1',
      account_id: 'acct-1',
      user_id: 'user-1',
      zapi_instance_id: 'inst-1',
      zapi_webhook_secret: 'enc-secret',
      status: 'connected',
      connection_status: 'CONNECTED',
    },
  ]
  h.state.whatsappReplayRows = []
  h.state.messageRows = []
  h.state.conversationRows = [
    {
      id: 'conv-1',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      unread_count: 0,
      created_at: '2026-07-01T09:00:00.000Z',
    },
  ]
  h.state.broadcastRecipientRows = []

  h.mocks.findExistingContact.mockReset()
  h.mocks.findExistingContact.mockResolvedValue({
    id: 'contact-1',
    phone: '5511999999999',
  })
  h.mocks.runAutomationsForTrigger.mockReset()
  h.mocks.runAutomationsForTrigger.mockResolvedValue(undefined)
  h.mocks.dispatchInboundToFlows.mockReset()
  h.mocks.dispatchInboundToFlows.mockResolvedValue({
    consumed: false,
    outcome: 'no_match',
  })
  h.mocks.dispatchInboundToAgent.mockReset()
  h.mocks.dispatchInboundToAgent.mockResolvedValue(undefined)
  h.mocks.dispatchWebhookEvent.mockReset()
  h.mocks.dispatchWebhookEvent.mockResolvedValue(undefined)
})

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/whatsapp/webhook?secret=test-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/whatsapp/webhook processing', () => {
  it('ignores a duplicate inbound message before dispatching flows or automations', async () => {
    h.state.messageRows = [
      {
        id: 'msg-existing',
        conversation_id: 'conv-1',
        message_id: 'wamid-dup-1',
        sender_type: 'customer',
        created_at: '2026-07-01T09:30:00.000Z',
      },
    ]

    const response = await POST(
      buildRequest({
        instanceId: 'inst-1',
        messageId: 'wamid-dup-1',
        phone: '5511999999999',
        momment: 1_719_825_600,
        text: { message: 'oi' },
      }),
    )
    await flushAfterQueue()

    expect(response.status).toBe(200)
    expect(h.mocks.findExistingContact).not.toHaveBeenCalled()
    expect(h.mocks.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.mocks.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.state.messageRows).toHaveLength(1)
  })

  it('does not fire automations when flow dispatch reports an error', async () => {
    h.mocks.dispatchInboundToFlows.mockResolvedValue({
      consumed: true,
      outcome: 'error',
      flow_run_id: 'run-1',
    })

    const response = await POST(
      buildRequest({
        instanceId: 'inst-1',
        messageId: 'wamid-new-1',
        phone: '5511999999999',
        momment: 1_719_825_600,
        text: { message: 'quero suporte' },
      }),
    )
    await flushAfterQueue()

    expect(response.status).toBe(200)
    expect(h.mocks.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.mocks.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.state.messageRows).toHaveLength(1)
  })

  it('waits for AI dispatch before completing post-response processing', async () => {
    let resolveAgent!: () => void
    const agentDone = new Promise<void>((resolve) => {
      resolveAgent = resolve
    })
    h.mocks.dispatchInboundToAgent.mockImplementation(() => agentDone)

    const response = await POST(
      buildRequest({
        type: 'ReceivedCallback',
        instanceId: 'inst-1',
        messageId: 'wamid-ai-1',
        phone: '5511999999999',
        momment: 1_719_825_600,
        text: { message: 'quero suporte' },
      }),
    )

    let afterResolved = false
    const afterDone = Promise.all(h.state.afterPromises).then(() => {
      afterResolved = true
    })
    await waitForMockCall(h.mocks.dispatchInboundToAgent)

    expect(response.status).toBe(200)
    expect(h.mocks.dispatchInboundToAgent).toHaveBeenCalledTimes(1)
    expect(afterResolved).toBe(false)

    resolveAgent()
    await afterDone

    expect(afterResolved).toBe(true)
  })

  it('does not persist DeliveryCallback events as inbound customer messages', async () => {
    const response = await POST(
      buildRequest({
        type: 'DeliveryCallback',
        instanceId: 'inst-1',
        messageId: 'wamid-delivery-1',
        phone: '5511999999999',
        momment: 1_719_825_600,
      }),
    )
    await flushAfterQueue()

    expect(response.status).toBe(200)
    expect(h.state.messageRows).toHaveLength(0)
    expect(h.mocks.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.mocks.dispatchInboundToAgent).not.toHaveBeenCalled()
  })
})
