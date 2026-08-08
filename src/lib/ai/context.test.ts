import { describe, it, expect } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { buildConversationContext } from './context'

/** Minimal fake matching the two query chains in buildConversationContext. */
function fakeDb(rows: unknown[], resetAt: string | null = null): WacrmSupabaseClient {
  const state = { table: '' }
  const chain = {
    from: (table: string) => {
      state.table = table
      return chain
    },
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    gt: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve({
      data: state.table === 'conversations' ? { ai_context_reset_at: resetAt } : null,
      error: null,
    }),
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as WacrmSupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('applies the stored AI context reset timestamp before loading messages', async () => {
    const gtCalls: unknown[][] = []
    const state = { table: '' }
    const chain = {
      from: (table: string) => {
        state.table = table
        return chain
      },
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      gt: (...args: unknown[]) => {
        gtCalls.push(args)
        return chain
      },
      order: () => chain,
      maybeSingle: () => Promise.resolve({
        data: { ai_context_reset_at: '2026-08-08T12:00:00.000Z' },
        error: null,
      }),
      limit: () => Promise.resolve({ data: [], error: null }),
    }

    await buildConversationContext(chain as unknown as WacrmSupabaseClient, 'conv-1')
    expect(gtCalls).toEqual([['created_at', '2026-08-08T12:00:00.000Z']])
  })
})
