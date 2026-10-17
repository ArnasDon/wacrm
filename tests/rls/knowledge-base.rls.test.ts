// ============================================================
// RLS real end-to-end — Knowledge Base (ai_knowledge_chunks,
// match_ai_knowledge_fts, match_ai_knowledge_semantic).
//
// Both RPCs are SECURITY INVOKER (migration 032 — the exact fix for
// GHSA-fg5p-2qc3-jmxr) and filter `WHERE c.account_id = p_account_id`
// with no membership check of their own; the only thing standing
// between account A and account B's chunks is the `ai_knowledge_chunks`
// row-level security policy. This suite is the first thing in this
// repository that actually exercises that fact against real Postgres.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import './env-guard'
import { signInAsFixtureUser } from './clients'
import { seedRlsFixtures, cleanupRlsFixtures, type RlsFixtures } from './fixtures'

function vectorLiteral(fill: number, dims = 1536): string {
  return `[${Array(dims).fill(fill).join(',')}]`
}

describe('RLS — Knowledge Base (ai_knowledge_chunks / match_ai_knowledge_fts / match_ai_knowledge_semantic)', () => {
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

  it('A can read its own chunk directly; A cannot read B\'s chunk directly', async () => {
    const own = await asA.from('ai_knowledge_chunks').select('id, content').eq('id', fixtures.a.knowledgeChunkId).maybeSingle()
    expect(own.error).toBeNull()
    expect(own.data?.content).toContain('RLS-FIXTURE-A')

    const other = await asA.from('ai_knowledge_chunks').select('id').eq('id', fixtures.b.knowledgeChunkId).maybeSingle()
    expect(other.error).toBeNull()
    expect(other.data).toBeNull()
  })

  it('A cannot UPDATE or DELETE B\'s chunk', async () => {
    const update = await asA
      .from('ai_knowledge_chunks')
      .update({ content: 'tampered' })
      .eq('id', fixtures.b.knowledgeChunkId)
      .select('id')
    expect(update.error).toBeNull()
    expect(update.data).toEqual([])

    const del = await asA.from('ai_knowledge_chunks').delete().eq('id', fixtures.b.knowledgeChunkId).select('id')
    expect(del.error).toBeNull()
    expect(del.data).toEqual([])

    const stillIntact = await asB
      .from('ai_knowledge_chunks')
      .select('content')
      .eq('id', fixtures.b.knowledgeChunkId)
      .single()
    expect(stillIntact.data?.content).toContain('RLS-FIXTURE-B')
  })

  it('match_ai_knowledge_fts: A calling it with B\'s account_id (and a query matching B\'s real content) returns nothing', async () => {
    const ownFts = await asA.rpc('match_ai_knowledge_fts', {
      p_account_id: fixtures.a.accountId,
      p_query: 'warranty',
      p_match_count: 5,
    })
    expect(ownFts.error).toBeNull()
    expect((ownFts.data ?? []).some((r: { id: string }) => r.id === fixtures.a.knowledgeChunkId)).toBe(true)

    const smuggledFts = await asA.rpc('match_ai_knowledge_fts', {
      p_account_id: fixtures.b.accountId,
      p_query: 'warranty',
      p_match_count: 5,
    })
    expect(smuggledFts.error).toBeNull()
    expect(smuggledFts.data ?? []).toEqual([])
  })

  it('match_ai_knowledge_semantic: A calling it with B\'s account_id returns nothing, even with a real embedding present on B\'s row', async () => {
    const ownSemantic = await asA.rpc('match_ai_knowledge_semantic', {
      p_account_id: fixtures.a.accountId,
      p_query_embedding: vectorLiteral(0.001),
      p_match_count: 5,
    })
    expect(ownSemantic.error).toBeNull()
    expect((ownSemantic.data ?? []).some((r: { id: string }) => r.id === fixtures.a.knowledgeChunkId)).toBe(true)

    const smuggledSemantic = await asA.rpc('match_ai_knowledge_semantic', {
      p_account_id: fixtures.b.accountId,
      p_query_embedding: vectorLiteral(0.002), // B's own fixture embedding value
      p_match_count: 5,
    })
    expect(smuggledSemantic.error).toBeNull()
    expect(smuggledSemantic.data ?? []).toEqual([])
  })
})
