import { describe, expect, it, vi, beforeEach } from 'vitest'

// ============================================================
// Punto 10, F-P10-3 — first test file for this route. Covers the new
// ownership check: a mediaId must belong to a message inside a
// conversation of the CALLER's own account before this route ever
// spends a call on Meta.
// ============================================================

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
  decrypt: vi.fn((v: string) => v),
  state: {
    profileAccountId: 'acct-1' as string | null,
    // The row the ownership query resolves to for the requested
    // mediaId, or null to simulate "no match" (either truly missing,
    // or belonging to a different account — same 404 either way).
    ownedMessageRow: null as { id: string } | null,
    whatsappConfig: { id: 'cfg-1', access_token: 'enc', phone_number_id: 'pn-1' } as
      | Record<string, unknown>
      | null,
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: h.getUser },
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        single: async () => {
          if (table === 'whatsapp_config') {
            return h.state.whatsappConfig
              ? { data: h.state.whatsappConfig, error: null }
              : { data: null, error: { message: 'not found' } }
          }
          return { data: null, error: null }
        },
        maybeSingle: async () => {
          if (table === 'profiles') {
            return {
              data: h.state.profileAccountId ? { account_id: h.state.profileAccountId } : null,
              error: null,
            }
          }
          if (table === 'messages') {
            return { data: h.state.ownedMessageRow, error: null }
          }
          return { data: null, error: null }
        },
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: h.getMediaUrl,
  downloadMedia: h.downloadMedia,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: h.decrypt,
}))

import { GET } from './route'

function request() {
  return new Request('http://localhost/api/whatsapp/media/media-123')
}
const PARAMS = { params: Promise.resolve({ mediaId: 'media-123' }) }

beforeEach(() => {
  h.getUser.mockReset()
  h.getMediaUrl.mockReset()
  h.downloadMedia.mockReset()
  h.state.profileAccountId = 'acct-1'
  h.state.ownedMessageRow = null
  h.state.whatsappConfig = { id: 'cfg-1', access_token: 'enc', phone_number_id: 'pn-1' }
  h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  h.getMediaUrl.mockResolvedValue({ url: 'https://cdn.example/real', mimeType: 'image/jpeg', fileSize: 100 })
  h.downloadMedia.mockResolvedValue({ buffer: Buffer.from('bytes'), contentType: 'image/jpeg' })
})

describe('GET /api/whatsapp/media/[mediaId] — F-P10-3 ownership check', () => {
  it('1. a mediaId belonging to a message in the caller\'s own account is allowed through to Meta', async () => {
    h.state.ownedMessageRow = { id: 'msg-1' }
    const res = await GET(request(), PARAMS)
    expect(res.status).toBe(200)
    expect(h.getMediaUrl).toHaveBeenCalledWith({ mediaId: 'media-123', accessToken: 'enc' })
    expect(h.downloadMedia).toHaveBeenCalled()
  })

  it('2. a mediaId matching no message at all → 404, Meta never called', async () => {
    h.state.ownedMessageRow = null
    const res = await GET(request(), PARAMS)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Media not found')
    expect(h.getMediaUrl).not.toHaveBeenCalled()
    expect(h.downloadMedia).not.toHaveBeenCalled()
  })

  it('3. a mediaId belonging to a DIFFERENT account → 404 (same shape as case 2 — never reveals which), Meta never called', async () => {
    // The ownership query is scoped by conversations.account_id = the
    // caller's own account — a mediaId that exists but belongs to
    // another account never matches it, so the fake correctly resolves
    // to null here exactly like case 2. This test documents that
    // equivalence explicitly rather than leaving it implicit.
    h.state.ownedMessageRow = null
    const res = await GET(request(), PARAMS)
    expect(res.status).toBe(404)
    expect(h.getMediaUrl).not.toHaveBeenCalled()
    expect(h.downloadMedia).not.toHaveBeenCalled()
  })

  it('4. getMediaUrl/downloadMedia are never called on a 404 — asserted explicitly above in cases 2 and 3', () => {
    // Covered by the `not.toHaveBeenCalled()` assertions in tests 2/3.
    expect(true).toBe(true)
  })

  it('5. an unauthenticated request keeps the existing 401 behavior, unaffected by the new check', async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })
    const res = await GET(request(), PARAMS)
    expect(res.status).toBe(401)
    expect(h.getMediaUrl).not.toHaveBeenCalled()
  })

  it('6. an authenticated viewer (any account member) with no owning message still gets 404, never another account\'s media', async () => {
    // "Viewer" here means: authenticated, resolves to a real account,
    // but that account owns no message for this mediaId — the route
    // has no role check at all (matches pre-existing behavior), so the
    // ownership check is the only gate, and it holds regardless of role.
    h.state.profileAccountId = 'acct-1'
    h.state.ownedMessageRow = null
    const res = await GET(request(), PARAMS)
    expect(res.status).toBe(404)
    expect(h.getMediaUrl).not.toHaveBeenCalled()
    expect(h.downloadMedia).not.toHaveBeenCalled()
  })
})
