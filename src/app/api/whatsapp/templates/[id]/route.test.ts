import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// DELETE /api/whatsapp/templates/:id — Meta permission refusals are
// explained and can fall back to removing the row locally.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  deleteMeta: vi.fn(),
  localDeletes: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.delete = () => {
        h.localDeletes++
        return { eq: async () => ({ error: null }) }
      }
      b.maybeSingle = async () =>
        table === 'profiles'
          ? { data: { account_id: 'acct-1' }, error: null }
          : {
              data: { id: ID, name: 'promo', meta_template_id: 'meta-1', waba_id: 'WABA-1' },
              error: null,
            }
      return b
    },
  }),
}))
vi.mock('@/lib/whatsapp/channels', () => ({
  loadChannelForWaba: async () => ({ waba_id: 'WABA-1', access_token: 'enc' }),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'tok' }))
vi.mock('@/lib/whatsapp/meta-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/meta-api')>()),
  deleteMessageTemplate: h.deleteMeta,
}))

const ID = '11111111-2222-3333-4444-555555555555'
const { DELETE } = await import('./route')
const { MetaApiError } = await import('@/lib/whatsapp/meta-api')

const call = (query = '') =>
  DELETE(new Request(`http://x/api/whatsapp/templates/${ID}${query}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id: ID }),
  })

beforeEach(() => {
  h.deleteMeta.mockReset()
  h.localDeletes = 0
})

describe('DELETE /api/whatsapp/templates/:id', () => {
  it('deletes on Meta, then locally', async () => {
    h.deleteMeta.mockResolvedValue(undefined)
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.deleteMeta).toHaveBeenCalledTimes(1)
    expect(h.localDeletes).toBe(1)
  })

  it("explains a WABA permission refusal, keeps the row, and offers local removal", async () => {
    h.deleteMeta.mockRejectedValue(
      new MetaApiError('(#100) Need permission on either WhatsApp Business Account or owner/shared business.', {
        code: 100,
        httpStatus: 400,
      }),
    )
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body).toMatchObject({ code: 'waba_permission', can_remove_locally: true })
    expect(body.error).toMatch(/Full control/)
    expect(h.localDeletes).toBe(0)
  })

  it('removes only the local row with ?local_only=true', async () => {
    const res = await call('?local_only=true')
    expect(res.status).toBe(200)
    expect(h.deleteMeta).not.toHaveBeenCalled()
    expect(h.localDeletes).toBe(1)
  })
})
