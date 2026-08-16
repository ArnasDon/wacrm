import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/send-message')>()
  return { ...actual, sendMessageToConversation: vi.fn() }
})

import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import { sendCatalogToConversation, SendCatalogError } from './send-catalog'

const h = vi.mocked({ sendMessageToConversation })
const sentMessage = { messageId: 'msg-1', whatsappMessageId: 'wamid-1' }

function makeDb(count: number | null) {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ count, error: null }),
        }),
      }),
    }),
  }
  return db as unknown as SupabaseClient
}

beforeEach(() => {
  h.sendMessageToConversation.mockClear()
  h.sendMessageToConversation.mockResolvedValue(sentMessage)
  process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com'
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
})

describe('sendCatalogToConversation', () => {
  it('sends a text message with a link to the account catalog page', async () => {
    const db = makeDb(2)
    const result = await sendCatalogToConversation(db, 'acct-1', 'conv-1')

    expect(result).toEqual({ catalogUrl: 'https://crm.example.com/catalog/acct-1' })
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText: expect.stringContaining('https://crm.example.com/catalog/acct-1'),
    })
  })

  it('strips a trailing slash from NEXT_PUBLIC_SITE_URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com/'
    const db = makeDb(1)
    const result = await sendCatalogToConversation(db, 'acct-1', 'conv-1')
    expect(result.catalogUrl).toBe('https://crm.example.com/catalog/acct-1')
  })

  it('throws without sending when the account has no active products', async () => {
    const db = makeDb(0)
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toBeInstanceOf(
      SendCatalogError,
    )
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('throws a clear error when NEXT_PUBLIC_SITE_URL is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    const db = makeDb(2)
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toMatchObject({
      message: expect.stringContaining('NEXT_PUBLIC_SITE_URL'),
    })
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('wraps a SendMessageError from the send core into a SendCatalogError', async () => {
    h.sendMessageToConversation.mockRejectedValue(new SendMessageError('provider_error', 'channel down', 502))
    const db = makeDb(1)
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toMatchObject({
      status: 502,
      message: 'channel down',
    })
  })
})
