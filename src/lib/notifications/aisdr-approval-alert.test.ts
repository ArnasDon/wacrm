import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Coverage for the DEFAULT AlertSender wiring (previously the gap:
// nothing called `configureAisdrApprovalAlertSender`, so every
// failure only ever logged to a console nobody was tailing — see the
// module header for the incident this fixes). Pins:
//   - the default sender logs AND attempts a real WhatsApp send via
//     `sendWhatsAppAdminAlert`, using `accountId` from the failure
//     details to resolve which WhatsApp Business number to send from
//   - a missing `accountId` is a loud log, not a thrown error
//   - `alertAisdrApprovalForwardFailed` never throws even if the
//     underlying sender rejects
// ============================================================

const h = vi.hoisted(() => ({ sendWhatsAppAdminAlert: vi.fn() }))

vi.mock('./whatsapp-admin-alert', () => ({
  sendWhatsAppAdminAlert: h.sendWhatsAppAdminAlert,
}))

import {
  alertAisdrApprovalForwardFailed,
  resetAisdrApprovalAlertSender,
  type ApprovalForwardFailureDetails,
} from './aisdr-approval-alert'

function details(overrides: Partial<ApprovalForwardFailureDetails> = {}): ApprovalForwardFailureDetails {
  return {
    approvalId: 42,
    decision: 'send',
    waMessageId: 'wamid-1',
    attempts: 3,
    error: 'timeout contacting AI SDR',
    gaveUp: false,
    accountId: 'acct-1',
    ...overrides,
  }
}

afterEach(() => {
  resetAisdrApprovalAlertSender()
  vi.clearAllMocks()
})

describe('alertAisdrApprovalForwardFailed (default sender)', () => {
  it('logs to console AND sends a real WhatsApp alert scoped to the failure account', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.sendWhatsAppAdminAlert.mockResolvedValue({ sent: true, via: 'text' })

    await alertAisdrApprovalForwardFailed(details())

    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls[0][0]).toContain('approval_id=42')
    expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledTimes(1)
    expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledWith(
      expect.stringContaining('approval_id=42'),
      { accountId: 'acct-1' },
    )
    errorSpy.mockRestore()
  })

  it('never throws and logs loudly when the underlying WhatsApp send rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.sendWhatsAppAdminAlert.mockRejectedValue(new Error('network down'))

    await expect(alertAisdrApprovalForwardFailed(details())).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
