import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  templateRows: [] as unknown[],
  insertedMessage: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        update: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') state.insertedMessage = row
          return builder
        },
        maybeSingle: async () => {
          if (table === 'contacts') {
            return { data: { id: 'ct-1', phone: '15551234567', wa_user_id: null }, error: null }
          }
          if (table === 'conversations') return { data: { id: 'cv-1' }, error: null }
          return { data: null, error: null }
        },
        single: async () => {
          if (table === 'whatsapp_config') {
            return { data: { phone_number_id: 'pn-1', access_token: 'token' }, error: null }
          }
          return { data: null, error: null }
        },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({
            data: table === 'message_templates' ? state.templateRows : null,
            error: null,
          }),
      }
      return builder
    },
  }),
}))

import { engineSendTemplate } from './meta-send'

type FetchResult = { ok: boolean; json: () => Promise<unknown> }

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FetchResult>>(
  async () => ({
    ok: true,
    json: async () => ({ messages: [{ id: 'wamid.auto' }] }),
  }),
)

function sentTemplate(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const init = fetchMock.mock.calls[0][1]
  return JSON.parse(String(init?.body)).template
}

const BASE_ROW = {
  id: 'tpl-1',
  user_id: 'u-1',
  name: 'order_update',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Your order {{1}} ships on {{2}}',
  created_at: '2026-01-01T00:00:00Z',
}

const SEND_ARGS = {
  accountId: 'acct-1',
  userId: 'u-1',
  conversationId: 'cv-1',
  contactId: 'ct-1',
  templateName: 'order_update',
  language: 'en_US',
  params: ['A123', 'Friday'],
}

const BODY_COMPONENT = {
  type: 'body',
  parameters: [
    { type: 'text', text: 'A123' },
    { type: 'text', text: 'Friday' },
  ],
}

beforeEach(() => {
  state.templateRows = []
  state.insertedMessage = null
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('engineSendTemplate — header component', () => {
  it.each(['image', 'video', 'document'] as const)(
    'sends the stored %s header as a header parameter',
    async (headerType) => {
      state.templateRows = [
        {
          ...BASE_ROW,
          header_type: headerType,
          header_media_url: `https://cdn.example.com/header.${headerType}`,
        },
      ]

      await engineSendTemplate(SEND_ARGS)

      expect(sentTemplate()).toEqual({
        name: 'order_update',
        language: { code: 'en_US' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: headerType,
                [headerType]: { link: `https://cdn.example.com/header.${headerType}` },
              },
            ],
          },
          BODY_COMPONENT,
        ],
      })
      expect(state.insertedMessage?.media_url).toBe(
        `https://cdn.example.com/header.${headerType}`,
      )
    },
  )

  it('fails before calling Meta when a text header variable has no value', async () => {
    state.templateRows = [
      { ...BASE_ROW, header_type: 'text', header_content: 'Hi {{1}}' },
    ]

    await expect(engineSendTemplate(SEND_ARGS)).rejects.toThrow(
      /Header text variable \{\{1\}\} requires a value/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends no header component for a static text header', async () => {
    state.templateRows = [
      { ...BASE_ROW, header_type: 'text', header_content: 'Order update' },
    ]

    await engineSendTemplate(SEND_ARGS)

    expect(sentTemplate().components).toEqual([BODY_COMPONENT])
  })
})

describe('engineSendTemplate — templates without a header keep their payload', () => {
  it('sends only the body component for a header-less template', async () => {
    state.templateRows = [BASE_ROW]

    await engineSendTemplate(SEND_ARGS)

    expect(sentTemplate()).toEqual({
      name: 'order_update',
      language: { code: 'en_US' },
      components: [BODY_COMPONENT],
    })
  })

  it('sends no components for a fully static template', async () => {
    state.templateRows = [{ ...BASE_ROW, body_text: 'Thanks for your order' }]

    await engineSendTemplate({ ...SEND_ARGS, params: [] })

    expect(sentTemplate()).toEqual({
      name: 'order_update',
      language: { code: 'en_US' },
    })
  })

  it('falls back to the body-only payload when the account has no local row', async () => {
    await engineSendTemplate(SEND_ARGS)

    expect(sentTemplate()).toEqual({
      name: 'order_update',
      language: { code: 'en_US' },
      components: [BODY_COMPONENT],
    })
  })
})
