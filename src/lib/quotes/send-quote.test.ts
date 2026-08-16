import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/pdf/quote-pdf', () => ({
  renderQuotePdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}))
vi.mock('@/lib/pdf/upload-pdf', () => ({
  uploadCatalogPdf: vi.fn().mockResolvedValue('https://storage.example.com/cotizacion.pdf'),
}))
vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/send-message')>()
  return { ...actual, sendMessageToConversation: vi.fn() }
})

import { renderQuotePdf } from '@/lib/pdf/quote-pdf'
import { uploadCatalogPdf } from '@/lib/pdf/upload-pdf'
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import {
  findRecentConversation,
  isWithinMessagingWindow,
  sendQuoteToConversation,
  SendQuoteError,
} from './send-quote'

const h = vi.mocked({ renderQuotePdf, uploadCatalogPdf, sendMessageToConversation })
const sentMessage = { messageId: 'msg-1', whatsappMessageId: 'wamid-1' }

function makeSendDb(opts: {
  quote: Record<string, unknown> | null
  items?: Record<string, unknown>[]
  account?: { name: string } | null
}) {
  const updates: { table: string; payload: Record<string, unknown> }[] = []
  const db = {
    from: (table: string) => {
      if (table === 'quotes') {
        const chain: {
          select: () => typeof chain
          eq: () => typeof chain
          maybeSingle: () => Promise<{ data: unknown; error: null }>
          update: (payload: Record<string, unknown>) => {
            eq: () => typeof updateChain
          }
        } = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: opts.quote, error: null }),
          update: (payload) => {
            updates.push({ table: 'quotes', payload })
            return updateChain
          },
        }
        const updateChain = { eq: () => updateChain }
        return chain
      }
      if (table === 'quote_items') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: opts.items ?? [], error: null }),
            }),
          }),
        }
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.account ?? null, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
  return { db: db as unknown as SupabaseClient, updates }
}

beforeEach(() => {
  h.renderQuotePdf.mockClear()
  h.uploadCatalogPdf.mockClear()
  h.sendMessageToConversation.mockClear()
  h.sendMessageToConversation.mockResolvedValue(sentMessage)
})

describe('sendQuoteToConversation', () => {
  it('generates and persists a PDF when the quote has none yet', async () => {
    const { db, updates } = makeSendDb({
      quote: { id: 'q1', pdf_url: null },
      items: [{ id: 'i1', description: 'Widget', quantity: 2 }],
      account: { name: 'Acme' },
    })

    const result = await sendQuoteToConversation(db, 'acct-1', 'q1', 'conv-1')

    expect(h.renderQuotePdf).toHaveBeenCalledTimes(1)
    expect(h.uploadCatalogPdf).toHaveBeenCalledTimes(1)
    expect(result.pdfUrl).toBe('https://storage.example.com/cotizacion.pdf')
    expect(updates.some((u) => u.payload.pdf_url === result.pdfUrl)).toBe(true)
  })

  it('reuses an existing PDF instead of re-rendering one', async () => {
    const { db } = makeSendDb({ quote: { id: 'q1', pdf_url: 'https://existing.example.com/q.pdf' } })

    const result = await sendQuoteToConversation(db, 'acct-1', 'q1', 'conv-1')

    expect(h.renderQuotePdf).not.toHaveBeenCalled()
    expect(h.uploadCatalogPdf).not.toHaveBeenCalled()
    expect(result.pdfUrl).toBe('https://existing.example.com/q.pdf')
  })

  it('sends the PDF as a document and marks the quote sent', async () => {
    const { db, updates } = makeSendDb({ quote: { id: 'q1', pdf_url: 'https://existing.example.com/q.pdf' } })

    await sendQuoteToConversation(db, 'acct-1', 'q1', 'conv-1')

    expect(h.sendMessageToConversation).toHaveBeenCalledWith(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'document',
      mediaUrl: 'https://existing.example.com/q.pdf',
      filename: 'cotizacion-q1.pdf',
      contentText: 'Cotización',
    })
    const sentUpdate = updates.find((u) => 'sent_at' in u.payload)
    expect(sentUpdate?.payload).toMatchObject({ status: 'sent', auto_send_pending: false })
  })

  it('throws when the quote does not exist', async () => {
    const { db } = makeSendDb({ quote: null })
    await expect(sendQuoteToConversation(db, 'acct-1', 'missing', 'conv-1')).rejects.toBeInstanceOf(
      SendQuoteError,
    )
  })

  it('wraps a SendMessageError from the send core', async () => {
    h.sendMessageToConversation.mockRejectedValue(new SendMessageError('provider_error', 'down', 502))
    const { db } = makeSendDb({ quote: { id: 'q1', pdf_url: 'https://existing.example.com/q.pdf' } })

    await expect(sendQuoteToConversation(db, 'acct-1', 'q1', 'conv-1')).rejects.toMatchObject({
      status: 502,
      message: 'down',
    })
  })
})

function makeConversationDb(row: { id: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: row, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('findRecentConversation', () => {
  it('returns the most recent conversation row', async () => {
    const db = makeConversationDb({ id: 'conv-1' })
    expect(await findRecentConversation(db, 'acct-1', 'contact-1')).toEqual({ id: 'conv-1' })
  })

  it('returns null when the contact has no conversation', async () => {
    const db = makeConversationDb(null)
    expect(await findRecentConversation(db, 'acct-1', 'contact-1')).toBeNull()
  })
})

function makeMessagesDb(row: { created_at: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: row, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('isWithinMessagingWindow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is true when the last customer message is under 24h old', async () => {
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'))
    const db = makeMessagesDb({ created_at: '2026-08-16T00:00:00Z' })
    expect(await isWithinMessagingWindow(db, 'conv-1')).toBe(true)
  })

  it('is false when the last customer message is over 24h old', async () => {
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'))
    const db = makeMessagesDb({ created_at: '2026-08-14T00:00:00Z' })
    expect(await isWithinMessagingWindow(db, 'conv-1')).toBe(false)
  })

  it('is false when the contact never sent a message', async () => {
    const db = makeMessagesDb(null)
    expect(await isWithinMessagingWindow(db, 'conv-1')).toBe(false)
  })
})
