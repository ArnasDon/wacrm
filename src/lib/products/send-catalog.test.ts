import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/send-message')>()
  return { ...actual, sendMessageToConversation: vi.fn() }
})

import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message'
import { sendCatalogToConversation, SendCatalogError } from './send-catalog'
import { signCatalogConversation } from './catalog-link-token'

const h = vi.mocked({ sendMessageToConversation })
const sentMessage = { messageId: 'msg-1', whatsappMessageId: 'wamid-1' }

interface AccountRow {
  catalog_delivery_mode: 'digital' | 'pdf' | 'photos'
  catalog_pdf_url: string | null
  catalog_photo_urls: string[]
}

function makeDb(args: { account?: Partial<AccountRow>; activeProductCount?: number | null }) {
  const account: AccountRow = {
    catalog_delivery_mode: 'digital',
    catalog_pdf_url: null,
    catalog_photo_urls: [],
    ...args.account,
  }
  const db = {
    from: (table: string) => {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: account, error: null }),
            }),
          }),
        }
      }
      // 'products' — the digital-mode active-count check.
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ count: args.activeProductCount ?? 0, error: null }),
          }),
        }),
      }
    },
  }
  return db as unknown as SupabaseClient
}

beforeEach(() => {
  h.sendMessageToConversation.mockClear()
  h.sendMessageToConversation.mockResolvedValue(sentMessage)
  process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com'
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'a'.repeat(64)
})

/** The catalog link's `?c=` value is `<conversationId>.<hmac>` — build
 *  the expected token via the same signer the code uses. */
const cParam = (conversationId: string) => signCatalogConversation(conversationId)
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
})

describe('sendCatalogToConversation — digital mode (default)', () => {
  it('sends a text message with a link to the account catalog page', async () => {
    const db = makeDb({ activeProductCount: 2 })
    const result = await sendCatalogToConversation(db, 'acct-1', 'conv-1')

    expect(result).toEqual({
      catalogUrl: `https://crm.example.com/catalog/acct-1?c=${cParam('conv-1')}`,
    })
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText: expect.stringContaining(
        `https://crm.example.com/catalog/acct-1?c=${cParam('conv-1')}`,
      ),
    })
  })

  it('strips a trailing slash from NEXT_PUBLIC_SITE_URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com/'
    const db = makeDb({ activeProductCount: 1 })
    const result = await sendCatalogToConversation(db, 'acct-1', 'conv-1')
    expect(result.catalogUrl).toBe(
      `https://crm.example.com/catalog/acct-1?c=${cParam('conv-1')}`,
    )
  })

  it('carries a signed conversation id in the catalog URL so the quote-request route can deliver back onto the right channel', async () => {
    const db = makeDb({ activeProductCount: 1 })
    const result = await sendCatalogToConversation(db, 'acct-1', 'conv-ig-1')
    expect(result.catalogUrl).toBe(
      `https://crm.example.com/catalog/acct-1?c=${cParam('conv-ig-1')}`,
    )
    // token is `<id>.<hmac>`, not the bare id
    expect(result.catalogUrl).toContain('?c=conv-ig-1.')
  })

  it('throws without sending when the account has no active products', async () => {
    const db = makeDb({ activeProductCount: 0 })
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toBeInstanceOf(
      SendCatalogError,
    )
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('throws a clear error when NEXT_PUBLIC_SITE_URL is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    const db = makeDb({ activeProductCount: 2 })
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toMatchObject({
      message: expect.stringContaining('NEXT_PUBLIC_SITE_URL'),
    })
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('wraps a SendMessageError from the send core into a SendCatalogError', async () => {
    h.sendMessageToConversation.mockRejectedValue(new SendMessageError('provider_error', 'channel down', 502))
    const db = makeDb({ activeProductCount: 1 })
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toMatchObject({
      status: 502,
      message: 'channel down',
    })
  })
})

describe('sendCatalogToConversation — pdf mode', () => {
  it('sends the uploaded catalog PDF as a document, no link', async () => {
    const db = makeDb({
      account: { catalog_delivery_mode: 'pdf', catalog_pdf_url: 'https://storage.example.com/catalogo.pdf' },
    })
    const result = await sendCatalogToConversation(db, 'acct-1', 'conv-1')

    expect(result).toEqual({ catalogUrl: null })
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'document',
      mediaUrl: 'https://storage.example.com/catalogo.pdf',
      filename: 'Catalogo.pdf',
    })
  })

  it('throws a clear error when no PDF has been uploaded yet', async () => {
    const db = makeDb({ account: { catalog_delivery_mode: 'pdf', catalog_pdf_url: null } })
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toMatchObject({
      message: expect.stringContaining('none has been uploaded'),
    })
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })
})

describe('sendCatalogToConversation — photos mode', () => {
  it('sends every uploaded photo in order, no link', async () => {
    const db = makeDb({
      account: {
        catalog_delivery_mode: 'photos',
        catalog_photo_urls: ['https://storage.example.com/1.jpg', 'https://storage.example.com/2.jpg'],
      },
    })
    const result = await sendCatalogToConversation(db, 'acct-1', 'conv-1')

    expect(result).toEqual({ catalogUrl: null })
    expect(h.sendMessageToConversation).toHaveBeenNthCalledWith(1, db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'image',
      mediaUrl: 'https://storage.example.com/1.jpg',
    })
    expect(h.sendMessageToConversation).toHaveBeenNthCalledWith(2, db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'image',
      mediaUrl: 'https://storage.example.com/2.jpg',
    })
  })

  it('throws a clear error when no photos have been uploaded yet', async () => {
    const db = makeDb({ account: { catalog_delivery_mode: 'photos', catalog_photo_urls: [] } })
    await expect(sendCatalogToConversation(db, 'acct-1', 'conv-1')).rejects.toMatchObject({
      message: expect.stringContaining('none have been uploaded'),
    })
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })
})
