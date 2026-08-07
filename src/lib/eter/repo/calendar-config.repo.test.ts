import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

import {
  getCalendarConfig,
  upsertCalendarConfig,
  setCalendarConfigActive,
  updateCalendarConfigRefreshToken,
  deleteCalendarConfig,
} from './calendar-config.repo'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cc-1',
    account_id: 'acct-1',
    provider: 'google',
    refresh_token: 'enc:refresh-plain',
    calendar_id: 'primary',
    timezone: 'Europe/Lisbon',
    business_hours: { mon: [['09:00', '18:00']] },
    default_duration_min: 30,
    buffer_min: 15,
    min_lead_time_min: 60,
    is_active: true,
    ...overrides,
  }
}

function makeDb(state: { row: Record<string, unknown> | null }) {
  const calls: { method: string; args: unknown[] }[] = []
  const db = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            calls.push({ method: 'select.eq', args: [col, val] })
            return { maybeSingle: () => Promise.resolve({ data: state.row, error: null }) }
          },
        }),
        upsert: (payload: Record<string, unknown>) => {
          calls.push({ method: 'upsert', args: [payload] })
          state.row = { ...row(), ...payload, id: 'cc-1' }
          return {
            select: () => ({
              single: () => Promise.resolve({ data: state.row, error: null }),
            }),
          }
        },
        update: (payload: Record<string, unknown>) => {
          calls.push({ method: 'update', args: [payload] })
          return {
            eq: (col: string, val: string) => {
              calls.push({ method: 'update.eq', args: [col, val] })
              return Promise.resolve({ error: null })
            },
          }
        },
        delete: () => ({
          eq: (col: string, val: string) => {
            calls.push({ method: 'delete.eq', args: [col, val] })
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }
  return { db: db as unknown as SupabaseClient, calls, state }
}

describe('calendar-config.repo', () => {
  it('getCalendarConfig scopes by accountId and decrypts the refresh token', async () => {
    const { db, calls } = makeDb({ row: row() })
    const cfg = await getCalendarConfig(db, 'acct-1')
    expect(cfg?.refreshToken).toBe('refresh-plain')
    expect(cfg?.timezone).toBe('Europe/Lisbon')
    expect(calls).toContainEqual({ method: 'select.eq', args: ['account_id', 'acct-1'] })
  })

  it('getCalendarConfig returns null when there is no row', async () => {
    const { db } = makeDb({ row: null })
    expect(await getCalendarConfig(db, 'acct-1')).toBeNull()
  })

  it('upsertCalendarConfig encrypts the refresh token before writing and keys on account_id', async () => {
    const { db, calls } = makeDb({ row: null })
    await upsertCalendarConfig(db, 'acct-1', {
      refreshToken: 'new-secret',
      calendarId: 'primary',
      timezone: 'Europe/Lisbon',
    })
    const upsertCall = calls.find((c) => c.method === 'upsert')!
    const payload = upsertCall.args[0] as Record<string, unknown>
    expect(payload.refresh_token).toBe('enc:new-secret')
    expect(payload.account_id).toBe('acct-1')
    // Plaintext secret never appears verbatim in what gets sent to Supabase.
    expect(JSON.stringify(payload)).not.toContain('"new-secret"')
  })

  it('setCalendarConfigActive scopes the update by accountId', async () => {
    const { db, calls } = makeDb({ row: row() })
    await setCalendarConfigActive(db, 'acct-1', false)
    expect(calls).toContainEqual({ method: 'update', args: [{ is_active: false }] })
    expect(calls).toContainEqual({ method: 'update.eq', args: ['account_id', 'acct-1'] })
  })

  it('updateCalendarConfigRefreshToken encrypts before writing', async () => {
    const { db, calls } = makeDb({ row: row() })
    await updateCalendarConfigRefreshToken(db, 'acct-1', 'rotated-secret')
    const updateCall = calls.find((c) => c.method === 'update')!
    expect((updateCall.args[0] as Record<string, unknown>).refresh_token).toBe(
      'enc:rotated-secret',
    )
  })

  it('deleteCalendarConfig scopes by accountId', async () => {
    const { db, calls } = makeDb({ row: row() })
    await deleteCalendarConfig(db, 'acct-1')
    expect(calls).toContainEqual({ method: 'delete.eq', args: ['account_id', 'acct-1'] })
  })
})
