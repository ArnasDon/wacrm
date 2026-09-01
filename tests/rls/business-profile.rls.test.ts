// ============================================================
// RLS real end-to-end — Business Profile (account_business_profiles /
// account_business_departments / account_business_contacts).
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import './env-guard'
import { signInAsFixtureUser } from './clients'
import { seedRlsFixtures, cleanupRlsFixtures, type RlsFixtures } from './fixtures'

describe('RLS — Business Profile (profiles / departments / contacts)', () => {
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

  it('A can read its own business profile/department/contact; A cannot read B\'s', async () => {
    const ownProfile = await asA
      .from('account_business_profiles')
      .select('description')
      .eq('id', fixtures.a.businessProfileId)
      .maybeSingle()
    expect(ownProfile.data?.description).toContain('RLS-FIXTURE-A')

    const otherProfile = await asA
      .from('account_business_profiles')
      .select('id')
      .eq('id', fixtures.b.businessProfileId)
      .maybeSingle()
    expect(otherProfile.error).toBeNull()
    expect(otherProfile.data).toBeNull()

    const otherDept = await asA
      .from('account_business_departments')
      .select('id')
      .eq('id', fixtures.b.departmentId)
      .maybeSingle()
    expect(otherDept.data).toBeNull()

    const otherContact = await asA
      .from('account_business_contacts')
      .select('id')
      .eq('id', fixtures.b.contactId)
      .maybeSingle()
    expect(otherContact.data).toBeNull()
  })

  it('A cannot UPDATE or DELETE B\'s business profile/department/contact', async () => {
    const updateProfile = await asA
      .from('account_business_profiles')
      .update({ description: 'tampered' })
      .eq('id', fixtures.b.businessProfileId)
      .select('id')
    expect(updateProfile.error).toBeNull()
    expect(updateProfile.data).toEqual([])

    const deleteContact = await asA
      .from('account_business_contacts')
      .delete()
      .eq('id', fixtures.b.contactId)
      .select('id')
    expect(deleteContact.error).toBeNull()
    expect(deleteContact.data).toEqual([])

    const stillIntact = await asB
      .from('account_business_profiles')
      .select('description')
      .eq('id', fixtures.b.businessProfileId)
      .single()
    expect(stillIntact.data?.description).toContain('RLS-FIXTURE-B')

    const contactStillThere = await asB
      .from('account_business_contacts')
      .select('id')
      .eq('id', fixtures.b.contactId)
      .maybeSingle()
    expect(contactStillThere.data?.id).toBe(fixtures.b.contactId)
  })
})
