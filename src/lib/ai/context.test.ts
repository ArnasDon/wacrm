import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[], filters?: { includedTypes?: string[] }): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: (_column: string, values: string[]) => {
      if (filters) filters.includedTypes = values
      return chain
    },
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

  it('includes rendered templates so the AI remembers automation sends', async () => {
    const filters: { includedTypes?: string[] } = {}
    const out = await buildConversationContext(
      fakeDb(
        [{ sender_type: 'bot', content_text: 'Hello Ana, your appointment is tomorrow.' }],
        filters,
      ),
      'conv-1',
    )

    expect(filters.includedTypes).toEqual(['text', 'template'])
    expect(out).toEqual([
      {
        role: 'assistant',
        content: 'Hello Ana, your appointment is tomorrow.',
      },
    ])
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

  describe('inbound customer photos (with an image resolver)', () => {
    const img = { mimeType: 'image/jpeg', dataBase64: 'AAAA' }

    it('without a resolver, image rows are excluded (unchanged behaviour)', async () => {
      const filters: { includedTypes?: string[] } = {}
      const out = await buildConversationContext(
        fakeDb(
          [
            { sender_type: 'customer', content_type: 'image', content_text: 'mira', media_url: '/api/whatsapp/media/x' },
            { sender_type: 'customer', content_type: 'text', content_text: 'hola' },
          ],
          filters,
        ),
        'conv-1',
      )
      expect(filters.includedTypes).toEqual(['text', 'template'])
      expect(out).toEqual([{ role: 'user', content: 'hola' }])
    })

    it('attaches a downloaded photo to the turn and keeps the caption as text', async () => {
      const filters: { includedTypes?: string[] } = {}
      const resolver = async () => img
      const out = await buildConversationContext(
        fakeDb(
          [{ sender_type: 'customer', content_type: 'image', content_text: 'este modelo', media_url: '/api/whatsapp/media/x', media_type: 'image/jpeg' }],
          filters,
        ),
        'conv-1',
        undefined,
        resolver,
      )
      expect(filters.includedTypes).toEqual(['text', 'template', 'image'])
      expect(out).toEqual([{ role: 'user', content: 'este modelo', images: [img] }])
    })

    it('uses a placeholder when the photo had no caption', async () => {
      const out = await buildConversationContext(
        fakeDb([{ sender_type: 'customer', content_type: 'image', content_text: null, media_url: '/api/whatsapp/media/x' }]),
        'conv-1',
        undefined,
        async () => img,
      )
      expect(out).toEqual([
        { role: 'user', content: '(El cliente envió una foto.)', images: [img] },
      ])
    })

    it('drops an image row entirely when the download fails', async () => {
      const out = await buildConversationContext(
        fakeDb([
          { sender_type: 'customer', content_type: 'image', content_text: null, media_url: '/api/whatsapp/media/x' },
          { sender_type: 'customer', content_type: 'text', content_text: 'seguime ayudando' },
        ]),
        'conv-1',
        undefined,
        async () => null,
      )
      expect(out).toEqual([{ role: 'user', content: 'seguime ayudando' }])
    })

    it('never attaches a bot/agent image as a customer photo', async () => {
      const resolver = vi.fn(async () => img)
      const out = await buildConversationContext(
        fakeDb([{ sender_type: 'bot', content_type: 'image', content_text: 'aquí tienes', media_url: '/api/whatsapp/media/x' }]),
        'conv-1',
        undefined,
        resolver,
      )
      expect(resolver).not.toHaveBeenCalled()
      expect(out).toEqual([])
    })
  })
})
