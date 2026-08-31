import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveZernioConversationIdForContact } from './resolve-zernio-conversation'

/** Fake query builder that records the filter chain and resolves the
 *  final `.limit()` to `rows`. */
function fakeDb(rows: unknown[], error: unknown = null) {
  const calls: { method: string; args: unknown[] }[] = []
  const builder: Record<string, unknown> = {
    select: (...args: unknown[]) => (calls.push({ method: 'select', args }), builder),
    eq: (...args: unknown[]) => (calls.push({ method: 'eq', args }), builder),
    not: (...args: unknown[]) => (calls.push({ method: 'not', args }), builder),
    order: (...args: unknown[]) => (calls.push({ method: 'order', args }), builder),
    limit: (...args: unknown[]) => {
      calls.push({ method: 'limit', args })
      return Promise.resolve({ data: rows, error })
    },
  }
  const db = { from: (t: string) => (calls.push({ method: 'from', args: [t] }), builder) }
  return { db: db as unknown as SupabaseClient, calls }
}

describe('resolveZernioConversationIdForContact', () => {
  it('returns the most-recent sibling conversation id for the contact + channel', async () => {
    const { db, calls } = fakeDb([{ zernio_conversation_id: 'zc-9', last_message_at: '2026-01-02' }])
    const id = await resolveZernioConversationIdForContact(db, 'acct-1', 'ct-1', 'instagram')
    expect(id).toBe('zc-9')
    // scoped to the account, the contact, the channel, and non-null ids only
    expect(calls).toContainEqual({ method: 'from', args: ['conversations'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['account_id', 'acct-1'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['contact_id', 'ct-1'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['channel', 'instagram'] })
    expect(calls).toContainEqual({ method: 'not', args: ['zernio_conversation_id', 'is', null] })
  })

  it('returns null when the contact has no Zernio-linked conversation', async () => {
    const { db } = fakeDb([])
    expect(await resolveZernioConversationIdForContact(db, 'acct-1', 'ct-1', 'facebook')).toBeNull()
  })

  it('returns null (not throw) on a query error', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb([], { message: 'boom' })
    expect(await resolveZernioConversationIdForContact(db, 'acct-1', 'ct-1', 'instagram')).toBeNull()
    warn.mockRestore()
  })
})
