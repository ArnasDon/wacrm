import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// Clone route: the source row is copied under the typed name and handed
// to the shared submit core; bad names and name clashes never reach Meta.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  source: null as Record<string, unknown> | null,
  clash: [] as unknown[],
  submit: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    const builder = (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is']) b[m] = () => b
      b.maybeSingle = async () => ({ data: table === 'message_templates' ? h.source : null, error: null })
      b.limit = async () => ({ data: h.clash, error: null })
      return b
    }
    return { supabase: { from: builder }, accountId: 'acct-1', userId: 'user-1' }
  },
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))

vi.mock('@/lib/whatsapp/channels', () => ({
  loadChannelById: async () => ({ id: 'ch-2', waba_id: 'WABA-2' }),
  loadChannelForWaba: async () => ({ id: 'ch-1', waba_id: 'WABA-1' }),
}))

vi.mock('@/lib/whatsapp/template-submit', () => ({
  submitAndSaveTemplate: (args: unknown) => {
    h.submit(args)
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  },
}))

const { POST } = await import('./route')

const ID = '11111111-2222-3333-4444-555555555555'
const call = (body: unknown) =>
  POST(
    new Request(`http://x/api/whatsapp/templates/${ID}/clone`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ID }) },
  )

beforeEach(() => {
  h.submit.mockReset()
  h.clash = []
  h.source = {
    id: ID,
    name: 'order_update',
    category: 'Utility',
    language: 'en_US',
    waba_id: 'WABA-1',
    header_type: 'text',
    header_content: 'Hi {{1}}',
    body_text: 'Your order {{1}} ships soon',
    footer_text: 'Thanks',
    buttons: [{ type: 'QUICK_REPLY', text: 'Track' }],
    sample_values: { header: ['Ann'], body: ['#42'] },
    meta_template_id: 'meta-1',
    status: 'APPROVED',
  }
})

describe('POST /api/whatsapp/templates/:id/clone', () => {
  it('copies every content field under the new name into the source WABA', async () => {
    const res = await call({ name: 'order_update_v2' })
    expect(res.status).toBe(200)
    const args = h.submit.mock.calls[0][0]
    expect(args.channel).toEqual({ id: 'ch-1', waba_id: 'WABA-1' })
    expect(args.payload).toEqual({
      name: 'order_update_v2',
      category: 'Utility',
      language: 'en_US',
      header_type: 'text',
      header_content: 'Hi {{1}}',
      header_media_url: undefined,
      body_text: 'Your order {{1}} ships soon',
      footer_text: 'Thanks',
      buttons: [{ type: 'QUICK_REPLY', text: 'Track' }],
      sample_values: { header: ['Ann'], body: ['#42'] },
    })
  })

  it('creates the copy in another channel when one is chosen', async () => {
    await call({ name: 'order_update_v2', channel_id: 'ch-2' })
    expect(h.submit.mock.calls[0][0].channel).toEqual({ id: 'ch-2', waba_id: 'WABA-2' })
  })

  it('rejects a name Meta would refuse, without calling Meta', async () => {
    const res = await call({ name: 'Order Update!' })
    expect(res.status).toBe(400)
    expect(h.submit).not.toHaveBeenCalled()
  })

  it('refuses a name that already exists in the target channel instead of overwriting it', async () => {
    h.clash = [{ id: 'other' }]
    const res = await call({ name: 'order_update' })
    expect(res.status).toBe(409)
    expect(h.submit).not.toHaveBeenCalled()
  })

  it('re-uploads a media header from its stored sample URL', async () => {
    h.source = {
      ...h.source,
      header_type: 'image',
      header_content: null,
      header_media_url: null,
      header_handle: 'https://scontent.example/sample.jpg',
      sample_values: { body: ['#42'] },
    }
    await call({ name: 'order_update_v2' })
    const payload = h.submit.mock.calls[0][0].payload
    expect(payload.header_media_url).toBe('https://scontent.example/sample.jpg')
    expect(payload.header_handle).toBeUndefined()
  })
})
