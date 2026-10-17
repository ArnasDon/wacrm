// ============================================================
// RLS real end-to-end — ai_configs.
//
// Special attention (per the authorization) to `system_prompt` and
// `api_key`: this test asserts not just that the ROW is invisible, but
// that a targeted `.select('system_prompt, api_key')` on B's id
// returns no row at all through A's authenticated session — the
// sensitive columns are never even reachable to select from.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import './env-guard'
import { signInAsFixtureUser } from './clients'
import { seedRlsFixtures, cleanupRlsFixtures, type RlsFixtures } from './fixtures'

describe('RLS — ai_configs', () => {
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

  it('A can read its own system_prompt/api_key; A cannot read B\'s, even targeting the exact row by id', async () => {
    const own = await asA
      .from('ai_configs')
      .select('system_prompt, api_key')
      .eq('id', fixtures.a.aiConfigId)
      .maybeSingle()
    expect(own.error).toBeNull()
    expect(own.data?.system_prompt).toContain('RLS-FIXTURE-A')

    const other = await asA
      .from('ai_configs')
      .select('system_prompt, api_key')
      .eq('id', fixtures.b.aiConfigId)
      .maybeSingle()
    expect(other.error).toBeNull()
    expect(other.data).toBeNull() // not redacted fields — no row at all
  })

  it('A cannot UPDATE B\'s ai_configs (system_prompt, api_key, or any field)', async () => {
    const update = await asA
      .from('ai_configs')
      .update({ system_prompt: 'tampered', api_key: 'stolen-key' })
      .eq('id', fixtures.b.aiConfigId)
      .select('id')
    expect(update.error).toBeNull()
    expect(update.data).toEqual([])

    const stillOriginal = await asB
      .from('ai_configs')
      .select('system_prompt, api_key')
      .eq('id', fixtures.b.aiConfigId)
      .single()
    expect(stillOriginal.data?.system_prompt).toContain('RLS-FIXTURE-B')
    expect(stillOriginal.data?.api_key).toContain('RLS-FIXTURE-B')
  })

  it('A cannot DELETE B\'s ai_configs row', async () => {
    const del = await asA.from('ai_configs').delete().eq('id', fixtures.b.aiConfigId).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toEqual([])

    const stillThere = await asB.from('ai_configs').select('id').eq('id', fixtures.b.aiConfigId).maybeSingle()
    expect(stillThere.data?.id).toBe(fixtures.b.aiConfigId)
  })
})
