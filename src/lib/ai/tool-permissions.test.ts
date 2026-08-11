import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_AGENT_TOOLS, loadAgentToolPermissions } from './tool-permissions'

function dbReturning(rows: Array<{ tool_key: string; enabled: boolean; instructions?: string | null }>) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    then: (resolve: (result: { data: typeof rows; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  }
  return chain as unknown as WacrmSupabaseClient
}

describe('DEFAULT_AGENT_TOOLS', () => {
  it('does not enable get_style_opinion by default (fashion-specific, opt-in like other business-specific tools)', () => {
    expect(DEFAULT_AGENT_TOOLS.get_style_opinion).toBe(false)
  })
})

describe('loadAgentToolPermissions', () => {
  it('falls back to platform defaults with no per-tool instructions when there are no rows', async () => {
    const result = await loadAgentToolPermissions(dbReturning([]), 'acct-1', 'agent-1')
    expect(result.permissions).toEqual(DEFAULT_AGENT_TOOLS)
    expect(result.instructions).toEqual({})
  })

  it('applies explicit enabled overrides and collects non-empty instructions per tool', async () => {
    const result = await loadAgentToolPermissions(
      dbReturning([
        { tool_key: 'get_style_opinion', enabled: true, instructions: null },
        { tool_key: 'schedule_visit', enabled: true, instructions: '  Nesta conta, não agendamos aos domingos.  ' },
        { tool_key: 'create_deal', enabled: false, instructions: '' },
      ]),
      'acct-1',
      'agent-1',
    )
    expect(result.permissions.get_style_opinion).toBe(true)
    expect(result.permissions.schedule_visit).toBe(true)
    expect(result.permissions.create_deal).toBe(false)
    expect(result.instructions).toEqual({
      schedule_visit: 'Nesta conta, não agendamos aos domingos.',
    })
  })
})
