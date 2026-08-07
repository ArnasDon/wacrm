import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createPendingAction,
  getPendingActionForConversation,
  resolvePendingAction,
} from './pending-actions.repo'

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa-1',
    account_id: 'acct-1',
    conversation_id: 'conv-1',
    contact_id: 'contact-1',
    tool_name: 'book_meeting',
    tool_input: { starts_at: '2026-08-20T09:00:00Z' },
    status: 'pending',
    resolved_at: null,
    resulting_booking_id: null,
    created_at: '2026-08-19T10:00:00Z',
    ...overrides,
  }
}

function makeDb(initialRows: Record<string, unknown>[] = []) {
  const rows = [...initialRows]
  const db = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            const row = { ...pendingRow(), ...payload, id: 'pa-new' }
            rows.push(row)
            return Promise.resolve({ data: row, error: null })
          },
        }),
      }),
      select: () => {
        const filters: [string, unknown][] = []
        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return builder
          },
          maybeSingle: () => {
            const match = rows.find((r) => filters.every(([c, v]) => r[c] === v))
            return Promise.resolve({ data: match ?? null, error: null })
          },
        }
        return builder
      },
      update: (payload: Record<string, unknown>) => {
        const filters: [string, unknown][] = []
        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return builder
          },
          select: () => ({
            single: () => {
              const idx = rows.findIndex((r) => filters.every(([c, v]) => r[c] === v))
              if (idx === -1)
                return Promise.resolve({ data: null, error: { message: 'not found' } })
              rows[idx] = { ...rows[idx], ...payload }
              return Promise.resolve({ data: rows[idx], error: null })
            },
          }),
        }
        return builder
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, rows }
}

describe('pending-actions.repo', () => {
  it('createPendingAction defaults status to pending and scopes to accountId', async () => {
    const { db } = makeDb()
    const action = await createPendingAction(db, 'acct-1', {
      conversationId: 'conv-1',
      toolName: 'book_meeting',
      toolInput: { starts_at: '2026-08-20T09:00:00Z' },
    })
    expect(action.status).toBe('pending')
    expect(action.accountId).toBe('acct-1')
    expect(action.toolName).toBe('book_meeting')
  })

  it('getPendingActionForConversation only returns rows still pending', async () => {
    const { db } = makeDb([pendingRow({ status: 'confirmed' })])
    expect(await getPendingActionForConversation(db, 'acct-1', 'conv-1')).toBeNull()
  })

  it('getPendingActionForConversation returns the pending row when present', async () => {
    const { db } = makeDb([pendingRow()])
    const action = await getPendingActionForConversation(db, 'acct-1', 'conv-1')
    expect(action?.id).toBe('pa-1')
  })

  it('resolvePendingAction only transitions rows still in pending status', async () => {
    const { db } = makeDb([pendingRow()])
    const resolved = await resolvePendingAction(db, 'acct-1', 'pa-1', {
      status: 'confirmed',
      resultingBookingId: 'bk-9',
    })
    expect(resolved.status).toBe('confirmed')
    expect(resolved.resultingBookingId).toBe('bk-9')
    expect(resolved.resolvedAt).toBeInstanceOf(Date)
  })

  it('resolvePendingAction throws when the action is already resolved (no double-apply)', async () => {
    const { db } = makeDb([pendingRow({ status: 'confirmed' })])
    await expect(
      resolvePendingAction(db, 'acct-1', 'pa-1', { status: 'confirmed' }),
    ).rejects.toBeTruthy()
  })
})
