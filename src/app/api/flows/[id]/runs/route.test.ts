import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  authenticated: true,
  flow: { id: 'flow-1', name: 'Support' } as Record<string, unknown> | null,
  queriedTables: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: h.authenticated ? { id: 'user-1' } : null },
      }),
    },
    from: (table: string) => {
      h.queriedTables.push(table)
      if (table === 'flows') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.flow, error: null }),
            }),
          }),
        }
      }
      if (table === 'flow_runs') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'run-1',
                      flow_version_id: 'version-1',
                      status: 'completed',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'flow_run_events') {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [{ flow_run_id: 'run-1', event_type: 'completed' }],
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'flow_node_executions') {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: [
                  {
                    id: 'execution-1',
                    flow_run_id: 'run-1',
                    flow_version_id: 'version-1',
                    node_key: 'send',
                    node_type: 'send_message',
                    status: 'completed',
                    inputs: { text: 'hello' },
                    outputs: { whatsapp_message_id: 'wamid-1' },
                    duration_ms: 12,
                    attempt: 1,
                    error: null,
                    started_at: '2026-01-01T00:00:00.000Z',
                    completed_at: '2026-01-01T00:00:00.012Z',
                  },
                ],
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { GET } from './route'

const context = { params: Promise.resolve({ id: 'flow-1' }) }

beforeEach(() => {
  h.authenticated = true
  h.flow = { id: 'flow-1', name: 'Support' }
  h.queriedTables = []
})

describe('flow run history API', () => {
  it('includes owner-visible node execution records', async () => {
    const response = await GET(
      new Request('http://localhost/api/flows/flow-1/runs'),
      context,
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.runs[0]).toMatchObject({ flow_version_id: 'version-1' })
    expect(body.executions).toEqual([
      expect.objectContaining({
        id: 'execution-1',
        flow_run_id: 'run-1',
        flow_version_id: 'version-1',
        attempt: 1,
        status: 'completed',
      }),
    ])
  })

  it('does not query execution records when RLS hides the flow', async () => {
    h.flow = null

    const response = await GET(
      new Request('http://localhost/api/flows/flow-1/runs'),
      context,
    )

    expect(response.status).toBe(404)
    expect(h.queriedTables).not.toContain('flow_node_executions')
  })
})
