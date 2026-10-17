import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeTables } from '@/lib/flows/fake-db.test-helper'

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpc: vi.fn(async () => ({ data: 0, error: null })),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({})),
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

vi.mock('@/lib/flows/admin-client', async () => {
  const { createFakeDb } = await import('@/lib/flows/fake-db.test-helper')
  return { supabaseAdmin: () => createFakeDb(h.tables as FakeTables) }
})

vi.mock('@/lib/supabase/server', async () => {
  const { createFakeDb } = await import('@/lib/flows/fake-db.test-helper')
  return {
    createClient: async () => ({
      ...createFakeDb(h.tables as FakeTables),
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
      rpc: h.rpc,
    }),
  }
})

import { PUT } from './route'

const VALID_NODES = [
  { node_key: 'start', node_type: 'start', config: { next_node_key: 'bye' } },
  { node_key: 'bye', node_type: 'end', config: {} },
]

const DANGLING_NODES = [
  { node_key: 'start', node_type: 'start', config: { next_node_key: 'gone' } },
]

function seed(status: string) {
  h.tables = {
    flows: [
      {
        id: 'flow-1',
        account_id: 'acct-1',
        name: 'Welcome',
        status,
        trigger_type: 'keyword',
        trigger_config: { keywords: ['hi'] },
        entry_node_id: 'start',
      },
    ],
    flow_nodes: VALID_NODES.map((n) => ({ ...n, flow_id: 'flow-1' })),
  }
}

function put(body: unknown) {
  return PUT(
    new Request('http://localhost/api/flows/flow-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'flow-1' }) },
  )
}

beforeEach(() => {
  h.rpc.mockClear()
})

describe('PUT /api/flows/[id]', () => {
  it('rejects an invalid graph on a live flow without touching nodes', async () => {
    seed('active')
    const res = await put({ entry_node_id: 'start', nodes: DANGLING_NODES })
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/live/)
    expect(json.issues.some((i: { severity: string }) => i.severity === 'error')).toBe(true)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('validates a header-only save on a live flow against the stored nodes', async () => {
    seed('active')
    const res = await put({ entry_node_id: 'missing' })
    expect(res.status).toBe(422)
  })

  it('replaces nodes atomically through the RPC when the graph is valid', async () => {
    seed('active')
    const res = await put({ nodes: VALID_NODES })
    expect(res.status).toBe(200)
    expect(h.rpc).toHaveBeenCalledWith('replace_flow_graph', {
      p_flow_id: 'flow-1',
      p_nodes: VALID_NODES.map((n) => ({ ...n, position_x: 0, position_y: 0 })),
      p_flow: {},
    })
  })

  it('swaps the entry node in the same RPC as the nodes it points at', async () => {
    seed('active')
    const nodes = [
      { node_key: 'hello', node_type: 'start', config: { next_node_key: 'bye' } },
      { node_key: 'bye', node_type: 'end', config: {} },
    ]
    const res = await put({ name: ' Renamed ', entry_node_id: 'hello', nodes })
    expect(res.status).toBe(200)
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('replace_flow_graph', {
      p_flow_id: 'flow-1',
      p_nodes: nodes.map((n) => ({ ...n, position_x: 0, position_y: 0 })),
      p_flow: { name: 'Renamed', entry_node_id: 'hello' },
    })
    expect(h.tables.flows[0]).toMatchObject({ name: 'Welcome', entry_node_id: 'start' })
  })

  it('updates header-only saves directly without the RPC', async () => {
    seed('draft')
    const res = await put({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.tables.flows[0]).toMatchObject({ name: 'Renamed' })
  })

  it('lets a draft save an incomplete graph', async () => {
    seed('draft')
    const res = await put({ nodes: DANGLING_NODES })
    expect(res.status).toBe(200)
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([99999999, 0, -1, '24'])('rejects on_timeout_hours %s before saving', async (hours) => {
    seed('draft')
    const res = await put({ fallback_policy: { on_timeout_hours: hours } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/on_timeout_hours/)
    expect(h.tables.flows[0]).not.toHaveProperty('fallback_policy')
  })

  it('saves a bounded on_timeout_hours', async () => {
    seed('draft')
    const res = await put({ fallback_policy: { on_timeout_hours: 48 } })
    expect(res.status).toBe(200)
    expect(h.tables.flows[0]).toMatchObject({ fallback_policy: { on_timeout_hours: 48 } })
  })
})
