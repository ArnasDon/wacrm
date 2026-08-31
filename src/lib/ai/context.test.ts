import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ summarizeOlderMessages: vi.fn() }))
vi.mock('./history-summary', () => ({ summarizeOlderMessages: h.summarizeOlderMessages }))

import { buildConversationContext, buildContextWithHistorySummary } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
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
})

// ------------------------------------------------------------
// buildContextWithHistorySummary — a fake DB that dispatches per table,
// since this function (unlike buildConversationContext) queries three
// different tables. `messages.select()` branches on whether `.range()`
// (the delta fetch) or `.limit()` (the final buildConversationContext
// call) gets chained; the head:true count query resolves directly via
// `.then()` since real code never chains `.order()`/`.range()`/`.limit()`
// after it.
// ------------------------------------------------------------
interface FakeMsg {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string
}

function makeHistoryDb(opts: {
  messageCount: number
  storedSummary?: string | null
  storedCovers?: number
  deltaRows?: FakeMsg[]
  rawRows?: FakeMsg[]
}) {
  const calls = { updates: [] as Record<string, unknown>[], inserts: [] as Record<string, unknown>[] }

  const db = {
    from: (table: string) => {
      if (table === 'messages') {
        return {
          select: (_cols: string, selectOpts?: { head?: boolean }) => {
            const chain: {
              eq: () => typeof chain
              order: () => typeof chain
              range: () => Promise<{ data: FakeMsg[]; error: null }>
              limit: () => Promise<{ data: FakeMsg[]; error: null }>
              then?: (resolve: (v: { count: number; error: null }) => void) => Promise<void>
            } = {
              eq: () => chain,
              order: () => chain,
              range: () => Promise.resolve({ data: opts.deltaRows ?? [], error: null }),
              limit: () => Promise.resolve({ data: opts.rawRows ?? [], error: null }),
            }
            if (selectOpts?.head) {
              chain.then = (resolve) =>
                Promise.resolve({ count: opts.messageCount, error: null }).then(resolve)
            }
            return chain
          },
        }
      }
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    ai_history_summary: opts.storedSummary ?? null,
                    ai_history_summary_covers_count: opts.storedCovers ?? 0,
                  },
                  error: null,
                }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            calls.updates.push(payload)
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'ai_usage_log') {
        return {
          insert: (row: Record<string, unknown>) => {
            calls.inserts.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
  return { db: db as unknown as SupabaseClient, calls }
}

const CONFIG = {
  provider: 'openai' as const,
  model: 'gpt-test',
  apiKey: 'sk-test',
  contextMessageLimit: 20,
  summarizeHistory: true,
}

beforeEach(() => {
  h.summarizeOlderMessages.mockReset()
})

describe('buildContextWithHistorySummary', () => {
  it('skips the count query entirely when summarizeHistory is off', async () => {
    const { db } = makeHistoryDb({ messageCount: 999, rawRows: [{ sender_type: 'customer', content_text: 'hi' }] })
    const out = await buildContextWithHistorySummary(db, 'acct-1', 'conv-1', {
      ...CONFIG,
      summarizeHistory: false,
    })
    expect(out).toEqual({ messages: [{ role: 'user', content: 'hi' }] })
    expect(h.summarizeOlderMessages).not.toHaveBeenCalled()
  })

  it('returns plain history with no summary when under the limit', async () => {
    const { db } = makeHistoryDb({
      messageCount: 5,
      rawRows: [{ sender_type: 'customer', content_text: 'hi' }],
    })
    const out = await buildContextWithHistorySummary(db, 'acct-1', 'conv-1', CONFIG)
    expect(out).toEqual({ messages: [{ role: 'user', content: 'hi' }] })
    expect(h.summarizeOlderMessages).not.toHaveBeenCalled()
  })

  it('reuses the stored summary without re-summarizing when it already covers enough', async () => {
    const { db, calls } = makeHistoryDb({
      messageCount: 25, // olderCount = 25 - 20 = 5
      storedSummary: 'Customer asked about bikes.',
      storedCovers: 5, // already covers all 5 — nothing new to fold in
      rawRows: [{ sender_type: 'customer', content_text: 'hi again' }],
    })
    const out = await buildContextWithHistorySummary(db, 'acct-1', 'conv-1', CONFIG)
    expect(out).toEqual({
      messages: [{ role: 'user', content: 'hi again' }],
      historySummary: 'Customer asked about bikes.',
    })
    expect(h.summarizeOlderMessages).not.toHaveBeenCalled()
    expect(calls.updates).toHaveLength(0)
  })

  it('summarizes only the new delta, persists it, and logs usage', async () => {
    const { db, calls } = makeHistoryDb({
      messageCount: 25, // olderCount = 5
      storedSummary: 'Earlier: asked about bikes.',
      storedCovers: 2, // 3 new messages aged out since last turn
      deltaRows: [
        { sender_type: 'customer', content_text: 'what about helmets' },
        { sender_type: 'agent', content_text: 'we have those too' },
        { sender_type: 'customer', content_text: 'great' },
      ],
      rawRows: [{ sender_type: 'customer', content_text: 'one more thing' }],
    })
    h.summarizeOlderMessages.mockResolvedValue({
      summary: 'Customer asked about bikes and helmets.',
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    })

    const out = await buildContextWithHistorySummary(db, 'acct-1', 'conv-1', CONFIG)

    expect(h.summarizeOlderMessages).toHaveBeenCalledWith({
      config: CONFIG,
      priorSummary: 'Earlier: asked about bikes.',
      newMessages: [
        { role: 'user', content: 'what about helmets' },
        { role: 'assistant', content: 'we have those too' },
        { role: 'user', content: 'great' },
      ],
    })
    expect(out).toEqual({
      messages: [{ role: 'user', content: 'one more thing' }],
      historySummary: 'Customer asked about bikes and helmets.',
    })
    expect(calls.updates).toEqual([
      {
        ai_history_summary: 'Customer asked about bikes and helmets.',
        ai_history_summary_covers_count: 5,
      },
    ])
    expect(calls.inserts).toHaveLength(1)
    expect(calls.inserts[0]).toMatchObject({ mode: 'history_summary', total_tokens: 60 })
  })

  it('falls back to the last known-good summary when summarization fails', async () => {
    const { db, calls } = makeHistoryDb({
      messageCount: 25,
      storedSummary: 'Earlier: asked about bikes.',
      storedCovers: 2,
      deltaRows: [{ sender_type: 'customer', content_text: 'what about helmets' }],
      rawRows: [{ sender_type: 'customer', content_text: 'hi' }],
    })
    h.summarizeOlderMessages.mockResolvedValue(null) // provider call failed

    const out = await buildContextWithHistorySummary(db, 'acct-1', 'conv-1', CONFIG)

    expect(out).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      historySummary: 'Earlier: asked about bikes.',
    })
    expect(calls.updates).toHaveLength(0) // nothing new persisted
    expect(calls.inserts).toHaveLength(0) // no usage to log
  })
})
