import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAutomationResources } from './resources'

function fakeSupabase(data: {
  tags: { id: string; name: string }[]
  pipelines: { id: string; name: string }[]
  stages: { id: string; name: string; pipeline_id: string }[]
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'tags') {
        return { select: () => ({ eq: () => Promise.resolve({ data: data.tags, error: null }) }) }
      }
      if (table === 'pipelines') {
        return { select: () => ({ eq: () => Promise.resolve({ data: data.pipelines, error: null }) }) }
      }
      if (table === 'pipeline_stages') {
        return { select: () => ({ order: () => Promise.resolve({ data: data.stages, error: null }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('loadAutomationResources', () => {
  it('groups stages under their pipeline', async () => {
    const supabase = fakeSupabase({
      tags: [{ id: 't1', name: 'VIP' }],
      pipelines: [{ id: 'p1', name: 'Sales' }],
      stages: [
        { id: 's1', name: 'New', pipeline_id: 'p1' },
        { id: 's2', name: 'Won', pipeline_id: 'p1' },
      ],
    })
    const result = await loadAutomationResources(supabase, 'acct-1')
    expect(result.tags).toEqual([{ id: 't1', name: 'VIP' }])
    expect(result.pipelines).toEqual([
      { id: 'p1', name: 'Sales', stages: [{ id: 's1', name: 'New' }, { id: 's2', name: 'Won' }] },
    ])
  })

  it('returns empty arrays when nothing is configured', async () => {
    const supabase = fakeSupabase({ tags: [], pipelines: [], stages: [] })
    const result = await loadAutomationResources(supabase, 'acct-1')
    expect(result).toEqual({ tags: [], pipelines: [] })
  })
})
