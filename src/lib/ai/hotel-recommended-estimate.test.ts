import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRecommendedRoomEstimate } from './hotel-recommended-estimate'
const stay = { product_id: null, service_name: null, guests: 2, rooms: null, check_in: '2026-12-27', check_out: '2026-12-29', adults: null, children_ages: null }
const rates = ['sun', 'mon'].map(day => ({ day_of_week: day, occupancy: 'couple', price: 970, date_from: null, date_to: null }))
function dbFor(patch: Record<string, unknown> = {}, rateRows: unknown[] = rates) {
  const scopes: unknown[][] = []
  const db = { from(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (key: string, value: unknown) => { scopes.push([table, key, value]); return chain },
      maybeSingle: async () => ({ error: null, data: table === 'reservation_requests' ? { ...stay, ...patch } : { max_guests: 4 } }),
      then: (resolve: (v: unknown) => unknown) => resolve({ error: null, data: table === 'products' ? [{ id: 'master', name: 'Suite Master Deluxe' }, { id: 'premium', name: 'Suite Premium' }] : rateRows }),
      update: () => { throw new Error('Recommendation must never update a record') },
      insert: () => { throw new Error('Recommendation must never insert a record') },
    }
    return chain
  } }
  return { db: db as unknown as SupabaseClient, scopes }
}
const args = { accountId: 'hotel', conversationId: 'richard', roomNames: ['Suite Master Deluxe', 'Suite Premium'], modelText: 'Una buena opcion es la Suite Master Deluxe, o la Suite Premium.', todayISO: '2026-10-17', currency: 'GTQ' }
describe('suggested room estimates without customer selection', () => {
  it('prices Richard two nights using the published nightly tariffs without selecting a room', async () => {
    const { db, scopes } = dbFor()
    const result = await loadRecommendedRoomEstimate({ ...args, db })
    expect(result).toMatchObject({ productName: 'Suite Master Deluxe', total: 1940 })
    expect(result?.text).toContain('27/12/2026')
    expect(result?.text).toContain('29/12/2026')
    expect(result?.text).toContain('2 noches')
    expect(result?.text).toContain('estimado')
    expect(scopes.filter(s => s[1] === 'account_id').every(s => s[2] === 'hotel')).toBe(true)
  })
  it.each([{ check_out: null }, { guests: null }, { rooms: 2 }, { product_id: 'chosen' }, { service_name: 'Suite Premium' }, { guest_confirmed_at: '2026-10-17' }, { check_in: '2026-09-01', check_out: '2026-09-03' }])('does not guess or override a selected/historical stay: %j', async patch => {
    expect(await loadRecommendedRoomEstimate({ ...args, db: dbFor(patch).db })).toBeNull()
  })
  it('does not quote a total when a night has no tariff', async () => {
    expect(await loadRecommendedRoomEstimate({ ...args, db: dbFor({}, rates.slice(0, 1)).db })).toBeNull()
  })
  it('respects seasonal overrides', async () => {
    const seasonal = rates.map(r => ({ ...r, price: 1200, date_from: '2026-12-20', date_to: '2027-01-01' }))
    expect(await loadRecommendedRoomEstimate({ ...args, db: dbFor({}, [...rates, ...seasonal]).db })).toMatchObject({ total: 2400 })
  })
  it('does not price a room mentioned as unavailable', async () => {
    const result = await loadRecommendedRoomEstimate({ ...args, db: dbFor().db, modelText: 'No ofrecemos la Suite Master Deluxe. Una buena opcion es la Suite Premium.' })
    expect(result?.productName).toBe('Suite Premium')
  })
  it('requires an actual room recommendation', async () => {
    expect(await loadRecommendedRoomEstimate({ ...args, db: dbFor().db, modelText: 'Con gusto, gracias.' })).toBeNull()
  })
  it('does not infer adults when child pricing needs a party breakdown', async () => {
    expect(await loadRecommendedRoomEstimate({ ...args, db: dbFor({}, [...rates, ...rates.map(r => ({ ...r, occupancy: 'child', price: 200 }))]).db })).toBeNull()
  })
})
