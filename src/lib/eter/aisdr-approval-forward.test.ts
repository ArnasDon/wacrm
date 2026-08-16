import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Coverage for the AI SDR approval-button forwarding fix (issue: the
// Meta webhook moved from tools/eter-whatsapp-agent to this app on 11
// Aug, and nothing here recognized the [Enviar]/[Descartar] buttons —
// 9 approvals stuck since 31 Jul). Pins:
//   - button id parsing (aisdr_send_{id} / aisdr_discard_{id})
//   - a recognized decision is forwarded to the AI SDR worker with the
//     exact contract (header, body, URL) confirmed by reading
//     tools/ai-sdr/src/index.ts + src/approvals.ts
//   - every retry failing queues the row (never silently dropped) and
//     fires an alert
//   - the SAME wa_message_id (Meta webhook redelivery) is never
//     forwarded twice
//   - the SAME approval_id already forwarded (Ricardo double-tapping)
//     is never forwarded twice, even under a different wa_message_id
// ============================================================

const h = vi.hoisted(() => ({
  findForwardedByApprovalId: vi.fn(),
  claimForwardAttempt: vi.fn(),
  insertSkippedDuplicateForward: vi.fn(),
  markForwardForwarded: vi.fn(),
  markForwardFailed: vi.fn(),
  getFailedForwardsForRetry: vi.fn(),
  claimFailedForwardForRetry: vi.fn(),
  alertAisdrApprovalForwardFailed: vi.fn(),
}))

vi.mock('@/lib/eter/repo/aisdr-approval-forwards.repo', () => ({
  findForwardedByApprovalId: h.findForwardedByApprovalId,
  claimForwardAttempt: h.claimForwardAttempt,
  insertSkippedDuplicateForward: h.insertSkippedDuplicateForward,
  markForwardForwarded: h.markForwardForwarded,
  markForwardFailed: h.markForwardFailed,
  getFailedForwardsForRetry: h.getFailedForwardsForRetry,
  claimFailedForwardForRetry: h.claimFailedForwardForRetry,
}))

vi.mock('@/lib/notifications/aisdr-approval-alert', () => ({
  alertAisdrApprovalForwardFailed: h.alertAisdrApprovalForwardFailed,
}))

import {
  parseApprovalButtonId,
  isAisdrApprovalForwardEnabled,
  isAuthorizedApprover,
  getAuthorizedApproverPhones,
  verifyApprovalContext,
  forwardApprovalDecision,
  reprocessFailedApprovalForwards,
} from './aisdr-approval-forward'

const fakeDb = {} as never

function forwardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fwd-1',
    accountId: 'acct-1',
    waMessageId: 'wamid-1',
    approvalId: 42,
    decision: 'send',
    status: 'pending',
    attempts: 1,
    lastError: null,
    forwardedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const baseInput = {
  accountId: 'acct-1',
  waMessageId: 'wamid-1',
  approvalId: 42,
  decision: 'send' as const,
}

const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  process.env.AI_SDR_WORKER_URL = 'https://ai-sdr.example.com'
  process.env.APPROVALS_CALLBACK_SECRET = 'shh-secret'
  process.env.AISDR_APPROVAL_FORWARD_ENABLED = 'true'
  h.findForwardedByApprovalId.mockResolvedValue(null)
  h.claimForwardAttempt.mockResolvedValue({ created: true, row: forwardRow() })
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  global.fetch = originalFetch
})

// Runs the pending timers/backoff sleeps alongside the promise under test.
async function runWithFakeBackoff<T>(p: Promise<T>): Promise<T> {
  const result = p
  await vi.runAllTimersAsync()
  return result
}

describe('parseApprovalButtonId', () => {
  it('parses a send button id', () => {
    expect(parseApprovalButtonId('aisdr_send_42')).toEqual({ decision: 'send', approvalId: 42 })
  })

  it('parses a discard button id', () => {
    expect(parseApprovalButtonId('aisdr_discard_7')).toEqual({ decision: 'discard', approvalId: 7 })
  })

  it('returns null for an unrelated button id', () => {
    expect(parseApprovalButtonId('some_flow_step_1')).toBeNull()
  })

  it('returns null for a malformed aisdr id (no numeric suffix)', () => {
    expect(parseApprovalButtonId('aisdr_send_abc')).toBeNull()
  })
})

describe('isAisdrApprovalForwardEnabled', () => {
  it('is false by default (unset)', () => {
    delete process.env.AISDR_APPROVAL_FORWARD_ENABLED
    expect(isAisdrApprovalForwardEnabled()).toBe(false)
  })

  it('is false for any value other than "true"', () => {
    process.env.AISDR_APPROVAL_FORWARD_ENABLED = 'yes'
    expect(isAisdrApprovalForwardEnabled()).toBe(false)
  })

  it('is true when set to "true"', () => {
    process.env.AISDR_APPROVAL_FORWARD_ENABLED = 'true'
    expect(isAisdrApprovalForwardEnabled()).toBe(true)
  })
})

describe('isAuthorizedApprover / getAuthorizedApproverPhones — forgery guard allowlist', () => {
  afterEach(() => {
    delete process.env.AISDR_APPROVER_PHONES
  })

  it('fails closed (rejects everyone) when unset', () => {
    delete process.env.AISDR_APPROVER_PHONES
    expect(getAuthorizedApproverPhones()).toBeNull()
    expect(isAuthorizedApprover('351916944664')).toBe(false)
  })

  it('fails closed (rejects everyone) when set to an empty/whitespace string', () => {
    process.env.AISDR_APPROVER_PHONES = '   '
    expect(isAuthorizedApprover('351916944664')).toBe(false)
  })

  it('accepts a phone on the allowlist', () => {
    process.env.AISDR_APPROVER_PHONES = '351916944664,351900000001'
    expect(isAuthorizedApprover('351916944664')).toBe(true)
    expect(isAuthorizedApprover('351900000001')).toBe(true)
  })

  it('rejects a phone not on the allowlist', () => {
    process.env.AISDR_APPROVER_PHONES = '351916944664'
    expect(isAuthorizedApprover('351900009999')).toBe(false)
  })

  it('normalizes both sides before comparing (+, spaces, dashes)', () => {
    process.env.AISDR_APPROVER_PHONES = ' +351 916-944-664 '
    expect(isAuthorizedApprover('351916944664')).toBe(true)
  })
})

describe('verifyApprovalContext — prepared but inactive', () => {
  it('returns "not_provided" when the tap carries no context.id', () => {
    expect(verifyApprovalContext(undefined, 42)).toBe('not_provided')
  })

  it('returns "unverifiable" when a context.id is present (no stored mapping to check against yet)', () => {
    expect(verifyApprovalContext('wamid-outbound-1', 42)).toBe('unverifiable')
  })
})

describe('forwardApprovalDecision — happy path', () => {
  it('POSTs the exact AI SDR contract and marks the row forwarded', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => '' })

    const outcome = await forwardApprovalDecision(fakeDb, baseInput)

    expect(outcome).toBe('forwarded')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ai-sdr.example.com/api/approvals/decision')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Approvals-Secret': 'shh-secret',
    })
    expect(JSON.parse(init.body as string)).toEqual({ approval_id: 42, decision: 'send' })
    expect(h.markForwardForwarded).toHaveBeenCalledWith(fakeDb, 'fwd-1')
    expect(h.markForwardFailed).not.toHaveBeenCalled()
    expect(h.alertAisdrApprovalForwardFailed).not.toHaveBeenCalled()
  })

  it('sends the discard decision when the button was Descartar', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => '' })

    await forwardApprovalDecision(fakeDb, { ...baseInput, decision: 'discard' })

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ approval_id: 42, decision: 'discard' })
  })
})

describe('forwardApprovalDecision — retries, timeout, and queuing on exhaustion', () => {
  it('retries at least 3 times with backoff before giving up, then queues + alerts', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    })

    const outcome = await runWithFakeBackoff(forwardApprovalDecision(fakeDb, baseInput))

    expect(outcome).toBe('failed_queued')
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(h.markForwardForwarded).not.toHaveBeenCalled()
    expect(h.markForwardFailed).toHaveBeenCalledTimes(1)
    expect(h.markForwardFailed.mock.calls[0][1]).toBe('fwd-1')
    expect(h.alertAisdrApprovalForwardFailed).toHaveBeenCalledTimes(1)
    expect(h.alertAisdrApprovalForwardFailed.mock.calls[0][0]).toMatchObject({
      approvalId: 42,
      decision: 'send',
      gaveUp: false,
    })
  })

  it('recovers on the 2nd try after a transient failure — does not queue', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ ok: true, text: async () => '' })

    const outcome = await runWithFakeBackoff(forwardApprovalDecision(fakeDb, baseInput))

    expect(outcome).toBe('forwarded')
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(h.markForwardForwarded).toHaveBeenCalledTimes(1)
    expect(h.markForwardFailed).not.toHaveBeenCalled()
  })

  it('uses an explicit per-try timeout (AbortSignal) on every fetch call', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => '' })

    await forwardApprovalDecision(fakeDb, baseInput)

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('never throws out of forwardApprovalDecision even when everything fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'))
    await expect(runWithFakeBackoff(forwardApprovalDecision(fakeDb, baseInput))).resolves.toBe(
      'failed_queued',
    )
  })
})

describe('forwardApprovalDecision — idempotency', () => {
  it('does not call the AI SDR twice for the same wa_message_id (Meta webhook redelivery)', async () => {
    h.claimForwardAttempt.mockResolvedValue({
      created: false,
      row: forwardRow({ status: 'forwarded' }),
    })

    const outcome = await forwardApprovalDecision(fakeDb, baseInput)

    expect(outcome).toBe('forwarded')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(h.markForwardForwarded).not.toHaveBeenCalled()
  })

  it('does not call the AI SDR twice for the same approval_id under a different wa_message_id (double tap)', async () => {
    h.findForwardedByApprovalId.mockResolvedValue(
      forwardRow({ waMessageId: 'wamid-original', status: 'forwarded' }),
    )

    const outcome = await forwardApprovalDecision(fakeDb, { ...baseInput, waMessageId: 'wamid-second-tap' })

    expect(outcome).toBe('skipped_duplicate')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(h.claimForwardAttempt).not.toHaveBeenCalled()
    expect(h.insertSkippedDuplicateForward).toHaveBeenCalledTimes(1)
  })
})

describe('reprocessFailedApprovalForwards — cron reprocessing', () => {
  it('recovers a row that now succeeds', async () => {
    h.getFailedForwardsForRetry.mockResolvedValue([forwardRow({ status: 'failed', attempts: 1 })])
    h.claimFailedForwardForRetry.mockResolvedValue(forwardRow({ status: 'pending', attempts: 2 }))
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => '' })

    const result = await runWithFakeBackoff(reprocessFailedApprovalForwards(fakeDb))

    expect(result).toEqual({ attempted: 1, recovered: 1, stillFailing: 0, gaveUp: 0 })
    expect(h.markForwardForwarded).toHaveBeenCalledTimes(1)
  })

  it('requeues as failed (not given up) while under the attempt budget', async () => {
    h.getFailedForwardsForRetry.mockResolvedValue([forwardRow({ status: 'failed', attempts: 2 })])
    h.claimFailedForwardForRetry.mockResolvedValue(forwardRow({ status: 'pending', attempts: 3 }))
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, text: async () => 'err' })

    const result = await runWithFakeBackoff(reprocessFailedApprovalForwards(fakeDb))

    expect(result).toEqual({ attempted: 1, recovered: 0, stillFailing: 1, gaveUp: 0 })
    expect(h.markForwardFailed).toHaveBeenCalledWith(fakeDb, 'fwd-1', expect.any(String), { giveUp: false })
    expect(h.alertAisdrApprovalForwardFailed).toHaveBeenCalledWith(
      expect.objectContaining({ gaveUp: false }),
    )
  })

  it('gives up for good once the attempt budget is exhausted, with a distinct alert', async () => {
    h.getFailedForwardsForRetry.mockResolvedValue([forwardRow({ status: 'failed', attempts: 5 })])
    h.claimFailedForwardForRetry.mockResolvedValue(forwardRow({ status: 'pending', attempts: 6 }))
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, text: async () => 'err' })

    const result = await runWithFakeBackoff(reprocessFailedApprovalForwards(fakeDb))

    expect(result).toEqual({ attempted: 1, recovered: 0, stillFailing: 0, gaveUp: 1 })
    expect(h.markForwardFailed).toHaveBeenCalledWith(fakeDb, 'fwd-1', expect.any(String), { giveUp: true })
    expect(h.alertAisdrApprovalForwardFailed).toHaveBeenCalledWith(
      expect.objectContaining({ gaveUp: true }),
    )
  })

  it('skips a row lost to a concurrent claim race, without counting it as failing', async () => {
    h.getFailedForwardsForRetry.mockResolvedValue([forwardRow({ status: 'failed' })])
    h.claimFailedForwardForRetry.mockResolvedValue(null)

    const result = await reprocessFailedApprovalForwards(fakeDb)

    expect(result).toEqual({ attempted: 1, recovered: 0, stillFailing: 0, gaveUp: 0 })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("one row's unexpected exception does not abort the sweep for the rest", async () => {
    h.getFailedForwardsForRetry.mockResolvedValue([
      forwardRow({ id: 'fwd-a', approvalId: 1, status: 'failed' }),
      forwardRow({ id: 'fwd-b', approvalId: 2, status: 'failed' }),
    ])
    h.claimFailedForwardForRetry.mockImplementation(async (_db: unknown, id: string) => {
      if (id === 'fwd-a') throw new Error('db blip claiming row')
      return forwardRow({ id: 'fwd-b', approvalId: 2, status: 'pending', attempts: 2 })
    })
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => '' })

    const result = await runWithFakeBackoff(reprocessFailedApprovalForwards(fakeDb))

    expect(result.attempted).toBe(2)
    expect(result.recovered).toBe(1)
    expect(result.stillFailing).toBe(1)
  })
})
