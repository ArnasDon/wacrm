import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  recordDeletionInsertFailure,
  getFailedDeletionInsertsForRetry,
  markDeletionInsertRecovered,
  markDeletionInsertFailedAgain,
} from './data-deletion-insert-failures.repo'

function failureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fail-1',
    account_id: 'acct-1',
    conversation_id: 'conv-1',
    contact_id: 'contact-1',
    phone: '351911111111',
    profile_name: 'Maria',
    status: 'failed',
    attempts: 1,
    last_error: 'connection reset',
    recovered_at: null,
    created_at: '2026-08-12T10:00:00Z',
    updated_at: '2026-08-12T10:00:00Z',
    ...overrides,
  }
}

describe('recordDeletionInsertFailure', () => {
  it('inserts a new failure row on the happy path', async () => {
    const insertedPayloads: Record<string, unknown>[] = []
    const db = {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          insertedPayloads.push(payload)
          return {
            select: () => ({
              single: () => Promise.resolve({ data: failureRow(payload), error: null }),
            }),
          }
        },
      }),
    } as unknown as SupabaseClient

    const result = await recordDeletionInsertFailure(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      phone: '351911111111',
      profileName: 'Maria',
      error: 'connection reset',
    })

    expect(insertedPayloads[0]).toMatchObject({ account_id: 'acct-1', phone: '351911111111', status: 'failed' })
    expect(result.id).toBe('fail-1')
    expect(result.attempts).toBe(1)
  })

  it('bumps attempts on an existing failed row instead of duplicating (idempotency guard)', async () => {
    const existing = failureRow({ attempts: 2 })
    let updatedPayload: Record<string, unknown> | null = null

    const db = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }),
          }),
        }),
        select: () => {
          const builder = {
            eq: () => builder,
            maybeSingle: () => Promise.resolve({ data: existing, error: null }),
          }
          return builder
        },
        update: (payload: Record<string, unknown>) => {
          updatedPayload = payload
          return {
            eq: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { ...existing, ...payload },
                    error: null,
                  }),
              }),
            }),
          }
        },
      }),
    } as unknown as SupabaseClient

    const result = await recordDeletionInsertFailure(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      phone: '351911111111',
      profileName: 'Maria',
      error: 'still down',
    })

    expect(updatedPayload).toEqual({ attempts: 3, last_error: 'still down' })
    expect(result.attempts).toBe(3)
  })
})

describe('getFailedDeletionInsertsForRetry', () => {
  it('returns due failed rows, mapped to domain shape', async () => {
    const db = {
      from: () => ({
        select: () => {
          const builder = {
            eq: () => builder,
            order: () => builder,
            limit: () => Promise.resolve({ data: [failureRow()], error: null }),
          }
          return builder
        },
      }),
    } as unknown as SupabaseClient

    const rows = await getFailedDeletionInsertsForRetry(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].phone).toBe('351911111111')
  })
})

describe('markDeletionInsertRecovered / markDeletionInsertFailedAgain', () => {
  it('markDeletionInsertRecovered updates status to recovered', async () => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    const db = { from: () => ({ update }) } as unknown as SupabaseClient

    await markDeletionInsertRecovered(db, 'fail-1')

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'recovered' }),
    )
  })

  it('markDeletionInsertFailedAgain sets gave_up when requested', async () => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    const db = { from: () => ({ update }) } as unknown as SupabaseClient

    await markDeletionInsertFailedAgain(db, 'fail-1', 5, 'permanent failure', { giveUp: true })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'gave_up', attempts: 5, last_error: 'permanent failure' }),
    )
  })

  it('throws when the update itself errors', async () => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: new Error('db down') }) })
    const db = { from: () => ({ update }) } as unknown as SupabaseClient

    await expect(markDeletionInsertRecovered(db, 'fail-1')).rejects.toThrow()
  })
})
