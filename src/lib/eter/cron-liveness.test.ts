import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sendWhatsAppAdminAlert: vi.fn() }))

vi.mock('../notifications/whatsapp-admin-alert', () => ({
  sendWhatsAppAdminAlert: h.sendWhatsAppAdminAlert,
}))

import { checkCronStaleness } from './cron-liveness'

afterEach(() => {
  delete process.env.AISDR_ALERT_ACCOUNT_ID
  vi.clearAllMocks()
})

describe('checkCronStaleness', () => {
  it('does nothing (just logs) when there is no previous heartbeat', async () => {
    await expect(
      checkCronStaleness({ cronName: 'test-cron', thresholdMs: 1000, previousHeartbeat: null }),
    ).resolves.toBeUndefined()
    expect(h.sendWhatsAppAdminAlert).not.toHaveBeenCalled()
  })

  it('does nothing when the gap is within the threshold', async () => {
    const now = new Date('2026-08-16T10:00:00Z')
    const previous = {
      cronName: 'test-cron',
      lastSuccessAt: new Date('2026-08-16T09:50:00Z'),
      lastResult: null,
      updatedAt: new Date('2026-08-16T09:50:00Z'),
    }

    await checkCronStaleness({
      cronName: 'test-cron',
      thresholdMs: 15 * 60 * 1000,
      previousHeartbeat: previous,
      now,
    })

    expect(h.sendWhatsAppAdminAlert).not.toHaveBeenCalled()
  })

  it('alerts when the gap exceeds the threshold and AISDR_ALERT_ACCOUNT_ID is set', async () => {
    process.env.AISDR_ALERT_ACCOUNT_ID = 'acct-alert'
    const now = new Date('2026-08-16T11:00:00Z')
    const previous = {
      cronName: 'test-cron',
      lastSuccessAt: new Date('2026-08-16T09:00:00Z'),
      lastResult: null,
      updatedAt: new Date('2026-08-16T09:00:00Z'),
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await checkCronStaleness({
      cronName: 'test-cron',
      thresholdMs: 45 * 60 * 1000,
      previousHeartbeat: previous,
      now,
    })

    expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledTimes(1)
    expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledWith(
      expect.stringContaining('test-cron'),
      { accountId: 'acct-alert' },
    )
    errorSpy.mockRestore()
  })

  it('logs loudly but does not send when the gap is stale and no alert account is configured', async () => {
    delete process.env.AISDR_ALERT_ACCOUNT_ID
    const now = new Date('2026-08-16T11:00:00Z')
    const previous = {
      cronName: 'test-cron',
      lastSuccessAt: new Date('2026-08-16T09:00:00Z'),
      lastResult: null,
      updatedAt: new Date('2026-08-16T09:00:00Z'),
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await checkCronStaleness({
      cronName: 'test-cron',
      thresholdMs: 45 * 60 * 1000,
      previousHeartbeat: previous,
      now,
    })

    expect(h.sendWhatsAppAdminAlert).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('never throws even if the underlying alert send rejects', async () => {
    process.env.AISDR_ALERT_ACCOUNT_ID = 'acct-alert'
    h.sendWhatsAppAdminAlert.mockRejectedValue(new Error('network down'))
    const now = new Date('2026-08-16T11:00:00Z')
    const previous = {
      cronName: 'test-cron',
      lastSuccessAt: new Date('2026-08-16T09:00:00Z'),
      lastResult: null,
      updatedAt: new Date('2026-08-16T09:00:00Z'),
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      checkCronStaleness({
        cronName: 'test-cron',
        thresholdMs: 45 * 60 * 1000,
        previousHeartbeat: previous,
        now,
      }),
    ).resolves.toBeUndefined()
    errorSpy.mockRestore()
  })
})
