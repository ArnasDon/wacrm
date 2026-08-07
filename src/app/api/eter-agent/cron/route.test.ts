import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Regression coverage for the silent-failure review finding on this
// route: a prior version let ANY exception inside the per-row body
// (most dangerously `markScheduledMessageFailed` itself throwing on a
// transient DB error) propagate out of the whole `GET` handler —
// aborting the batch, leaving every remaining `due` row untouched
// until the next tick, and leaving the row that triggered it stuck in
// `processing` forever (invisible to both the sweep, which only
// selects `pending`, and any operator dashboard querying `failed`).
// These tests pin: (1) one row's total failure — including its own
// failure-recording write — never blocks the rest of the batch, and
// (2) `reclaimStaleProcessingMessages` runs up front and its own
// failure is non-fatal to the sweep.
// ============================================================

const h = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  getDueScheduledMessages: vi.fn(),
  claimScheduledMessage: vi.fn(),
  markScheduledMessageSent: vi.fn(),
  markScheduledMessageFailed: vi.fn(),
  reclaimStaleProcessingMessages: vi.fn(),
  findApprovedTemplateByName: vi.fn(),
  isWithinSessionWindow: vi.fn(),
  engineSendText: vi.fn(),
  engineSendTemplate: vi.fn(),
}))

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: h.supabaseAdmin }))
vi.mock('@/lib/eter/repo/scheduled-messages.repo', () => ({
  getDueScheduledMessages: h.getDueScheduledMessages,
  claimScheduledMessage: h.claimScheduledMessage,
  markScheduledMessageSent: h.markScheduledMessageSent,
  markScheduledMessageFailed: h.markScheduledMessageFailed,
  reclaimStaleProcessingMessages: h.reclaimStaleProcessingMessages,
}))
vi.mock('@/lib/eter/repo/message-templates.repo', () => ({
  findApprovedTemplateByName: h.findApprovedTemplateByName,
}))
vi.mock('@/lib/eter/session-window', () => ({ isWithinSessionWindow: h.isWithinSessionWindow }))
vi.mock('@/lib/automations/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendTemplate: h.engineSendTemplate,
}))

import { GET } from './route'

const SECRET = 'test-cron-secret'

function fakeAdmin(userId = 'user-1') {
  return {
    from(table: string) {
      if (table === 'whatsapp_config') {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: () => Promise.resolve({ data: { user_id: userId }, error: null }) }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table in test fake: ${table}`)
    },
  }
}

function scheduledMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sm-1',
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    bookingId: null,
    kind: 'follow_up_1d',
    sendAt: new Date(),
    status: 'processing',
    payload: { freeText: 'oi' },
    error: null,
    sentAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function req() {
  return new Request('http://localhost/api/eter-agent/cron', { headers: { 'x-cron-secret': SECRET } })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTOMATION_CRON_SECRET = SECRET
  h.supabaseAdmin.mockReturnValue(fakeAdmin())
  h.reclaimStaleProcessingMessages.mockResolvedValue(0)
  h.isWithinSessionWindow.mockResolvedValue(true)
})

describe('GET /api/eter-agent/cron — auth', () => {
  it('401s on a missing/wrong secret', async () => {
    const res = await GET(new Request('http://localhost/api/eter-agent/cron', { headers: { 'x-cron-secret': 'wrong' } }))
    expect(res.status).toBe(401)
  })

  it('503s when the secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await GET(req())
    expect(res.status).toBe(503)
  })
})

describe('GET /api/eter-agent/cron — per-row resilience (silent-failure fix)', () => {
  it("one row's send failure AND its own markScheduledMessageFailed write failing does not abort the batch", async () => {
    const rowA = scheduledMessage({ id: 'a', payload: { freeText: 'FAIL_SEND' } })
    const rowB = scheduledMessage({ id: 'b', payload: { freeText: 'OK' } })
    h.getDueScheduledMessages.mockResolvedValue([rowA, rowB])
    h.claimScheduledMessage.mockImplementation(async (_admin: unknown, id: string) =>
      id === 'a' ? rowA : rowB,
    )
    h.engineSendText.mockImplementation(async (args: { text: string }) => {
      if (args.text === 'FAIL_SEND') throw new Error('meta api down')
      return {}
    })
    // rowA's own failure-recording write ALSO throws — must not take
    // down the loop or skip rowB.
    h.markScheduledMessageFailed.mockRejectedValueOnce(new Error('db blip writing failure'))
    h.markScheduledMessageSent.mockResolvedValue(undefined)

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    // Both rows were attempted — the batch was NOT aborted after row a.
    expect(h.claimScheduledMessage).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    // rowA counted as failed (even though the failure-write itself blew
    // up) and rowB still sent successfully.
    expect(body).toEqual({ sent: 1, failed: 1, skipped: 0, reclaimed: 0 })
  })

  it('reclaimStaleProcessingMessages failing is non-fatal — the due sweep still runs', async () => {
    h.reclaimStaleProcessingMessages.mockRejectedValue(new Error('reclaim query boom'))
    const rowA = scheduledMessage({ id: 'a', payload: { freeText: 'OK' } })
    h.getDueScheduledMessages.mockResolvedValue([rowA])
    h.claimScheduledMessage.mockResolvedValue(rowA)
    h.engineSendText.mockResolvedValue({})
    h.markScheduledMessageSent.mockResolvedValue(undefined)

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ sent: 1, failed: 0, skipped: 0, reclaimed: 0 })
  })

  it('surfaces a non-zero reclaimed count from a healthy reclaim sweep', async () => {
    h.reclaimStaleProcessingMessages.mockResolvedValue(3)
    h.getDueScheduledMessages.mockResolvedValue([])

    const res = await GET(req())
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 0, skipped: 0, reclaimed: 3 })
  })

  it('a lost claim race (another invocation got there first) is counted as skipped, not failed', async () => {
    const rowA = scheduledMessage({ id: 'a' })
    h.getDueScheduledMessages.mockResolvedValue([rowA])
    h.claimScheduledMessage.mockResolvedValue(null)

    const res = await GET(req())
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 0, skipped: 1, reclaimed: 0 })
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})
