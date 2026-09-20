import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Bloco 3-A — coverage for the Meta ad-referral capture added to
// POST /api/whatsapp/webhook (persistAdReferral, called right after
// findOrCreateConversation in processMessage).
//
// Cases covered:
//   - webhook with a `referral` (source_type: 'ad') on a brand-new
//     conversation → conversations.source/ad_id/ctwa_clid/text/
//     first_referral_at all get written.
//   - webhook WITHOUT a `referral` → none of those fields are touched,
//     normal cascade still runs (nothing crashes on the missing/
//     optional object).
//   - an EXISTING conversation that already has `first_referral_at`
//     receives a NEW ad referral → ad_id/ctwa_clid/text refresh, but
//     `first_referral_at` is never included in the update (never
//     overwritten).
//   - a `referral` with `source_type: 'post'` (organic post tap, not
//     an ad) is ignored — no commercial fields written.
// ============================================================

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  decrypt: vi.fn(),
  findExistingContact: vi.fn(),
  isUniqueViolation: vi.fn(),
  verifyMetaWebhookSignature: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  handleTemplateWebhookChange: vi.fn(),
  isTemplateWebhookField: vi.fn(),
  handleInboundPendingConfirmation: vi.fn(),
  cancelFollowUpCadence: vi.fn(),
  handleInboundDataDeletionRequest: vi.fn(),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))

// Same rationale as aisdr-approval-guard.test.ts: run `after()` inline.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => cb() }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: h.decrypt,
  encrypt: vi.fn(),
  isLegacyFormat: vi.fn(() => false),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: h.getMediaUrl,
  downloadMedia: h.downloadMedia,
}))

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: h.findExistingContact,
  isUniqueViolation: h.isUniqueViolation,
}))

vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: h.verifyMetaWebhookSignature,
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))

vi.mock('@/lib/whatsapp/template-webhook', () => ({
  handleTemplateWebhookChange: h.handleTemplateWebhookChange,
  isTemplateWebhookField: h.isTemplateWebhookField,
}))

vi.mock('@/lib/eter/pending-confirmation', () => ({
  handleInboundPendingConfirmation: h.handleInboundPendingConfirmation,
}))

vi.mock('@/lib/eter/followups', () => ({
  cancelFollowUpCadence: h.cancelFollowUpCadence,
}))

vi.mock('@/lib/eter/data-deletion', () => ({
  handleInboundDataDeletionRequest: h.handleInboundDataDeletionRequest,
}))

// AI SDR approval-forward guard is unrelated to this file — disable it
// deterministically so a stray env var in the test runner can't route a
// normal text message down that branch instead of the inbound cascade.
vi.mock('@/lib/eter/aisdr-approval-forward', () => ({
  isAisdrApprovalForwardEnabled: () => false,
  isAuthorizedApprover: () => false,
  parseApprovalButtonId: () => null,
  verifyApprovalContext: () => 'not_provided',
  forwardApprovalDecision: vi.fn(),
}))

const ACCOUNT_ID = 'acct-1'
const CONFIG_ROW = {
  id: 'cfg-1',
  account_id: ACCOUNT_ID,
  user_id: 'user-1',
  phone_number_id: 'PNID-1',
  access_token: 'enc-token',
}

/**
 * Builds a fake supabase-js client scoped to what processMessage's
 * referral-persistence path touches. `existingConversation`, when set,
 * makes findOrCreateConversation resolve to that row instead of
 * inserting a new one — used to exercise the "conversation already
 * exists" branch of persistAdReferral.
 */
function makeSupabaseAdmin(opts: { existingConversation?: Record<string, unknown> | null } = {}) {
  const { existingConversation = null } = opts
  const contactInserts: Record<string, unknown>[] = []
  const conversationInserts: Record<string, unknown>[] = []
  const conversationUpdates: Record<string, unknown>[] = []
  const messageInserts: Record<string, unknown>[] = []

  function builder(table: string) {
    let didInsert = false
    let didUpdate = false

    const singleResult = () => {
      if (table === 'contacts' && didInsert) {
        return Promise.resolve({
          data: { id: 'contact-new', account_id: ACCOUNT_ID, name: 'Lead', phone: '351900000000' },
          error: null,
        })
      }
      if (table === 'conversations' && didInsert) {
        return Promise.resolve({
          data: {
            id: 'conv-new',
            account_id: ACCOUNT_ID,
            contact_id: 'contact-new',
            first_referral_at: null,
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }

    const arrayResult = () => {
      if (table === 'whatsapp_config') return { data: [CONFIG_ROW], error: null }
      if (table === 'conversations') {
        if (didUpdate) return { data: null, error: null }
        return { data: existingConversation ? [existingConversation] : [], error: null }
      }
      if (table === 'messages') return { data: didInsert ? null : [], count: 0, error: null }
      return { data: [], error: null }
    }

    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'delete', 'in']) {
      b[m] = vi.fn(() => b)
    }
    b.update = vi.fn((payload: Record<string, unknown>) => {
      didUpdate = true
      if (table === 'conversations') conversationUpdates.push(payload)
      return b
    })
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true
      if (table === 'contacts') contactInserts.push(payload)
      if (table === 'conversations') conversationInserts.push(payload)
      if (table === 'messages') messageInserts.push(payload)
      return b
    })
    b.maybeSingle = vi.fn(singleResult)
    b.single = vi.fn(singleResult)
    b.then = (resolve: (v: unknown) => unknown) => resolve(arrayResult())
    return b
  }

  return {
    admin: { from: vi.fn(builder) },
    contactInserts,
    conversationInserts,
    conversationUpdates,
    messageInserts,
  }
}

let mock = makeSupabaseAdmin()

function webhookBody(
  referral: Record<string, unknown> | undefined,
  messageId = 'wamid-1',
  from = '351900000000',
) {
  return {
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '351900000001', phone_number_id: 'PNID-1' },
              contacts: [{ profile: { name: 'Lead' }, wa_id: from }],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: '1723459200',
                  type: 'text',
                  text: { body: 'Olá, vi o anúncio e quero saber mais' },
                  ...(referral ? { referral } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

async function postWebhook(body: unknown) {
  const { POST } = await import('./route')
  const res = await POST(
    new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return res
}

function setupMocks(opts: { existingConversation?: Record<string, unknown> | null } = {}) {
  mock = makeSupabaseAdmin(opts)
  h.createClient.mockReturnValue(mock.admin)
  h.decrypt.mockReturnValue('plaintext-access-token')
  h.verifyMetaWebhookSignature.mockReturnValue(true)
  h.findExistingContact.mockResolvedValue(null)
  h.isUniqueViolation.mockReturnValue(false)
  h.isTemplateWebhookField.mockReturnValue(false)
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.runAutomationsForTrigger.mockResolvedValue(undefined)
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.handleInboundPendingConfirmation.mockResolvedValue('none')
  h.cancelFollowUpCadence.mockResolvedValue(undefined)
  h.handleInboundDataDeletionRequest.mockResolvedValue('none')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  setupMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

const AD_REFERRAL = {
  source_type: 'ad',
  source_id: 'ad-123',
  source_url: 'https://fb.me/ad-123',
  headline: 'Automatiza o teu WhatsApp',
  body: 'Fala com a Eter Growth',
  ctwa_clid: 'clid-abc-999',
}

describe('POST /api/whatsapp/webhook — Bloco 3-A referral capture', () => {
  it('persists source/ad_id/ctwa_clid/text/first_referral_at for a NEW conversation opened by an ad referral', async () => {
    const res = await postWebhook(webhookBody(AD_REFERRAL))
    expect(res.status).toBe(200)

    const referralUpdate = mock.conversationUpdates.find((u) => 'source' in u)
    expect(referralUpdate).toMatchObject({
      source: 'meta_ad',
      ad_id: 'ad-123',
      ctwa_clid: 'clid-abc-999',
      referral_headline: 'Automatiza o teu WhatsApp',
      referral_body: 'Fala com a Eter Growth',
      referral_source_url: 'https://fb.me/ad-123',
    })
    expect(referralUpdate).toHaveProperty('first_referral_at')
    expect(typeof referralUpdate!.first_referral_at).toBe('string')
  })

  it('does not touch any referral field when the message has no referral object', async () => {
    const res = await postWebhook(webhookBody(undefined))
    expect(res.status).toBe(200)

    const referralUpdate = mock.conversationUpdates.find((u) => 'source' in u)
    expect(referralUpdate).toBeUndefined()
  })

  it('ignores a referral whose source_type is "post" (organic tap, not an ad)', async () => {
    await postWebhook(webhookBody({ ...AD_REFERRAL, source_type: 'post' }))

    const referralUpdate = mock.conversationUpdates.find((u) => 'source' in u)
    expect(referralUpdate).toBeUndefined()
  })

  it('refreshes ad_id/ctwa_clid/text on an EXISTING conversation but never overwrites a prior first_referral_at', async () => {
    setupMocks({
      existingConversation: {
        id: 'conv-existing',
        account_id: ACCOUNT_ID,
        contact_id: 'contact-existing',
        unread_count: 0,
        first_referral_at: '2026-01-01T00:00:00.000Z',
      },
    })
    h.findExistingContact.mockResolvedValue({
      id: 'contact-existing',
      account_id: ACCOUNT_ID,
      name: 'Lead',
      phone: '351900000000',
    })

    await postWebhook(webhookBody({ ...AD_REFERRAL, source_id: 'ad-456', ctwa_clid: 'clid-new-111' }))

    const referralUpdate = mock.conversationUpdates.find((u) => 'source' in u)
    expect(referralUpdate).toMatchObject({
      source: 'meta_ad',
      ad_id: 'ad-456',
      ctwa_clid: 'clid-new-111',
    })
    // The whole point: never re-stamp first_referral_at once it's set.
    expect(referralUpdate).not.toHaveProperty('first_referral_at')
  })

  it('a message with a well-formed but malformed-looking referral (missing optional fields) never crashes the webhook', async () => {
    const res = await postWebhook(webhookBody({ source_type: 'ad' }))
    expect(res.status).toBe(200)

    const referralUpdate = mock.conversationUpdates.find((u) => 'source' in u)
    expect(referralUpdate).toMatchObject({
      source: 'meta_ad',
      ad_id: null,
      ctwa_clid: null,
      referral_headline: null,
      referral_body: null,
      referral_source_url: null,
    })
  })
})
