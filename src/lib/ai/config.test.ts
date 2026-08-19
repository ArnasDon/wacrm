import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
  handoff_sensitivity: 'balanced',
  temperature: null,
  knowledge_top_k: 5,
  knowledge_min_relevance: null,
  context_message_limit: 20,
  summarize_history: false,
  dormancy_reset_hours: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

describe('loadAiConfig — tuning fields (migration 041)', () => {
  it('maps handoff_sensitivity, temperature, and knowledge fields through', async () => {
    const row = {
      ...ROW,
      handoff_sensitivity: 'assertive',
      temperature: 0.4,
      knowledge_top_k: 8,
      knowledge_min_relevance: 0.6,
    }
    const config = await loadAiConfig(dbReturning(row), 'acct', { requireActive: false })
    expect(config).toMatchObject({
      handoffSensitivity: 'assertive',
      temperature: 0.4,
      knowledgeTopK: 8,
      knowledgeMinRelevance: 0.6,
    })
  })

  it('falls back to today\'s defaults when a row predates migration 041', async () => {
    // Simulates a pre-041 row (columns not yet backfilled) rather than
    // relying on the DB's NOT NULL DEFAULT actually having run.
    const { handoff_sensitivity, temperature, knowledge_top_k, knowledge_min_relevance, ...legacyRow } = ROW
    void handoff_sensitivity
    void temperature
    void knowledge_top_k
    void knowledge_min_relevance
    const config = await loadAiConfig(dbReturning(legacyRow), 'acct', {
      requireActive: false,
    })
    expect(config).toMatchObject({
      handoffSensitivity: 'balanced',
      temperature: null,
      knowledgeTopK: 5,
      knowledgeMinRelevance: null,
    })
  })
})

describe('loadAiConfig — history summary fields (migration 042)', () => {
  it('maps context_message_limit and summarize_history through', async () => {
    const row = { ...ROW, context_message_limit: 40, summarize_history: true }
    const config = await loadAiConfig(dbReturning(row), 'acct', { requireActive: false })
    expect(config).toMatchObject({ contextMessageLimit: 40, summarizeHistory: true })
  })

  it('falls back to today\'s defaults when a row predates migration 042', async () => {
    const { context_message_limit, summarize_history, ...legacyRow } = ROW
    void context_message_limit
    void summarize_history
    const config = await loadAiConfig(dbReturning(legacyRow), 'acct', {
      requireActive: false,
    })
    expect(config).toMatchObject({ contextMessageLimit: 20, summarizeHistory: false })
  })
})

describe('loadAiConfig — dormancy reset (migration 044)', () => {
  it('maps dormancy_reset_hours through', async () => {
    const row = { ...ROW, dormancy_reset_hours: 72 }
    const config = await loadAiConfig(dbReturning(row), 'acct', { requireActive: false })
    expect(config).toMatchObject({ dormancyResetHours: 72 })
  })

  it('falls back to disabled (null) when a row predates migration 044', async () => {
    const { dormancy_reset_hours, ...legacyRow } = ROW
    void dormancy_reset_hours
    const config = await loadAiConfig(dbReturning(legacyRow), 'acct', {
      requireActive: false,
    })
    expect(config).toMatchObject({ dormancyResetHours: null })
  })
})
