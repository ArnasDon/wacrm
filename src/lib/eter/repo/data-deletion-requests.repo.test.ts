import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createDeletionRequest,
  getPendingDeletionRequestForPhone,
  cancelPendingDeletionRequest,
  markDeletionRequestNotified,
} from './data-deletion-requests.repo'

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ddr-1',
    account_id: 'acct-1',
    conversation_id: 'conv-1',
    contact_id: 'contact-1',
    phone: '351911111111',
    profile_name: 'Maria',
    status: 'pending',
    requested_at: '2026-08-12T10:00:00Z',
    cancelled_at: null,
    completed_at: null,
    notified_at: null,
    created_at: '2026-08-12T10:00:00Z',
    ...overrides,
  }
}

function makeDb(initialRows: Record<string, unknown>[] = []) {
  const rows = [...initialRows]
  let nextId = 1
  const db = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            const row = { ...requestRow(), ...payload, id: `ddr-new-${nextId++}` }
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
        const apply = () => {
          const idx = rows.findIndex((r) => filters.every(([c, v]) => r[c] === v))
          if (idx === -1) return { data: null, error: null }
          rows[idx] = { ...rows[idx], ...payload }
          return { data: rows[idx], error: null }
        }
        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return builder
          },
          select: () => ({
            maybeSingle: () => Promise.resolve(apply()),
          }),
          // Some call sites (markDeletionRequestNotified) await the
          // builder directly without a trailing `.select()` - making
          // it thenable lets `await db.from(...).update(...).eq()...`
          // resolve to `{ error }` the same way the real
          // supabase-js query builder does.
          then: (resolve: (value: { data: unknown; error: null }) => void) => {
            resolve(apply())
          },
        }
        return builder
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, rows }
}

describe('data-deletion-requests.repo', () => {
  it('createDeletionRequest inserts a pending row scoped to accountId', async () => {
    const { db } = makeDb()
    const { request, created } = await createDeletionRequest(db, 'acct-1', {
      conversationId: 'conv-1',
      contactId: 'contact-1',
      phone: '351911111111',
      profileName: 'Maria',
    })

    expect(created).toBe(true)
    expect(request.status).toBe('pending')
    expect(request.accountId).toBe('acct-1')
    expect(request.phone).toBe('351911111111')
  })

  it('createDeletionRequest is idempotent: a second call for the same phone returns the existing pending row', async () => {
    const { db, rows } = makeDb([requestRow()])
    const { request, created } = await createDeletionRequest(db, 'acct-1', {
      conversationId: 'conv-1',
      contactId: 'contact-1',
      phone: '351911111111',
      profileName: 'Maria',
    })

    expect(created).toBe(false)
    expect(request.id).toBe('ddr-1')
    expect(rows).toHaveLength(1)
  })

  it('createDeletionRequest scopes the pending lookup to accountId, a different account can create its own request', async () => {
    const { db } = makeDb([requestRow({ account_id: 'acct-other' })])
    const { created } = await createDeletionRequest(db, 'acct-1', {
      conversationId: 'conv-1',
      contactId: 'contact-1',
      phone: '351911111111',
      profileName: 'Maria',
    })

    expect(created).toBe(true)
  })

  it('getPendingDeletionRequestForPhone returns null when there is nothing pending', async () => {
    const { db } = makeDb()
    const result = await getPendingDeletionRequestForPhone(db, 'acct-1', '351911111111')
    expect(result).toBeNull()
  })

  it('cancelPendingDeletionRequest resolves the pending row to cancelled', async () => {
    const { db, rows } = makeDb([requestRow()])
    const cancelled = await cancelPendingDeletionRequest(db, 'acct-1', '351911111111')

    expect(cancelled).not.toBeNull()
    expect(cancelled?.status).toBe('cancelled')
    expect(rows[0].status).toBe('cancelled')
    expect(rows[0].cancelled_at).not.toBeNull()
  })

  it('cancelPendingDeletionRequest returns null when there is nothing pending to cancel', async () => {
    const { db } = makeDb()
    const cancelled = await cancelPendingDeletionRequest(db, 'acct-1', '351911111111')
    expect(cancelled).toBeNull()
  })

  it('markDeletionRequestNotified updates notified_at', async () => {
    const { db, rows } = makeDb([requestRow()])
    await markDeletionRequestNotified(db, 'acct-1', 'ddr-1')
    expect(rows[0].notified_at).not.toBeNull()
  })
})
