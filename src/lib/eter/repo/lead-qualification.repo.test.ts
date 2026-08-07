import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getLeadQualification, upsertLeadQualification } from './lead-qualification.repo'

function lqRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lq-1',
    account_id: 'acct-1',
    contact_id: 'contact-1',
    score: 40,
    stage: 'em_qualificacao',
    urgency: 'medium',
    answers: { budget: 'yes' },
    qualified_at: null,
    ...overrides,
  }
}

function makeDb(initial: Record<string, unknown> | null) {
  let row = initial
  const calls: { method: string; args: unknown[] }[] = []
  const db = {
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => {
          calls.push({ method: 'eq', args: [col, val] })
          return {
            eq: (col2: string, val2: string) => {
              calls.push({ method: 'eq', args: [col2, val2] })
              return { maybeSingle: () => Promise.resolve({ data: row, error: null }) }
            },
          }
        },
      }),
      upsert: (payload: Record<string, unknown>) => {
        calls.push({ method: 'upsert', args: [payload] })
        row = { ...lqRow(), ...row, ...payload }
        return {
          select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
        }
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, calls, get row() { return row } }
}

describe('lead-qualification.repo', () => {
  it('getLeadQualification scopes by accountId AND contactId', async () => {
    const { db, calls } = makeDb(lqRow())
    const lq = await getLeadQualification(db, 'acct-1', 'contact-1')
    expect(lq?.score).toBe(40)
    expect(calls).toContainEqual({ method: 'eq', args: ['account_id', 'acct-1'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['contact_id', 'contact-1'] })
  })

  it('getLeadQualification returns null when there is no row', async () => {
    const { db } = makeDb(null)
    expect(await getLeadQualification(db, 'acct-1', 'contact-1')).toBeNull()
  })

  it('upsertLeadQualification merges answers instead of replacing them', async () => {
    const { db } = makeDb(lqRow({ answers: { budget: 'yes' } }))
    const updated = await upsertLeadQualification(db, 'acct-1', 'contact-1', {
      answers: { timeline: '3 months' },
    })
    expect(updated.answers).toEqual({ budget: 'yes', timeline: '3 months' })
  })

  it('upsertLeadQualification sets qualified_at only when qualified: true', async () => {
    const { db } = makeDb(lqRow({ qualified_at: null }))
    const notQualified = await upsertLeadQualification(db, 'acct-1', 'contact-1', {
      score: 90,
    })
    expect(notQualified.qualifiedAt).toBeNull()

    const qualified = await upsertLeadQualification(db, 'acct-1', 'contact-1', {
      qualified: true,
    })
    expect(qualified.qualifiedAt).toBeInstanceOf(Date)
  })

  it('upsertLeadQualification writes account_id and contact_id on every call', async () => {
    const { db, calls } = makeDb(lqRow())
    await upsertLeadQualification(db, 'acct-1', 'contact-1', { score: 10 })
    const upsertCall = calls.find((c) => c.method === 'upsert')!
    const payload = upsertCall.args[0] as Record<string, unknown>
    expect(payload.account_id).toBe('acct-1')
    expect(payload.contact_id).toBe('contact-1')
  })
})
