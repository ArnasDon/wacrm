import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCronHeartbeat, recordCronHeartbeat } from './cron-heartbeats.repo'

describe('getCronHeartbeat', () => {
  it('returns null when no row exists for this cron', async () => {
    const db = {
      from: () => ({
        select: () => {
          const builder = { eq: () => builder, maybeSingle: () => Promise.resolve({ data: null, error: null }) }
          return builder
        },
      }),
    } as unknown as SupabaseClient

    expect(await getCronHeartbeat(db, 'some-cron')).toBeNull()
  })

  it('maps a row to domain shape', async () => {
    const row = {
      cron_name: 'some-cron',
      last_success_at: '2026-08-16T10:00:00Z',
      last_result: { attempted: 1 },
      updated_at: '2026-08-16T10:00:00Z',
    }
    const db = {
      from: () => ({
        select: () => {
          const builder = { eq: () => builder, maybeSingle: () => Promise.resolve({ data: row, error: null }) }
          return builder
        },
      }),
    } as unknown as SupabaseClient

    const result = await getCronHeartbeat(db, 'some-cron')
    expect(result?.cronName).toBe('some-cron')
    expect(result?.lastSuccessAt).toEqual(new Date('2026-08-16T10:00:00Z'))
    expect(result?.lastResult).toEqual({ attempted: 1 })
  })

  it('throws on a DB error', async () => {
    const db = {
      from: () => ({
        select: () => {
          const builder = {
            eq: () => builder,
            maybeSingle: () => Promise.resolve({ data: null, error: new Error('db down') }),
          }
          return builder
        },
      }),
    } as unknown as SupabaseClient

    await expect(getCronHeartbeat(db, 'some-cron')).rejects.toThrow()
  })
})

describe('recordCronHeartbeat', () => {
  it('upserts on cron_name conflict', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const db = { from: () => ({ upsert }) } as unknown as SupabaseClient

    await recordCronHeartbeat(db, 'some-cron', { ok: true }, new Date('2026-08-16T10:00:00Z'))

    expect(upsert).toHaveBeenCalledWith(
      {
        cron_name: 'some-cron',
        last_success_at: '2026-08-16T10:00:00.000Z',
        last_result: { ok: true },
      },
      { onConflict: 'cron_name' },
    )
  })

  it('throws on a DB error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: new Error('db down') })
    const db = { from: () => ({ upsert }) } as unknown as SupabaseClient

    await expect(recordCronHeartbeat(db, 'some-cron', {})).rejects.toThrow()
  })
})
