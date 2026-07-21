import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    deal: null as Record<string, unknown> | null,
    stage: null as Record<string, unknown> | null,
    updateCalls: [] as Record<string, unknown>[],
    insertedMoves: [] as Record<string, unknown>[],
    webhookCalls: [] as unknown[],
  },
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'deals') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.state.deal, error: null }) }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            h.state.updateCalls.push(payload)
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }
          },
        }
      }
      if (table === 'pipeline_stages') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.state.stage, error: null }) }),
            }),
          }),
        }
      }
      if (table === 'ai_pipeline_moves') {
        return {
          insert: (payload: Record<string, unknown>) => {
            h.state.insertedMoves.push(payload)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: (...args: unknown[]) => {
    h.state.webhookCalls.push(args)
    return Promise.resolve()
  },
}))

import { moveDealStage } from './stage-move'

beforeEach(() => {
  h.state.deal = {
    id: 'deal-1',
    pipeline_id: 'pipe-1',
    stage_id: 'stage-A',
    contact_id: 'contact-1',
    conversation_id: 'conv-1',
  }
  h.state.stage = { id: 'stage-B', pipeline_id: 'pipe-1' }
  h.state.updateCalls = []
  h.state.insertedMoves = []
  h.state.webhookCalls = []
})

describe('moveDealStage', () => {
  it('moves the deal and logs an AI-sourced move', async () => {
    const result = await moveDealStage({
      accountId: 'acct-1',
      dealId: 'deal-1',
      toStageId: 'stage-B',
      source: 'ai',
      reason: 'customer confirmed the order',
    })
    expect(result.moved).toBe(true)
    expect(result.fromStageId).toBe('stage-A')
    expect(result.toStageId).toBe('stage-B')
    expect(h.state.updateCalls).toHaveLength(1)
    expect(h.state.updateCalls[0].stage_id).toBe('stage-B')
    expect(h.state.insertedMoves).toHaveLength(1)
    expect(h.state.insertedMoves[0]).toMatchObject({
      account_id: 'acct-1',
      deal_id: 'deal-1',
      from_stage_id: 'stage-A',
      to_stage_id: 'stage-B',
      reason: 'customer confirmed the order',
    })
    expect(h.state.webhookCalls).toHaveLength(1)
  })

  it('is a no-op when the deal is already in the target stage', async () => {
    h.state.stage = { id: 'stage-A', pipeline_id: 'pipe-1' }
    const result = await moveDealStage({
      accountId: 'acct-1',
      dealId: 'deal-1',
      toStageId: 'stage-A',
      source: 'automation',
    })
    expect(result.moved).toBe(false)
    expect(h.state.updateCalls).toHaveLength(0)
  })

  it('refuses when the target stage does not belong to the deal pipeline', async () => {
    h.state.stage = null
    const result = await moveDealStage({
      accountId: 'acct-1',
      dealId: 'deal-1',
      toStageId: 'stage-Z',
      source: 'automation',
    })
    expect(result.moved).toBe(false)
    expect(h.state.updateCalls).toHaveLength(0)
  })

  it('does not log to ai_pipeline_moves for a non-AI move', async () => {
    const result = await moveDealStage({
      accountId: 'acct-1',
      dealId: 'deal-1',
      toStageId: 'stage-B',
      source: 'automation',
    })
    expect(result.moved).toBe(true)
    expect(h.state.insertedMoves).toHaveLength(0)
  })
})
