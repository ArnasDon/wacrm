// ============================================================
// RLS real end-to-end — API v1 idempotency concurrency (Punto 11, G2).
//
// begin_idempotent_request / complete_idempotent_request /
// fail_idempotent_request (migration 056) are SECURITY DEFINER RPCs
// GRANTed to service_role ONLY (REVOKEd from PUBLIC/anon/authenticated
// — see the migration itself). `api_idempotency_keys` has RLS ENABLED
// but carries ZERO policies (confirmed by reading migration 056
// directly: no `CREATE POLICY` for this table exists anywhere in the
// schema) — meaning tenant isolation here is NOT an RLS-policy
// guarantee the way every other table in this suite is. It is enforced
// entirely by the function's own `WHERE account_id = p_account_id`
// scoping, combined with the fact that only the trusted, server-side
// `withApiKey()`/`requireApiKey()` wrapper (src/lib/auth/api-context.ts
// — never client input) ever supplies that account_id. Documented
// here explicitly rather than pretending a policy is doing work it
// isn't (per this phase's own G2.6 instruction).
//
// Migration 056's own header comment states plainly: "no automated SQL
// test harness exists in this repo" for the concurrent case, and
// defers to manual two-psql-session validation. This file closes that
// gap for real: two genuinely concurrent Promise.all() calls against
// the REAL RPC (never mocked — the whole point of this file), so
// Postgres's own UNIQUE constraint + row lock decide the winner, not
// JS timing. No sleep/setTimeout/retry-loop anywhere in this file.
//
// Deliberately calls the three RPCs directly (never imports
// `withIdempotency()`/`SendMessageError` from `src/lib/api/v1/...`) —
// this suite's own established convention (see fixtures.ts's own
// comment re: reproducing `toVectorLiteral` locally) is zero import
// dependency on `src/`, so a `src/` refactor can never silently change
// what this suite proves about the database itself.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import './env-guard'
import { serviceRoleClient } from './clients'
import { seedRlsFixtures, cleanupRlsFixtures, type RlsFixtures } from './fixtures'

const ENDPOINT = 'messages:send'
const HASH_A = 'hash-a-fixed-payload'
const HASH_B = 'hash-b-different-payload'

interface BeginResult {
  outcome: 'proceed' | 'replay' | 'conflict' | 'in_progress'
  cached_status: number | null
  cached_body: unknown
}

function randomKey(label: string): string {
  return `p11-g2-${label}-${Math.random().toString(36).slice(2)}`
}

describe('RLS — API v1 idempotency real concurrency (Punto 11, G2)', () => {
  let fixtures: RlsFixtures
  const db = serviceRoleClient()

  beforeAll(async () => {
    fixtures = await seedRlsFixtures()
  }, 60_000)

  afterAll(async () => {
    // Cascades every api_idempotency_keys row this file created —
    // account_id REFERENCES accounts(id) ON DELETE CASCADE (056).
    await cleanupRlsFixtures()
  }, 60_000)

  async function begin(accountId: string, key: string, hash = HASH_A): Promise<BeginResult> {
    const { data, error } = await db
      .rpc('begin_idempotent_request', {
        p_account_id: accountId,
        p_idempotency_key: key,
        p_endpoint: ENDPOINT,
        p_request_hash: hash,
      })
      .single()
    if (error) throw new Error(`begin_idempotent_request failed: ${error.message}`)
    return data as BeginResult
  }

  async function complete(
    accountId: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    const { error } = await db.rpc('complete_idempotent_request', {
      p_account_id: accountId,
      p_idempotency_key: key,
      p_response_status: status,
      p_response_body: body,
    })
    if (error) throw new Error(`complete_idempotent_request failed: ${error.message}`)
  }

  it('TEST A — two genuinely concurrent calls, same account + same key: exactly one "proceed", the other "in_progress" — Postgres decides, never JS timing', async () => {
    const key = randomKey('A')
    let realEffectCount = 0

    // Both requests start executing before either awaits a network
    // response — Promise.all dispatches both RPC calls essentially at
    // once, exactly the "two sessions racing" scenario migration 056's
    // own header describes as needing manual psql verification.
    const attempt = async () => {
      const result = await begin(fixtures.a.accountId, key)
      if (result.outcome === 'proceed') realEffectCount++ // stands in for "the real Meta send"
      return result.outcome
    }

    const outcomes = (await Promise.all([attempt(), attempt()])).sort()
    expect(outcomes).toEqual(['in_progress', 'proceed'])
    expect(realEffectCount).toBe(1) // the actual duplicate-execution proof

    // No second, independent row exists for the same (account, key) —
    // the UNIQUE index (idx_api_idempotency_keys_account_key) did its job.
    const { data: rows, error } = await db
      .from('api_idempotency_keys')
      .select('id')
      .eq('account_id', fixtures.a.accountId)
      .eq('idempotency_key', key)
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
  })

  it('TEST B — the SAME literal key, on TWO DIFFERENT accounts, concurrently: both independently "proceed" — cross-tenant claims never collide', async () => {
    const key = randomKey('B')
    const [outcomeA, outcomeB] = await Promise.all([
      begin(fixtures.a.accountId, key).then((r) => r.outcome),
      begin(fixtures.b.accountId, key).then((r) => r.outcome),
    ])
    expect(outcomeA).toBe('proceed')
    expect(outcomeB).toBe('proceed')
  })

  it('TEST C — same account, two DIFFERENT keys, concurrently: both independently "proceed"', async () => {
    const keyX = randomKey('C-x')
    const keyY = randomKey('C-y')
    const [outcomeX, outcomeY] = await Promise.all([
      begin(fixtures.a.accountId, keyX).then((r) => r.outcome),
      begin(fixtures.a.accountId, keyY).then((r) => r.outcome),
    ])
    expect(outcomeX).toBe('proceed')
    expect(outcomeY).toBe('proceed')
  })

  it('TEST D — same account + same key + a DIFFERENT request hash: "conflict" — existing contract, not invented here', async () => {
    const key = randomKey('D')
    const first = await begin(fixtures.a.accountId, key, HASH_A)
    expect(first.outcome).toBe('proceed')
    const second = await begin(fixtures.a.accountId, key, HASH_B)
    expect(second.outcome).toBe('conflict')
  })

  it('TEST E — a completed request replays verbatim on a later call, and the real effect never runs a second time', async () => {
    const key = randomKey('E')
    let realEffectCount = 0

    const first = await begin(fixtures.a.accountId, key)
    expect(first.outcome).toBe('proceed')
    realEffectCount++
    await complete(fixtures.a.accountId, key, 201, { message_id: 'real-effect-ran-once' })

    // A third, independent call — real Postgres, nothing mocked — must
    // replay, never re-run the effect.
    const replay = await begin(fixtures.a.accountId, key)
    expect(replay.outcome).toBe('replay')
    expect(replay.cached_status).toBe(201)
    expect(replay.cached_body).toEqual({ message_id: 'real-effect-ran-once' })
    expect(realEffectCount).toBe(1)
  })

  it('TEST F — external effect occurred + local failure: completing (never failing) the claim stops a retry from re-running the effect — the F-P10-4 contract, proven against the real RPC', async () => {
    const key = randomKey('F')
    let realEffectCount = 0

    const first = await begin(fixtures.a.accountId, key)
    expect(first.outcome).toBe('proceed')
    realEffectCount++ // the real WhatsApp send that Meta already accepted

    // Mirrors withIdempotency()'s own catch-block behavior for an
    // externalEffectOccurred error EXACTLY (src/lib/api/v1/idempotency.ts):
    // complete_idempotent_request — never fail_idempotent_request — with
    // the failure's status/body.
    await complete(fixtures.a.accountId, key, 500, {
      error: { code: 'db_error', message: 'Message sent to Meta but failed to save to DB' },
    })

    const retryWithSameKey = await begin(fixtures.a.accountId, key)
    expect(retryWithSameKey.outcome).toBe('replay') // NOT 'proceed' — the claim was never released
    expect(retryWithSameKey.cached_status).toBe(500)
    expect(realEffectCount).toBe(1) // the real effect (the Meta send) never ran a second time
  })
})
