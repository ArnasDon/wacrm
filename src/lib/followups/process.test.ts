import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const sendPushToAccount = vi.fn()
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }))
vi.mock('@/lib/push/server', () => ({ sendPushToAccount: (...a: unknown[]) => sendPushToAccount(...a) }))

import { runFollowupReminders } from './process'

const row = (kind: 'tomorrow' | 'due') => ({
  out_notification_id: 'n1',
  out_account_id: 'acct',
  out_user_id: 'user-1',
  out_conversation_id: 'conv-1',
  out_kind: kind,
  out_title: 'Follow-up tomorrow: Ravi Kumar',
  out_body: 'Call back (due 31 Oct 2026)',
})

beforeEach(() => {
  rpc.mockReset()
  sendPushToAccount.mockReset().mockResolvedValue({ sent: 1 })
  delete process.env.FOLLOWUP_TIMEZONE
  delete process.env.FOLLOWUP_REMIND_HOUR
})

describe('runFollowupReminders', () => {
  it('uses Asia/Kolkata and 9 AM by default and pushes each new reminder to its owner', async () => {
    rpc.mockResolvedValue({ data: [row('tomorrow')], error: null })
    const r = await runFollowupReminders()
    expect(rpc).toHaveBeenCalledWith('process_followup_reminders', { p_tz: 'Asia/Kolkata', p_min_hour: 9 })
    expect(r).toEqual({ created: 1 })
    const [acct, payload, opts] = sendPushToAccount.mock.calls[0]
    expect(acct).toBe('acct')
    expect(opts).toEqual({ userId: 'user-1' })
    expect(payload).toMatchObject({
      v: 1,
      conversationId: 'conv-1',
      title: 'Follow-up tomorrow: Ravi Kumar',
      url: '/inbox?c=conv-1',
    })
  })

  it('honours env overrides', async () => {
    process.env.FOLLOWUP_TIMEZONE = 'Europe/London'
    process.env.FOLLOWUP_REMIND_HOUR = '8'
    rpc.mockResolvedValue({ data: [], error: null })
    await runFollowupReminders()
    expect(rpc).toHaveBeenCalledWith('process_followup_reminders', { p_tz: 'Europe/London', p_min_hour: 8 })
    expect(sendPushToAccount).not.toHaveBeenCalled()
  })

  it('reports a database error without throwing or pushing', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    const r = await runFollowupReminders()
    expect(r.created).toBe(0)
    expect(r.error).toContain('does not exist')
    expect(sendPushToAccount).not.toHaveBeenCalled()
  })

  it('a failing push does not lose the reminder', async () => {
    rpc.mockResolvedValue({ data: [row('due')], error: null })
    sendPushToAccount.mockRejectedValue(new Error('push down'))
    await expect(runFollowupReminders()).resolves.toEqual({ created: 1 })
  })
})
