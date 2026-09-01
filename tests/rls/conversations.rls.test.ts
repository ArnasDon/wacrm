// ============================================================
// RLS real end-to-end — conversations, especially ai_catalog_context.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import './env-guard'
import { signInAsFixtureUser } from './clients'
import { seedRlsFixtures, cleanupRlsFixtures, type RlsFixtures } from './fixtures'

describe('RLS — conversations / ai_catalog_context', () => {
  let fixtures: RlsFixtures
  let asA: SupabaseClient
  let asB: SupabaseClient

  beforeAll(async () => {
    fixtures = await seedRlsFixtures()
    asA = await signInAsFixtureUser(fixtures.a.email, fixtures.a.password)
    asB = await signInAsFixtureUser(fixtures.b.email, fixtures.b.password)
  }, 60_000)

  afterAll(async () => {
    await cleanupRlsFixtures()
  }, 60_000)

  it('A can read its own conversation (incl. ai_catalog_context); A cannot read B\'s', async () => {
    const own = await asA
      .from('conversations')
      .select('id, ai_catalog_context')
      .eq('id', fixtures.a.conversationId)
      .maybeSingle()
    expect(own.error).toBeNull()
    expect(own.data?.ai_catalog_context?.lastQuery).toContain('RLS-FIXTURE-A')

    const other = await asA
      .from('conversations')
      .select('id, ai_catalog_context')
      .eq('id', fixtures.b.conversationId)
      .maybeSingle()
    expect(other.error).toBeNull()
    expect(other.data).toBeNull()
  })

  it('A cannot UPDATE B\'s conversation or its ai_catalog_context', async () => {
    const update = await asA
      .from('conversations')
      .update({
        status: 'closed',
        ai_catalog_context: { lastQuery: 'tampered', products: [], updatedAt: new Date().toISOString() },
      })
      .eq('id', fixtures.b.conversationId)
      .select('id')
    expect(update.error).toBeNull()
    expect(update.data).toEqual([])

    const stillOriginal = await asB
      .from('conversations')
      .select('status, ai_catalog_context')
      .eq('id', fixtures.b.conversationId)
      .single()
    expect(stillOriginal.data?.status).toBe('open')
    expect(stillOriginal.data?.ai_catalog_context?.lastQuery).toContain('RLS-FIXTURE-B')
  })

  it('A cannot DELETE B\'s conversation', async () => {
    const del = await asA.from('conversations').delete().eq('id', fixtures.b.conversationId).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toEqual([])

    const stillThere = await asB.from('conversations').select('id').eq('id', fixtures.b.conversationId).maybeSingle()
    expect(stillThere.data?.id).toBe(fixtures.b.conversationId)
  })

  it('a body-supplied/smuggled account_id in a direct filter cannot widen what A sees — filtering by B\'s account_id from A\'s session still returns nothing', async () => {
    const smuggled = await asA.from('conversations').select('id').eq('account_id', fixtures.b.accountId)
    expect(smuggled.error).toBeNull()
    expect(smuggled.data).toEqual([])
  })
})
