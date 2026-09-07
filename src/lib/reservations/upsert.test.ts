import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const dispatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: dispatch }))

import { upsertReservationRequest, categorySlugFromName } from './upsert'

describe('categorySlugFromName', () => {
  it('maps the hotel kit category names', () => {
    expect(categorySlugFromName('Habitaciones')).toBe('habitaciones')
    expect(categorySlugFromName('Spa')).toBe('spa')
    expect(categorySlugFromName('Actividades al aire libre')).toBe('actividades')
    expect(categorySlugFromName('Paquetes')).toBe('paquetes')
    expect(categorySlugFromName('Eventos')).toBe('eventos')
  })

  it('is fuzzy (renames / synonyms / other language)', () => {
    expect(categorySlugFromName('Rooms')).toBe('habitaciones')
    expect(categorySlugFromName('Tours y excursiones')).toBe('actividades')
    expect(categorySlugFromName('Salón de bodas')).toBe('eventos')
    expect(categorySlugFromName('Packages')).toBe('paquetes')
  })

  it('returns null for a non-hotel / empty / unknown category', () => {
    expect(categorySlugFromName(null)).toBeNull()
    expect(categorySlugFromName('')).toBeNull()
    expect(categorySlugFromName('Muebles')).toBeNull()
  })
})

beforeEach(() => dispatch.mockReset().mockResolvedValue(undefined))

/** Minimal admin-client stub. `existing` is what a `(conversation, category)`
 *  lookup returns; captures the insert/update payloads. */
function makeAdmin(existing: { id: string } | null) {
  const calls = { inserted: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[] }
  const admin = {
    from(table: string) {
      if (table !== 'reservation_requests') throw new Error('unexpected table ' + table)
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) }) }) }),
        }),
        update: (p: Record<string, unknown>) => {
          calls.updated.push(p)
          return { eq: () => Promise.resolve({ error: null }) }
        },
        insert: (p: Record<string, unknown>) => {
          calls.inserted.push(p)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-id' }, error: null }) }) }
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, calls }
}

describe('upsertReservationRequest', () => {
  it('inserts when there is no conversation match, then fires reservation.updated', async () => {
    const { admin, calls } = makeAdmin(null)
    const id = await upsertReservationRequest(admin, 'acct-1', {
      category: 'spa',
      service_name: 'Masaje',
      guests: 2,
      source: 'catalog',
    })
    expect(id).toBe('new-id')
    expect(calls.inserted[0]).toMatchObject({
      account_id: 'acct-1',
      category: 'spa',
      source: 'catalog',
      service_name: 'Masaje',
      guests: 2,
    })
    expect(dispatch).toHaveBeenCalledWith(admin, 'acct-1', 'reservation.updated', {
      reservation_id: 'new-id',
      source: 'catalog',
    })
  })

  it('extends an existing (conversation, category) row with only the provided fields', async () => {
    const { admin, calls } = makeAdmin({ id: 'r1' })
    const id = await upsertReservationRequest(admin, 'acct-1', {
      category: 'habitaciones',
      conversation_id: 'conv-1',
      guests: 3, // only this field this turn
    })
    expect(id).toBe('r1')
    expect(calls.inserted).toHaveLength(0)
    expect(calls.updated).toEqual([{ guests: 3, conversation_id: 'conv-1' }])
    expect(dispatch).toHaveBeenCalledWith(admin, 'acct-1', 'reservation.updated', {
      reservation_id: 'r1',
      source: 'manual',
    })
  })

  it('does not blank fields the caller omitted (undefined ≠ null)', async () => {
    const { admin, calls } = makeAdmin({ id: 'r1' })
    await upsertReservationRequest(admin, 'acct-1', {
      category: 'habitaciones',
      conversation_id: 'conv-1',
      check_in: '2026-03-13',
    })
    expect(calls.updated[0]).not.toHaveProperty('check_out')
    expect(calls.updated[0]).not.toHaveProperty('guests')
  })
})
