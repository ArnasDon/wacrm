import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeTables } from '@/lib/flows/fake-db.test-helper'

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
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
    }),
  }
})

import { POST } from './route'

function setStatus(status: string) {
  return POST(
    new Request('http://localhost/api/flows/flow-1/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: 'flow-1' }) },
  )
}

beforeEach(() => {
  h.tables = {
    flows: [{ id: 'flow-1', account_id: 'acct-1', status: 'active' }],
    flow_runs: [
      { id: 'run-live', flow_id: 'flow-1', status: 'active' },
      { id: 'run-done', flow_id: 'flow-1', status: 'completed', end_reason: 'end_node' },
      { id: 'run-other', flow_id: 'flow-2', status: 'active' },
    ],
  }
})

function runById(id: string) {
  return h.tables.flow_runs.find((r) => r.id === id)
}

describe('POST /api/flows/[id]/activate', () => {
  it.each(['archived', 'draft'])('ends the active runs when the flow is set to %s', async (status) => {
    const res = await setStatus(status)
    expect(res.status).toBe(200)
    expect(runById('run-live')).toMatchObject({ status: 'cancelled', end_reason: `flow_${status}` })
    expect(runById('run-done')).toMatchObject({ status: 'completed', end_reason: 'end_node' })
    expect(runById('run-other')).toMatchObject({ status: 'active' })
  })
})
