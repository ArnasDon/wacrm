// ============================================================
// RLS real end-to-end — Catalog (ai_data_sources / ai_catalog_products
// / search_ai_catalog_products).
//
// Every assertion below runs through `signInAsFixtureUser()` — a real
// `anon`-key client that has completed `signInWithPassword`, exactly
// like the application itself. `serviceRoleClient()` is used ONLY in
// `beforeAll`/`afterAll` to seed/tear down, never inside an `it()`.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import './env-guard'
import { signInAsFixtureUser } from './clients'
import { seedRlsFixtures, cleanupRlsFixtures, type RlsFixtures } from './fixtures'

describe('RLS — catalog (ai_data_sources / ai_catalog_products / search_ai_catalog_products)', () => {
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

  it('A. account A can read its own ai_data_sources and ai_catalog_products rows', async () => {
    const ds = await asA.from('ai_data_sources').select('id').eq('id', fixtures.a.dataSourceId).maybeSingle()
    expect(ds.error).toBeNull()
    expect(ds.data?.id).toBe(fixtures.a.dataSourceId)

    const product = await asA.from('ai_catalog_products').select('name, price').eq('id', fixtures.a.productId).maybeSingle()
    expect(product.error).toBeNull()
    expect(product.data?.name).toContain('RLS-FIXTURE-A')
  })

  it('B. account A cannot read account B\'s ai_data_sources or ai_catalog_products rows', async () => {
    const ds = await asA.from('ai_data_sources').select('id').eq('id', fixtures.b.dataSourceId).maybeSingle()
    expect(ds.error).toBeNull()
    expect(ds.data).toBeNull() // RLS filters it out silently — not an error, an empty result

    const product = await asA.from('ai_catalog_products').select('id, name').eq('id', fixtures.b.productId).maybeSingle()
    expect(product.error).toBeNull()
    expect(product.data).toBeNull()
  })

  it('C. account A cannot UPDATE account B\'s product', async () => {
    const before = await asA.from('ai_catalog_products').select('price').eq('id', fixtures.b.productId)
    const update = await asA.from('ai_catalog_products').update({ price: 1 }).eq('id', fixtures.b.productId).select('id')
    expect(update.error).toBeNull() // RLS makes this affect 0 rows, not a hard error
    expect(update.data).toEqual([])

    // Re-read with service_role-independent proof: B's own session still
    // sees the original, untouched price.
    const stillOriginal = await asB.from('ai_catalog_products').select('price').eq('id', fixtures.b.productId).single()
    expect(stillOriginal.data?.price).toBe(22222)
    void before
  })

  it('D. account A cannot DELETE account B\'s product', async () => {
    const del = await asA.from('ai_catalog_products').delete().eq('id', fixtures.b.productId).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toEqual([]) // 0 rows deleted

    const stillThere = await asB.from('ai_catalog_products').select('id').eq('id', fixtures.b.productId).maybeSingle()
    expect(stillThere.data?.id).toBe(fixtures.b.productId)
  })

  it('E/F/G. search_ai_catalog_products: a smuggled p_account_id belonging to B never surfaces B\'s product to A\'s session, even though the RPC is SECURITY INVOKER and the argument is honored literally', async () => {
    // Positive control first: A's OWN account_id genuinely returns her product.
    const ownResult = await asA.rpc('search_ai_catalog_products', {
      p_account_id: fixtures.a.accountId,
      p_data_source_ids: null,
      p_query: 'RLS-FIXTURE-A',
      p_color: null,
      p_match_count: 10,
    })
    expect(ownResult.error).toBeNull()
    expect((ownResult.data ?? []).some((r: { id: string }) => r.id === fixtures.a.productId)).toBe(true)

    // The actual test: A calls the RPC with B's account_id explicitly.
    // The function itself does `WHERE p.account_id = p_account_id` with
    // no membership check of its own — the ONLY thing that can stop
    // this from returning B's row is the underlying ai_catalog_products
    // RLS policy, because the function is SECURITY INVOKER (confirmed
    // in migration 047).
    const smuggled = await asA.rpc('search_ai_catalog_products', {
      p_account_id: fixtures.b.accountId,
      p_data_source_ids: null,
      p_query: 'RLS-FIXTURE-B',
      p_color: null,
      p_match_count: 10,
    })
    expect(smuggled.error).toBeNull()
    expect(smuggled.data ?? []).toEqual([])
  })
})
