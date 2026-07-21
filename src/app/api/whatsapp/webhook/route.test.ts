import { beforeEach, describe, expect, it, vi } from 'vitest'

const afterCallbacks: Array<() => unknown> = []
const replayKeys = new Set<string>()
let replayInsertCount = 0

vi.mock('next/server', () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  },
  after(callback: () => unknown) {
    afterCallbacks.push(callback)
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from(table: string) {
      if (table === 'whatsapp_config') {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          async maybeSingle() {
            return {
              data: {
                id: 'cfg-1',
                account_id: 'acct-1',
                user_id: 'user-1',
                zapi_instance_id: 'inst-1',
                zapi_webhook_secret: 'enc-secret',
              },
              error: null,
            }
          },
        }
      }

      if (table !== 'whatsapp_webhook_replays') {
        throw new Error(`Unexpected table in webhook route test: ${table}`)
      }

      let row: Record<string, unknown> | null = null
      return {
        insert(payload: Record<string, unknown>) {
          row = payload
          return {
            select() {
              return {
                async single() {
                  const key = `${row?.session_name}:${row?.event}:${row?.dedupe_key}`
                  if (replayKeys.has(key)) {
                    return { data: null, error: { code: '23505' } }
                  }
                  replayKeys.add(key)
                  replayInsertCount += 1
                  return {
                    data: { id: `replay-${replayInsertCount}` },
                    error: null,
                  }
                },
              }
            },
          }
        },
      }
    },
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'secret-1'),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(),
}))

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(),
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(),
}))

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(),
  isUniqueViolation: (error: unknown) =>
    Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505'),
}))

import { POST } from './route'

function buildRequest(body: Record<string, unknown>, secret = 'secret-1') {
  return new Request(`http://localhost/api/whatsapp/webhook?secret=${secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/whatsapp/webhook', () => {
  beforeEach(() => {
    replayKeys.clear()
    replayInsertCount = 0
    afterCallbacks.length = 0
  })

  it('rejects a request without a URL secret', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ConnectedCallback',
          instanceId: 'inst-1',
          connected: true,
        }),
      })
    )

    expect(res.status).toBe(401)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('drops an identical request the second time without re-scheduling processing', async () => {
    const request = buildRequest({
      type: 'ConnectedCallback',
      instanceId: 'inst-1',
      connected: true,
      momment: 1_719_825_600,
    })

    const first = await POST(request.clone())
    const second = await POST(request.clone())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(afterCallbacks).toHaveLength(1)
  })

  it('keeps scheduling valid distinct status events', async () => {
    const first = await POST(
      buildRequest({
        type: 'MessageStatusCallback',
        instanceId: 'inst-1',
        status: 'SENT',
        ids: ['wamid-1'],
      })
    )
    const second = await POST(
      buildRequest({
        type: 'MessageStatusCallback',
        instanceId: 'inst-1',
        status: 'RECEIVED',
        ids: ['wamid-1'],
      })
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(afterCallbacks).toHaveLength(2)
  })
})
