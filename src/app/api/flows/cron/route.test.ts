import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeTables } from '@/lib/flows/fake-db.test-helper'

const HOUR = 60 * 60 * 1000

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcError: null as { message: string } | null,
}))

vi.mock('@/lib/flows/admin-client', async () => {
  const { createFakeDb } = await import('@/lib/flows/fake-db.test-helper')
  return {
    supabaseAdmin: () => ({
      ...createFakeDb(h.tables as FakeTables),
      rpc: async (name: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ name, args })
        if (h.rpcError) return { data: null, error: h.rpcError }
        const now = new Date(args.p_now as string).getTime()
        const flows = new Map(h.tables.flows.map((f) => [f.id, f]))
        const due = h.tables.flow_runs
          .filter((r) => r.status === 'active')
          .map((r) => {
            const policy = flows.get(r.flow_id)?.fallback_policy as
              | { on_timeout_hours?: number }
              | undefined
            return { r, hours: policy?.on_timeout_hours ?? 24 }
          })
          .filter(({ r, hours }) => now - new Date(r.last_advanced_at as string).getTime() >= hours * HOUR)
          .sort((a, b) => String(a.r.last_advanced_at).localeCompare(String(b.r.last_advanced_at)))
          .slice(0, args.p_limit as number)
          .map(({ r }) => ({
            id: r.id,
            last_advanced_at: r.last_advanced_at,
            fallback_policy: flows.get(r.flow_id)?.fallback_policy ?? null,
          }))
        return { data: due, error: null }
      },
    }),
  }
})

import { GET } from './route'

function call() {
  return GET(
    new Request('http://localhost/api/flows/cron', {
      headers: { 'x-cron-secret': 'cron-secret' },
    }),
  )
}

function runs(count: number, ageHours: number, flowId = 'flow-1') {
  return Array.from({ length: count }, (_, i) => ({
    id: `${flowId}-run-${ageHours}-${i}`,
    flow_id: flowId,
    status: 'active',
    last_advanced_at: new Date(Date.now() - ageHours * HOUR - i * 1000).toISOString(),
  }))
}

beforeEach(() => {
  process.env.AUTOMATION_CRON_SECRET = 'cron-secret'
  h.rpcCalls = []
  h.rpcError = null
  h.tables = {
    flows: [
      { id: 'flow-1', fallback_policy: { on_timeout_hours: 24 } },
      { id: 'flow-2', fallback_policy: { on_timeout_hours: 1 } },
    ],
    flow_runs: [],
    flow_run_events: [],
  }
})

describe('GET /api/flows/cron', () => {
  it('asks the database only for runs already past their timeout', async () => {
    h.tables.flow_runs = [...runs(2, 2), ...runs(1, 2, 'flow-2'), ...runs(1, 30)]
    const res = await call()
    expect(await res.json()).toEqual({ swept: 2 })
    expect(h.rpcCalls[0]).toMatchObject({
      name: 'list_timed_out_flow_runs',
      args: { p_limit: 500 },
    })
    const statuses = h.tables.flow_runs.map((r) => r.status)
    expect(statuses).toEqual(['active', 'active', 'timed_out', 'timed_out'])
    expect(h.tables.flow_run_events).toHaveLength(2)
  })

  it('pages past the first batch instead of stopping at one response', async () => {
    h.tables.flow_runs = runs(1200, 30)
    const res = await call()
    expect(await res.json()).toEqual({ swept: 1200 })
    expect(h.rpcCalls).toHaveLength(3)
    expect(h.tables.flow_runs.every((r) => r.status === 'timed_out')).toBe(true)
  })

  it('reports a failed scan', async () => {
    h.rpcError = { message: 'function missing' }
    const res = await call()
    expect(res.status).toBe(500)
  })
})
