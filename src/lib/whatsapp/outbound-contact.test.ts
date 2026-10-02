import { describe, it, expect, vi } from 'vitest'
import { fetchContactForOutboundSend } from './outbound-contact'

describe('fetchContactForOutboundSend', () => {
  it('falls back to id+phone when wa_user_id column is missing', async () => {
    let calls = 0
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                calls++
                if (calls === 1) {
                  return {
                    data: null,
                    error: {
                      message: 'column contacts.wa_user_id does not exist',
                      code: '42703',
                    },
                  }
                }
                return { data: { id: 'c1', phone: '+15551230000' }, error: null }
              },
            }),
          }),
        }),
      }),
    }

    const row = await fetchContactForOutboundSend(
      db as never,
      'acct-1',
      'c1',
    )
    expect(row).toEqual({
      id: 'c1',
      phone: '+15551230000',
      wa_user_id: null,
    })
    expect(calls).toBe(2)
  })
})
