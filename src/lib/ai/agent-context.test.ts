import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ retrieveKnowledge: vi.fn() }))
vi.mock('./knowledge/retrieve', () => ({
  retrieveKnowledge: h.retrieveKnowledge,
}))

import { attachKnowledgeToAgentContext, buildAgentContext } from './agent-context'

function fakeSupabase(data: {
  messages: {
    sender_type: string
    content_text: string | null
    content_type: string
  }[]
  deal: { id: string; stage_id: string; pipeline_id: string } | null
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: data.messages, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'deals') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: data.deal, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('buildAgentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads messages and deal information', async () => {
    const supabase = fakeSupabase({
      messages: [
        {
          sender_type: 'agent',
          content_text: 'Hi there',
          content_type: 'text',
        },
        {
          sender_type: 'customer',
          content_text: 'Hello',
          content_type: 'text',
        },
      ],
      deal: { id: 'd1', stage_id: 's1', pipeline_id: 'p1' },
    })
    const result = await buildAgentContext(supabase, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
    })
    expect(result.messages).toEqual([
      { role: 'customer', text: 'Hello' },
      { role: 'agent', text: 'Hi there' },
    ])
    expect(result.dealId).toBe('d1')
    expect(result.currentStageId).toBe('s1')
    expect(result.currentPipelineId).toBe('p1')
  })

  it('filters out non-text messages and null content', async () => {
    const supabase = fakeSupabase({
      messages: [
        {
          sender_type: 'customer',
          content_text: 'Image',
          content_type: 'image',
        },
        { sender_type: 'agent', content_text: null, content_type: 'text' },
        {
          sender_type: 'customer',
          content_text: 'Hello',
          content_type: 'text',
        },
      ],
      deal: null,
    })
    const result = await buildAgentContext(supabase, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
    })
    expect(result.messages).toEqual([{ role: 'customer', text: 'Hello' }])
    expect(result.dealId).toBeNull()
    expect(result.currentStageId).toBeNull()
    expect(result.currentPipelineId).toBeNull()
  })

  it('includes retrieved knowledge when knowledge options are provided', async () => {
    const supabase = fakeSupabase({
      messages: [
        {
          sender_type: 'customer',
          content_text: 'Can I get a refund?',
          content_type: 'text',
        },
      ],
      deal: null,
    })
    h.retrieveKnowledge.mockResolvedValue([
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: 'Refunds within 7 days',
        score: 0.8,
        mode: 'fts',
      },
    ])

    const result = await buildAgentContext(supabase, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      knowledge: {
        enabled: true,
        query: 'Can I get a refund?',
        embedding: null,
      },
    })

    expect(result.knowledge[0].chunkId).toBe('c1')
    expect(h.retrieveKnowledge).toHaveBeenCalledWith(supabase, {
      accountId: 'acct-1',
      query: 'Can I get a refund?',
      embedding: null,
    })
  })

  it('attaches knowledge to an existing context without reloading messages or deal', async () => {
    const from = vi.fn()
    const supabase = { from } as unknown as SupabaseClient
    const context = {
      messages: [{ role: 'customer' as const, text: 'Can I get a refund?' }],
      dealId: 'd1',
      currentStageId: 's1',
      currentPipelineId: 'p1',
      knowledge: [],
    }
    h.retrieveKnowledge.mockResolvedValue([
      {
        chunkId: 'c1',
        documentId: 'd1',
        content: 'Refunds within 7 days',
        score: 0.8,
        mode: 'fts',
      },
    ])

    const result = await attachKnowledgeToAgentContext(
      supabase,
      context,
      { enabled: true, query: 'Can I get a refund?', embedding: null },
      'acct-1'
    )

    expect(from).not.toHaveBeenCalled()
    expect(result.messages).toBe(context.messages)
    expect(result.dealId).toBe(context.dealId)
    expect(result.knowledge).toEqual([expect.objectContaining({ chunkId: 'c1' })])
    expect(h.retrieveKnowledge).toHaveBeenCalledWith(supabase, {
      accountId: 'acct-1',
      query: 'Can I get a refund?',
      embedding: null,
    })
  })

  it('throws when messages query returns an error', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: 'connection timeout' },
                    }),
                }),
              }),
            }),
          }
        }
        if (table === 'deals') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    await expect(
      buildAgentContext(supabase, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
      })
    ).rejects.toThrow('Failed to load messages: connection timeout')
  })

  it('throws when deals query returns an error', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'deals') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: 'database error' },
                    }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    } as unknown as SupabaseClient

    await expect(
      buildAgentContext(supabase, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
      })
    ).rejects.toThrow('Failed to load deals: database error')
  })
})
