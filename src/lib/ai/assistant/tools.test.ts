import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  loadBusinessMetrics: vi.fn(),
}))

vi.mock('@/lib/ai/business-metrics', () => ({ loadBusinessMetrics: h.loadBusinessMetrics }))
vi.mock('@/lib/google-calendar/api', () => ({
  checkFreeBusy: vi.fn(),
  APPOINTMENT_LOOKAHEAD_MS: 7 * 24 * 60 * 60 * 1000,
}))

import { ASSISTANT_TOOLS, isWriteTool, isBusinessActionTool, executeReadTool } from './tools'

/** A Supabase query-builder stand-in: every chain method returns the
 *  same thenable object, so any call sequence the code takes resolves
 *  to `result` when awaited — mirrors the fixture style already used
 *  in business-actions.test.ts, adapted for the longer chains
 *  (order/limit/ilike/or) these read tools use. */
function fakeQuery(result: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = []
  const obj: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  for (const method of ['select', 'eq', 'order', 'limit', 'ilike', 'or', 'in']) {
    obj[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return obj
    }
  }
  return { obj, calls }
}

describe('ASSISTANT_TOOLS classification', () => {
  it('every tool name is unique', () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('flags the six business actions plus create_automation_rule as write tools', () => {
    const expected = [
      'close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature',
      'create_quote', 'schedule_appointment', 'create_automation_rule',
    ]
    for (const name of expected) expect(isWriteTool(name)).toBe(true)
    expect(isWriteTool('get_business_metrics')).toBe(false)
    expect(isWriteTool('search_deals')).toBe(false)
  })

  it('excludes create_automation_rule from isBusinessActionTool (it has its own confirm path)', () => {
    expect(isBusinessActionTool('move_deal')).toBe(true)
    expect(isBusinessActionTool('create_automation_rule')).toBe(false)
  })
})

describe('executeReadTool', () => {
  it('get_business_metrics delegates to loadBusinessMetrics scoped to the account', async () => {
    h.loadBusinessMetrics.mockResolvedValueOnce({ generatedAt: 'now', contacts: {}, conversations: {}, deals: {} })
    const db = {} as SupabaseClient
    const result = await executeReadTool(db, 'acct-1', 'get_business_metrics', {})
    expect(h.loadBusinessMetrics).toHaveBeenCalledWith(db, 'acct-1')
    expect(result).toEqual({ generatedAt: 'now', contacts: {}, conversations: {}, deals: {} })
  })

  it('search_contacts scopes to account_id and returns rows', async () => {
    const { obj, calls } = fakeQuery({ data: [{ id: 'c1', name: 'Juan Pérez' }], error: null })
    const db = { from: vi.fn(() => obj) } as unknown as SupabaseClient
    const result = await executeReadTool(db, 'acct-1', 'search_contacts', { query: 'Juan' })
    expect(db.from).toHaveBeenCalledWith('contacts')
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'account_id' && c.args[1] === 'acct-1')).toBe(true)
    expect(result).toEqual([{ id: 'c1', name: 'Juan Pérez' }])
  })

  it('search_deals with no query skips the contact lookup and filters by account_id only', async () => {
    const { obj, calls } = fakeQuery({ data: [{ id: 'd1', title: 'Cotización' }], error: null })
    const db = { from: vi.fn(() => obj) } as unknown as SupabaseClient
    const result = await executeReadTool(db, 'acct-1', 'search_deals', {})
    expect(db.from).toHaveBeenCalledWith('deals')
    expect(db.from).toHaveBeenCalledTimes(1)
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'account_id')).toBe(true)
    expect(result).toEqual([{ id: 'd1', title: 'Cotización' }])
  })

  it('list_automations propagates a Supabase error as a thrown Error', async () => {
    const { obj } = fakeQuery({ data: null, error: { message: 'db down' } })
    const db = { from: vi.fn(() => obj) } as unknown as SupabaseClient
    await expect(executeReadTool(db, 'acct-1', 'list_automations', {})).rejects.toThrow('db down')
  })

  it('throws on an unknown tool name', async () => {
    const db = {} as SupabaseClient
    await expect(executeReadTool(db, 'acct-1', 'not_a_real_tool', {})).rejects.toThrow(/unknown read tool/i)
  })
})
