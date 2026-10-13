import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }))

import { gradeHealth, renderWeeklyHealthEmail, type HealthRow } from './weekly-health'

const base: HealthRow = {
  account_id: 'a', name: 'Hotel', industry_vertical: 'hotel', suspended: false,
  inbound: 100, inbound_prev: 90, conversations: 20, ai_replies: 50, staff_replies: 30,
  first_response_median_min: 1, waiting_over_2h: 0, handoffs: 3, handoffs_unattended: 0,
  ai_records: 5, followups_sent: 2, followups_failed: 0, ai_tokens: 1000,
  alerts_critical: 0, alerts_other: 0,
}

describe('gradeHealth', () => {
  it('is green on a normal week', () => {
    expect(gradeHealth(base)).toMatchObject({ status: 'green', reasons: [] })
  })

  it('is red on a critical alert, unattended hand-off or a traffic collapse', () => {
    expect(gradeHealth({ ...base, alerts_critical: 1 }).status).toBe('red')
    expect(gradeHealth({ ...base, handoffs_unattended: 1 }).status).toBe('red')
    expect(gradeHealth({ ...base, inbound: 40, inbound_prev: 100 }).status).toBe('red')
  })

  it('ignores a drop from a tiny base', () => {
    expect(gradeHealth({ ...base, inbound: 2, inbound_prev: 10 }).status).toBe('green')
  })

  it('is yellow on slow first response, waiting chats or no traffic, red reasons first', () => {
    expect(gradeHealth({ ...base, first_response_median_min: 21.4 }).status).toBe('yellow')
    expect(gradeHealth({ ...base, waiting_over_2h: 5 }).status).toBe('yellow')
    expect(gradeHealth({ ...base, inbound: 0, inbound_prev: 0 }).status).toBe('yellow')
    const both = gradeHealth({ ...base, alerts_critical: 1, alerts_other: 1 })
    expect(both.reasons[0]).toContain('crítica')
  })
})

describe('renderWeeklyHealthEmail', () => {
  it('counts statuses in the subject and lists reasons', () => {
    const rows = [gradeHealth({ ...base, name: 'A', alerts_critical: 1 }), gradeHealth({ ...base, name: 'B' })]
    const { subject, text } = renderWeeklyHealthEmail(rows, 'https://chatsandia.com')
    expect(subject).toContain('1 en rojo, 0 en amarillo, 1 en verde')
    expect(text).toContain('→ 1 alerta(s) crítica(s)')
    expect(text).toContain('https://chatsandia.com/admin')
  })
})
