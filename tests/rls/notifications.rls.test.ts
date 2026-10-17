// ============================================================
// RLS real end-to-end — notifications (Punto 9, H9-1).
//
// notifications_select/notifications_update (migration 027, tightened
// by migration 062) require BOTH `auth.uid() = user_id` AND
// `is_account_member(account_id)`. Rows here are inserted directly via
// the service-role client (fixture-style, never asserted through) so
// this suite tests the POLICY itself in isolation from whatever wrote
// the row — the same discipline fixtures.ts documents for every other
// table in this suite. Cleanup is automatic: notifications.account_id
// is `REFERENCES accounts(id) ON DELETE CASCADE` (migration 027), so
// cleanupRlsFixtures()'s account deletion cascades these rows away too.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import './env-guard'
import { signInAsFixtureUser, serviceRoleClient } from './clients'
import { seedRlsFixtures, cleanupRlsFixtures, type RlsFixtures } from './fixtures'

describe('RLS — notifications (Punto 9, H9-1)', () => {
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

  it('a legitimate same-account notification is readable by its addressed recipient', async () => {
    const db = serviceRoleClient()
    const { data: notif, error: insErr } = await db
      .from('notifications')
      .insert({
        account_id: fixtures.a.accountId,
        user_id: fixtures.a.userId,
        type: 'conversation_assigned',
        conversation_id: fixtures.a.conversationId,
        contact_id: fixtures.a.crmContactId,
        title: 'RLS-FIXTURE-A notification',
        body: 'RLS-FIXTURE-A assigned you a conversation.',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()

    const ownRead = await asA.from('notifications').select('id, title').eq('id', notif!.id).maybeSingle()
    expect(ownRead.data?.title).toBe('RLS-FIXTURE-A notification')
  })

  it('H9-1: a notification whose user_id belongs to a DIFFERENT account than its own account_id is readable by NEITHER the addressed user nor a real member of that account', async () => {
    const db = serviceRoleClient()
    // The exact H9-1 shape: account_id = A, but user_id = B — the state
    // a mis-linked contact/handoff_agent_id used to be able to produce
    // before this fix (now additionally blocked upstream by the
    // assigned_agent_id/linked_user_id FKs — this test targets the RLS
    // layer directly, in case any other path ever inserts into
    // notifications this way).
    const { data: notif, error: insErr } = await db
      .from('notifications')
      .insert({
        account_id: fixtures.a.accountId,
        user_id: fixtures.b.userId,
        type: 'conversation_assigned',
        conversation_id: fixtures.a.conversationId,
        contact_id: fixtures.a.crmContactId,
        title: 'RLS-FIXTURE-A cross-tenant leak probe',
        body: 'Should never be readable by anyone in this test.',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()

    // B is the addressed recipient (user_id matches) but not a member
    // of account A — must NOT see it (this is the actual leak H9-1
    // described: before migration 062, this read would have succeeded).
    const asRecipient = await asB.from('notifications').select('id').eq('id', notif!.id).maybeSingle()
    expect(asRecipient.error).toBeNull()
    expect(asRecipient.data).toBeNull()

    // A is a real member of the account but not the addressed recipient
    // (user_id doesn't match A either) — must also not see it.
    const asAccountMember = await asA.from('notifications').select('id').eq('id', notif!.id).maybeSingle()
    expect(asAccountMember.error).toBeNull()
    expect(asAccountMember.data).toBeNull()
  })
})
