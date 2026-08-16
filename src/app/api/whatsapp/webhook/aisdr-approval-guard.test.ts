import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Wiring coverage for the AI SDR approval-button guard added to
// POST /api/whatsapp/webhook. The retry/idempotency/queue behaviour
// itself is covered in src/lib/eter/aisdr-approval-forward.test.ts —
// this file only pins how the webhook route DECIDES whether to
// intercept a message:
//   - a recognized aisdr_send_/aisdr_discard_ button tap, with the
//     flag on, is forwarded and never reaches the normal inbound
//     cascade (no contact/conversation created for it)
//   - a normal lead text message always goes through the cascade,
//     flag on or off
//   - with the flag off, an aisdr_ button tap is NOT intercepted and
//     falls through to the normal cascade like any other interactive
//     reply
// ============================================================

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  forwardApprovalDecision: vi.fn(),
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

// The real `after()` requires an active Next.js request scope, which
// plain vitest + `new Request()` doesn't provide ("`after` was called
// outside a request scope"). Run the callback inline instead — the
// route's actual behavior (deferring work past the response) isn't
// what this file tests, only which branch (forward vs. normal cascade)
// gets taken.
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

vi.mock('@/lib/eter/aisdr-approval-forward', async () => {
  const actual = await vi.importActual<typeof import('@/lib/eter/aisdr-approval-forward')>(
    '@/lib/eter/aisdr-approval-forward',
  )
  return {
    // Real parser/flag-reader/allowlist/context-check — only the
    // network-touching forward call is mocked, so this test exercises
    // the route's actual decision logic (parse the button id, read the
    // flag, check the sender allowlist) rather than a fake.
    parseApprovalButtonId: actual.parseApprovalButtonId,
    isAisdrApprovalForwardEnabled: actual.isAisdrApprovalForwardEnabled,
    isAuthorizedApprover: actual.isAuthorizedApprover,
    verifyApprovalContext: actual.verifyApprovalContext,
    forwardApprovalDecision: h.forwardApprovalDecision,
  }
})

const ACCOUNT_ID = 'acct-1'
const CONFIG_ROW = {
  id: 'cfg-1',
  account_id: ACCOUNT_ID,
  user_id: 'user-1',
  phone_number_id: 'PNID-1',
  access_token: 'enc-token',
}

function makeSupabaseAdmin() {
  const contactInserts: Record<string, unknown>[] = []
  const conversationInserts: Record<string, unknown>[] = []
  const messageInserts: Record<string, unknown>[] = []

  function builder(table: string) {
    let didInsert = false

    const singleResult = () => {
      if (table === 'contacts' && didInsert) {
        return Promise.resolve({
          data: { id: 'contact-new', account_id: ACCOUNT_ID, name: 'Lead', phone: '351900000000' },
          error: null,
        })
      }
      if (table === 'conversations' && didInsert) {
        return Promise.resolve({
          data: { id: 'conv-new', account_id: ACCOUNT_ID, contact_id: 'contact-new' },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }

    const arrayResult = () => {
      if (table === 'whatsapp_config') return { data: [CONFIG_ROW], error: null }
      if (table === 'conversations') return { data: [], error: null } // no existing conversation
      if (table === 'messages') return { data: didInsert ? null : [], count: 0, error: null }
      return { data: [], error: null }
    }

    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'update', 'delete', 'in']) {
      b[m] = vi.fn(() => b)
    }
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
    messageInserts,
  }
}

let mock = makeSupabaseAdmin()

function interactiveButtonWebhookBody(
  buttonId: string,
  messageId = 'wamid-button-1',
  from = '351916944664',
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
              contacts: [{ profile: { name: 'Ricardo' }, wa_id: from }],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: '1723459200',
                  type: 'interactive',
                  interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'Enviar' } },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function normalTextWebhookBody(messageId = 'wamid-text-1') {
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
              contacts: [{ profile: { name: 'Lead' }, wa_id: '351900000000' }],
              messages: [
                {
                  id: messageId,
                  from: '351900000000',
                  timestamp: '1723459200',
                  type: 'text',
                  text: { body: 'Olá, quero saber mais' },
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
  // The route replies immediately and defers work into `after()`. In the
  // Next.js test environment `after()` runs the callback inline (no real
  // request-lifecycle boundary), but we still flush microtasks to be safe
  // before asserting on side effects.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return res
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mock = makeSupabaseAdmin()
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
  h.forwardApprovalDecision.mockResolvedValue('forwarded')
  delete process.env.AISDR_APPROVAL_FORWARD_ENABLED
  delete process.env.AISDR_APPROVER_PHONES
})

afterEach(() => {
  delete process.env.AISDR_APPROVAL_FORWARD_ENABLED
  delete process.env.AISDR_APPROVER_PHONES
})

// The sender in interactiveButtonWebhookBody's fixture ("Ricardo"'s
// wa_id / message.from).
const AUTHORIZED_APPROVER_PHONE = '351916944664'

describe('POST /api/whatsapp/webhook — AI SDR approval button guard (flag ON)', () => {
  beforeEach(() => {
    process.env.AISDR_APPROVAL_FORWARD_ENABLED = 'true'
    process.env.AISDR_APPROVER_PHONES = AUTHORIZED_APPROVER_PHONE
  })

  it('forwards a recognized aisdr_send_ button tap and never touches the inbound cascade', async () => {
    const res = await postWebhook(interactiveButtonWebhookBody('aisdr_send_42', 'wamid-button-1'))
    expect(res.status).toBe(200)

    expect(h.forwardApprovalDecision).toHaveBeenCalledTimes(1)
    expect(h.forwardApprovalDecision).toHaveBeenCalledWith(
      mock.admin,
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        waMessageId: 'wamid-button-1',
        approvalId: 42,
        decision: 'send',
      }),
    )

    // The tap must never create a contact/conversation or reach any
    // downstream inbound handler — it's Ricardo deciding, not a lead
    // messaging in.
    expect(mock.contactInserts).toHaveLength(0)
    expect(mock.conversationInserts).toHaveLength(0)
    expect(mock.messageInserts).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
  })

  it('forwards a recognized aisdr_discard_ button tap', async () => {
    await postWebhook(interactiveButtonWebhookBody('aisdr_discard_7', 'wamid-button-2'))

    expect(h.forwardApprovalDecision).toHaveBeenCalledWith(
      mock.admin,
      expect.objectContaining({ approvalId: 7, decision: 'discard' }),
    )
  })

  it('a normal lead text message still goes through the full cascade', async () => {
    const res = await postWebhook(normalTextWebhookBody())
    expect(res.status).toBe(200)

    expect(h.forwardApprovalDecision).not.toHaveBeenCalled()
    expect(mock.contactInserts).toHaveLength(1)
    expect(mock.conversationInserts).toHaveLength(1)
    expect(mock.messageInserts).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
  })

  it('an interactive tap whose button id does not match the aisdr_ pattern falls through to the cascade', async () => {
    await postWebhook(interactiveButtonWebhookBody('flow_step_confirm_yes', 'wamid-other-1'))

    expect(h.forwardApprovalDecision).not.toHaveBeenCalled()
    expect(mock.contactInserts).toHaveLength(1)
    expect(mock.messageInserts).toHaveLength(1)
  })
})

describe('POST /api/whatsapp/webhook — AI SDR approval button guard (forgery protection)', () => {
  beforeEach(() => {
    process.env.AISDR_APPROVAL_FORWARD_ENABLED = 'true'
  })

  it('rejects a well-shaped aisdr_ button tap from a sender NOT on the allowlist, before any network/DB call', async () => {
    process.env.AISDR_APPROVER_PHONES = AUTHORIZED_APPROVER_PHONE
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await postWebhook(
      interactiveButtonWebhookBody('aisdr_send_42', 'wamid-forged-1', '351900009999'),
    )
    expect(res.status).toBe(200)

    expect(h.forwardApprovalDecision).not.toHaveBeenCalled()
    // Fails closed BEFORE any DB write too — the guard must not create
    // a contact/conversation/message for the rejected tap either.
    expect(mock.contactInserts).toHaveLength(0)
    expect(mock.conversationInserts).toHaveLength(0)
    expect(mock.messageInserts).toHaveLength(0)
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('SEGURANÇA'))).toBe(true)
    errorSpy.mockRestore()
  })

  it('rejects EVERY sender, including the would-be-authorized one, when AISDR_APPROVER_PHONES is unset', async () => {
    delete process.env.AISDR_APPROVER_PHONES
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await postWebhook(
      interactiveButtonWebhookBody('aisdr_send_42', 'wamid-forged-2', AUTHORIZED_APPROVER_PHONE),
    )

    expect(h.forwardApprovalDecision).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('accepts a tap from a phone on the allowlist even with country-code/formatting differences', async () => {
    // Allowlist entry with a leading "+" and spaces; inbound message.from
    // is Meta's plain-digits form — normalizePhone must reconcile both.
    process.env.AISDR_APPROVER_PHONES = '+351 916 944 664'

    await postWebhook(
      interactiveButtonWebhookBody('aisdr_send_42', 'wamid-ok-1', AUTHORIZED_APPROVER_PHONE),
    )

    expect(h.forwardApprovalDecision).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/whatsapp/webhook — AI SDR approval button guard (flag OFF, default)', () => {
  it('an aisdr_ button tap is NOT intercepted when the flag is unset — falls through unchanged', async () => {
    const res = await postWebhook(interactiveButtonWebhookBody('aisdr_send_42', 'wamid-button-3'))
    expect(res.status).toBe(200)

    expect(h.forwardApprovalDecision).not.toHaveBeenCalled()
    // Falls through to the normal interactive-message handling — still
    // creates a contact/conversation/message like any other tap, exactly
    // today's (pre-fix) behaviour.
    expect(mock.contactInserts).toHaveLength(1)
    expect(mock.messageInserts).toHaveLength(1)
  })

  it('explicit "false" also does not intercept', async () => {
    process.env.AISDR_APPROVAL_FORWARD_ENABLED = 'false'
    await postWebhook(interactiveButtonWebhookBody('aisdr_discard_7', 'wamid-button-4'))
    expect(h.forwardApprovalDecision).not.toHaveBeenCalled()
  })
})
