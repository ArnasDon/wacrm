import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for POST /api/whatsapp/webhook/uazapi/[secret].
//
// The route SHA-256s the `[secret]` path segment, looks the connection up
// by `webhook_secret_hash` (+ provider='uazapi', archived_at IS NULL),
// guards on an instance/token mismatch, then hands the real work to
// `after()` and acks 200 immediately.
//
// Mocks: `next/server` (collect `after()` callbacks, capture NextResponse
// bodies), `@supabase/supabase-js` (chainable builder over
// `whatsapp_connections`), and the two pipeline entry points. The Task-1
// adapter (`uazapi-adapter`) runs for real so the assertions pin the
// actual normalized envelope shape.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  processInboundMessage: vi.fn(),
  processStatusUpdate: vi.fn(),
  state: {
    // Row the whatsapp_connections lookup resolves to (null → no match).
    connectionRow: null as Record<string, unknown> | null,
    // Row the FIX-5 `messages` ownership lookup resolves to (null → the
    // status event's messageid is NOT under this connection).
    ownedMessageRow: null as Record<string, unknown> | null,
    // The value the route passed to .eq('webhook_secret_hash', …).
    lookupHash: undefined as unknown,
    // Callbacks handed to `after()`, drained manually per the runtime.
    afterCallbacks: [] as Array<() => Promise<void> | void>,
    // Every whatsapp_connections UPDATE, with its chained filters.
    updateCalls: [] as Array<{
      patch: Record<string, unknown>
      filters: unknown[][]
    }>,
    // Error the next UPDATE resolves with, if any.
    updateError: null as { message: string } | null,
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      if (table === 'messages') {
        // FIX 5: route-level ownership guard —
        //   .select('id, conversations!inner(connection_id)')
        //   .eq('message_id', …).eq('conversations.connection_id', …)
        //   .limit(1).maybeSingle()
        const msgChain: Record<string, unknown> = {
          select: () => msgChain,
          eq: () => msgChain,
          limit: () => msgChain,
          maybeSingle: () =>
            Promise.resolve({ data: h.state.ownedMessageRow, error: null }),
        }
        return msgChain
      }
      if (table !== 'whatsapp_connections') {
        throw new Error(`unexpected table: ${table}`)
      }
      const selectChain: Record<string, unknown> = {
        eq: (col: string, val: unknown) => {
          if (col === 'webhook_secret_hash') h.state.lookupHash = val
          return selectChain
        },
        is: () => selectChain,
        maybeSingle: () =>
          Promise.resolve({ data: h.state.connectionRow, error: null }),
      }
      return {
        select: () => selectChain,
        update: (patch: Record<string, unknown>) => {
          const filters: unknown[][] = []
          const updChain: Record<string, unknown> = {
            eq: (...args: unknown[]) => {
              filters.push(['eq', ...args])
              h.state.updateCalls.push({ patch, filters })
              return Promise.resolve({ error: h.state.updateError })
            },
          }
          return updChain
        },
      }
    },
  }),
}))

vi.mock('@/lib/whatsapp/inbound/process-inbound-message', () => ({
  processInboundMessage: h.processInboundMessage,
}))
vi.mock('@/lib/whatsapp/inbound/process-status-update', () => ({
  processStatusUpdate: h.processStatusUpdate,
}))

import { POST } from './route'
import crypto from 'node:crypto'

const INSTANCE = 'inst-1'
// Real events (messages, messages_update, connection — all confirmed via
// the 1c-ii smoke) carry `instanceName: "wacrm-<account_id>"` at the top
// level; `createInstance()` names the instance that way (see
// src/app/api/whatsapp/connections/route.ts).
const INSTANCE_NAME = 'wacrm-acc-1'
const TS = 1_700_000_000_000

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    account_id: 'acc-1',
    user_id: 'user-1',
    uazapi_instance_id: INSTANCE,
    ...overrides,
  }
}

function post(payload: unknown, secret = 'raw-webhook-secret') {
  const request = { json: async () => payload } as unknown as Request
  return POST(request, { params: Promise.resolve({ secret }) })
}

async function drainAfter() {
  for (const cb of h.state.afterCallbacks) await cb()
}

let warnSpy: ReturnType<typeof vi.spyOn>
let infoSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  h.state.connectionRow = connectionRow()
  h.state.ownedMessageRow = { id: 'm-1' }
  h.state.lookupHash = undefined
  h.state.afterCallbacks = []
  h.state.updateCalls = []
  h.state.updateError = null
  h.processInboundMessage.mockResolvedValue(undefined)
  h.processStatusUpdate.mockResolvedValue(undefined)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const MESSAGE_ENVELOPE = {
  EventType: 'messages',
  instanceName: INSTANCE_NAME,
  data: {
    messageid: 'MID-1',
    chatid: '5511999999999@s.whatsapp.net',
    messageType: 'text',
    text: 'hello there',
    senderName: 'Ada',
    messageTimestamp: TS,
  },
}

describe('POST /api/whatsapp/webhook/uazapi/[secret] — auth by secret hash', () => {
  it('ignores (200) and never processes when the hash matches no connection', async () => {
    h.state.connectionRow = null

    const res = await post(MESSAGE_ENVELOPE)
    await drainAfter()

    expect(res).toEqual({ body: { status: 'ignored' }, init: { status: 200 } })
    expect(warnSpy).toHaveBeenCalledWith(
      '[uazapi webhook] secret hash matched no connection'
    )
    expect(h.state.afterCallbacks).toHaveLength(0)
    expect(h.processInboundMessage).not.toHaveBeenCalled()
  })

  it('looks the connection up by the sha256 hex of the raw [secret] segment', async () => {
    await post(MESSAGE_ENVELOPE, 'raw-webhook-secret')
    await drainAfter()

    const expected = crypto
      .createHash('sha256')
      .update('raw-webhook-secret')
      .digest('hex')
    expect(h.state.lookupHash).toBe(expected)
    expect(h.state.lookupHash).not.toBe('raw-webhook-secret')
  })
})

describe('POST /api/whatsapp/webhook/uazapi/[secret] — instance mismatch guard', () => {
  it('ignores (200) when payload.instanceName differs from wacrm-<account_id>', async () => {
    const res = await post({ ...MESSAGE_ENVELOPE, instanceName: 'wacrm-other-acct' })
    await drainAfter()

    expect(res).toEqual({ body: { status: 'ignored' }, init: { status: 200 } })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('instance mismatch')
    )
    expect(h.state.afterCallbacks).toHaveLength(0)
    expect(h.processInboundMessage).not.toHaveBeenCalled()
  })

  it('processes normally when no instanceName is present in the payload', async () => {
    const { instanceName: _omit, ...noInstanceName } = MESSAGE_ENVELOPE
    void _omit

    const res = await post(noInstanceName)
    await drainAfter()

    expect(res).toEqual({ body: { status: 'received' }, init: { status: 200 } })
    expect(h.processInboundMessage).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/whatsapp/webhook/uazapi/[secret] — fast ack + routing', () => {
  it('acks { status: received } 200 BEFORE processInboundMessage resolves', async () => {
    const res = await post(MESSAGE_ENVELOPE)

    // The response is returned with the ack; the real work is still only
    // queued in an `after()` callback.
    expect(res).toEqual({ body: { status: 'received' }, init: { status: 200 } })
    expect(h.state.afterCallbacks).toHaveLength(1)
    expect(h.processInboundMessage).not.toHaveBeenCalled()

    await drainAfter()
    expect(h.processInboundMessage).toHaveBeenCalledTimes(1)
  })

  it('EventType "messages" → processInboundMessage with the adapter envelope', async () => {
    await post(MESSAGE_ENVELOPE)
    await drainAfter()

    expect(h.processInboundMessage).toHaveBeenCalledTimes(1)
    const [dbArg, msgArg] = h.processInboundMessage.mock.calls[0]
    expect(dbArg).toBeDefined()
    expect(msgArg).toMatchObject({
      connectionId: 'conn-1',
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      providerMessageId: 'MID-1',
      from: '5511999999999',
      senderName: 'Ada',
      timestamp: new Date(TS),
      content: { kind: 'text', text: 'hello there' },
    })
    expect(h.processStatusUpdate).not.toHaveBeenCalled()
  })

  it('message with fromMe: true → skipped entirely, never processed as inbound (operator/API echo)', async () => {
    await post({
      EventType: 'messages',
      instanceName: INSTANCE_NAME,
      data: { ...MESSAGE_ENVELOPE.data, fromMe: true },
    })
    await drainAfter()

    expect(h.processInboundMessage).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('fromMe')
    )
  })

  it('singular event "message" → processInboundMessage (vocab tolerance, FIX 2)', async () => {
    await post({
      event: 'message',
      instanceName: INSTANCE_NAME,
      data: MESSAGE_ENVELOPE.data,
    })
    await drainAfter()

    expect(h.processInboundMessage).toHaveBeenCalledTimes(1)
    expect(h.processInboundMessage.mock.calls[0][1]).toMatchObject({
      providerMessageId: 'MID-1',
      content: { kind: 'text', text: 'hello there' },
    })
    expect(h.processStatusUpdate).not.toHaveBeenCalled()
  })

  it('EventType "messages_update" → processStatusUpdate with the adapter envelope', async () => {
    // FIX 5: the ownership lookup must resolve to a row for this to dispatch.
    h.state.ownedMessageRow = { id: 'm-1' }
    await post({
      EventType: 'messages_update',
      instanceName: INSTANCE_NAME,
      data: {
        messageid: 'MID-1',
        status: 'Delivered',
        messageTimestamp: TS,
      },
    })
    await drainAfter()

    expect(h.processStatusUpdate).toHaveBeenCalledTimes(1)
    expect(h.processStatusUpdate.mock.calls[0][1]).toMatchObject({
      connectionId: 'conn-1',
      accountId: 'acc-1',
      providerMessageId: 'MID-1',
      status: 'delivered',
      timestamp: new Date(TS),
    })
    expect(h.processInboundMessage).not.toHaveBeenCalled()
  })

  it('real messages_update with MessageIDs batching 2 ids → processStatusUpdate once per id', async () => {
    h.state.ownedMessageRow = { id: 'm-1' }
    await post({
      EventType: 'messages_update',
      instanceName: INSTANCE_NAME,
      event: {
        MessageIDs: ['MID-A', 'MID-B'],
        Type: 'Read',
        Timestamp: TS / 1000,
      },
    })
    await drainAfter()

    expect(h.processStatusUpdate).toHaveBeenCalledTimes(2)
    expect(
      h.processStatusUpdate.mock.calls.map((c) => c[1].providerMessageId)
    ).toEqual(['MID-A', 'MID-B'])
    for (const call of h.processStatusUpdate.mock.calls) {
      expect(call[1]).toMatchObject({ status: 'read', timestamp: new Date(TS) })
    }
  })

  it('status event whose messageid is NOT under this connection → not dispatched (FIX 5)', async () => {
    h.state.ownedMessageRow = null

    const res = await post({
      EventType: 'messages_update',
      instanceName: INSTANCE_NAME,
      data: { messageid: 'MID-OTHER', status: 'Read', messageTimestamp: TS },
    })
    await drainAfter()

    expect(res).toEqual({ body: { status: 'received' }, init: { status: 200 } })
    expect(h.processStatusUpdate).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(
      '[uazapi webhook] status update for a message not under this connection — ignoring'
    )
  })

  it('singular event "status" under this connection → processStatusUpdate once (FIX 2 + 5)', async () => {
    h.state.ownedMessageRow = { id: 'm-1' }

    await post({
      event: 'status',
      instanceName: INSTANCE_NAME,
      data: { messageid: 'MID-1', status: 'Read', messageTimestamp: TS },
    })
    await drainAfter()

    expect(h.processStatusUpdate).toHaveBeenCalledTimes(1)
    expect(h.processStatusUpdate.mock.calls[0][1]).toMatchObject({
      providerMessageId: 'MID-1',
      status: 'read',
    })
  })

  it('unknown event → 200, nothing dispatched, console.info', async () => {
    const res = await post({
      EventType: 'presence',
      instanceName: INSTANCE_NAME,
      data: {},
    })
    await drainAfter()

    expect(res).toEqual({ body: { status: 'received' }, init: { status: 200 } })
    expect(h.processInboundMessage).not.toHaveBeenCalled()
    expect(h.processStatusUpdate).not.toHaveBeenCalled()
    expect(h.state.updateCalls).toHaveLength(0)
    expect(infoSpy).toHaveBeenCalledWith(
      '[uazapi webhook] unhandled event:',
      'presence'
    )
  })

  it('literal null body → 200, no throw (FIX 7)', async () => {
    const res = await post(null)
    await drainAfter()

    expect(res).toEqual({ body: { status: 'received' }, init: { status: 200 } })
    expect(h.processInboundMessage).not.toHaveBeenCalled()
    expect(h.processStatusUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/whatsapp/webhook/uazapi/[secret] — connection events', () => {
  // Real shape (confirmed via 1c-ii smoke — a live disconnect/reconnect):
  // `{ EventType: 'connection', instance: { name, status, qrcode? },
  // instanceName, owner, token, event_id, BaseUrl }`. `instance` is an
  // OBJECT here (never a bare id string — the old guessed shape assumed
  // otherwise and rejected every real connection event). The phone once
  // connected is the top-level `owner`, not nested under `instance` or
  // `data`; no evidence of a profileName field on this event at all.
  it('state "connected" → UPDATE whatsapp_connections with the connected patch', async () => {
    await post({
      EventType: 'connection',
      instanceName: INSTANCE_NAME,
      instance: { name: INSTANCE_NAME, status: 'connected' },
      owner: '5511999999999',
    })
    await drainAfter()

    expect(h.state.updateCalls).toHaveLength(1)
    expect(h.state.updateCalls[0].patch).toEqual({
      status: 'connected',
      display_phone: '5511999999999',
      profile_name: null,
      last_connection_error: null,
    })
    expect(h.state.updateCalls[0].filters).toContainEqual(['eq', 'id', 'conn-1'])
    expect(h.processInboundMessage).not.toHaveBeenCalled()
  })

  it('a non-connected mapped state → UPDATE with status + last_connection_error only (reason not yet confirmed in the wild; fallback still exercised)', async () => {
    await post({
      EventType: 'connection',
      instanceName: INSTANCE_NAME,
      instance: {
        name: INSTANCE_NAME,
        status: 'disconnected',
        reason: 'logged out on phone',
      },
      owner: '',
    })
    await drainAfter()

    expect(h.state.updateCalls).toHaveLength(1)
    expect(h.state.updateCalls[0].patch).toEqual({
      status: 'disconnected',
      last_connection_error: 'logged out on phone',
    })
    expect(h.state.updateCalls[0].patch).not.toHaveProperty('display_phone')
  })

  it('unexpected state "weird" → no status write, console.info', async () => {
    await post({
      EventType: 'connection',
      instanceName: INSTANCE_NAME,
      instance: { name: INSTANCE_NAME, status: 'weird' },
    })
    await drainAfter()

    expect(h.state.updateCalls).toHaveLength(0)
    expect(infoSpy).toHaveBeenCalledWith(
      '[uazapi webhook] connection event, unmapped state:',
      'weird'
    )
  })
})

describe('POST /api/whatsapp/webhook/uazapi/[secret] — after() error isolation', () => {
  it('a throw inside processing is caught and logged, not surfaced', async () => {
    h.processInboundMessage.mockRejectedValueOnce(new Error('pipeline boom'))

    const res = await post(MESSAGE_ENVELOPE)
    await expect(drainAfter()).resolves.toBeUndefined()

    expect(res).toEqual({ body: { status: 'received' }, init: { status: 200 } })
    expect(errorSpy).toHaveBeenCalledWith(
      '[uazapi webhook] processing error:',
      expect.any(Error)
    )
  })
})
