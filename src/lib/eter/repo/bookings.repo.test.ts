import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createBooking,
  getBooking,
  findBookings,
  findConfirmedBookingsInRange,
  updateBooking,
} from './bookings.repo'

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    account_id: 'acct-1',
    contact_id: 'contact-1',
    conversation_id: 'conv-1',
    external_event_id: null,
    starts_at: '2026-08-20T09:00:00.000Z',
    ends_at: '2026-08-20T09:30:00.000Z',
    status: 'proposed',
    service: 'Demo',
    notes: null,
    ...overrides,
  }
}

/** Minimal chainable fake mirroring the subset of PostgrestFilterBuilder
 *  the repo uses. Records every filter call so tests can assert account
 *  scoping without depending on Supabase internals. */
class FakeQuery {
  filters: { method: string; args: unknown[] }[] = []
  table: string
  op: 'select' | 'insert' | 'update' | null = null
  payload: Record<string, unknown> | null = null
  rows: Record<string, unknown>[]

  constructor(table: string, rows: Record<string, unknown>[]) {
    this.table = table
    this.rows = rows
  }

  select() {
    if (!this.op) this.op = 'select'
    return this
  }
  insert(payload: Record<string, unknown>) {
    this.op = 'insert'
    this.payload = payload
    return this
  }
  update(payload: Record<string, unknown>) {
    this.op = 'update'
    this.payload = payload
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push({ method: 'eq', args: [col, val] })
    return this
  }
  gte(col: string, val: unknown) {
    this.filters.push({ method: 'gte', args: [col, val] })
    return this
  }
  lte(col: string, val: unknown) {
    this.filters.push({ method: 'lte', args: [col, val] })
    return this
  }
  lt(col: string, val: unknown) {
    this.filters.push({ method: 'lt', args: [col, val] })
    return this
  }
  gt(col: string, val: unknown) {
    this.filters.push({ method: 'gt', args: [col, val] })
    return this
  }
  in(col: string, vals: unknown[]) {
    this.filters.push({ method: 'in', args: [col, vals] })
    return this
  }
  order(col: string, opts: unknown) {
    this.filters.push({ method: 'order', args: [col, opts] })
    return this
  }
  single() {
    if (this.op === 'insert') {
      const row = { ...bookingRow(), ...this.payload, id: 'bk-new' }
      this.rows.push(row)
      return Promise.resolve({ data: row, error: null })
    }
    if (this.op === 'update') {
      const target = this.filters.find((f) => f.args[0] === 'id')?.args[1]
      const idx = this.rows.findIndex((r) => r.id === target)
      if (idx === -1) return Promise.resolve({ data: null, error: { message: 'not found' } })
      this.rows[idx] = { ...this.rows[idx], ...this.payload }
      return Promise.resolve({ data: this.rows[idx], error: null })
    }
    return Promise.resolve({ data: this.rows[0] ?? null, error: null })
  }
  maybeSingle() {
    const scoped = this.applyFilters(this.rows)
    return Promise.resolve({ data: scoped[0] ?? null, error: null })
  }
  applyFilters(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.filter((r) =>
      this.filters.every((f) => {
        if (f.method === 'eq') return r[f.args[0] as string] === f.args[1]
        if (f.method === 'in')
          return (f.args[1] as unknown[]).includes(r[f.args[0] as string])
        return true // range filters not needed for these fixture sizes
      }),
    )
  }
  then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) {
    resolve({ data: this.applyFilters(this.rows), error: null })
  }
}

function makeDb(initialRows: Record<string, unknown>[] = []) {
  const rows = [...initialRows]
  const db = {
    from: (table: string) => new FakeQuery(table, rows),
  }
  return { db: db as unknown as SupabaseClient, rows }
}

describe('bookings.repo', () => {
  it('createBooking scopes the insert to accountId and defaults status to proposed', async () => {
    const { db } = makeDb()
    const booking = await createBooking(db, 'acct-1', {
      contactId: 'contact-1',
      startsAt: new Date('2026-08-20T09:00:00Z'),
      endsAt: new Date('2026-08-20T09:30:00Z'),
    })
    expect(booking.accountId).toBe('acct-1')
    expect(booking.status).toBe('proposed')
  })

  it('getBooking returns null for a booking that belongs to a different account', async () => {
    const { db } = makeDb([bookingRow({ id: 'bk-1', account_id: 'acct-OTHER' })])
    expect(await getBooking(db, 'acct-1', 'bk-1')).toBeNull()
  })

  it('getBooking returns the booking when accountId matches', async () => {
    const { db } = makeDb([bookingRow()])
    const booking = await getBooking(db, 'acct-1', 'bk-1')
    expect(booking?.id).toBe('bk-1')
    expect(booking?.startsAt).toBeInstanceOf(Date)
  })

  it('findBookings defaults to proposed + confirmed and excludes cancelled', async () => {
    const { db } = makeDb([
      bookingRow({ id: 'bk-1', status: 'proposed' }),
      bookingRow({ id: 'bk-2', status: 'confirmed' }),
      bookingRow({ id: 'bk-3', status: 'cancelled' }),
    ])
    const results = await findBookings(db, 'acct-1', {})
    expect(results.map((b) => b.id).sort()).toEqual(['bk-1', 'bk-2'])
  })

  it('findConfirmedBookingsInRange only returns confirmed status rows', async () => {
    const { db } = makeDb([
      bookingRow({ id: 'bk-1', status: 'confirmed' }),
      bookingRow({ id: 'bk-2', status: 'proposed' }),
    ])
    const results = await findConfirmedBookingsInRange(
      db,
      'acct-1',
      new Date('2026-08-20T00:00:00Z'),
      new Date('2026-08-21T00:00:00Z'),
    )
    expect(results.map((b) => b.id)).toEqual(['bk-1'])
  })

  it('updateBooking only patches provided fields and stays account-scoped', async () => {
    const { db } = makeDb([bookingRow()])
    const updated = await updateBooking(db, 'acct-1', 'bk-1', { status: 'confirmed' })
    expect(updated.status).toBe('confirmed')
    expect(updated.service).toBe('Demo') // untouched field preserved
  })
})
