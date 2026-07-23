import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

import { loadAiConfig, saveAiConfig } from './config'

function fakeSupabase(row: Record<string, unknown> | null) {
  const upserted: Record<string, unknown>[] = []
  return {
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
        upsert: (payload: Record<string, unknown>) => {
          upserted.push(payload)
          return Promise.resolve({ error: null })
        },
      }),
    } as unknown as SupabaseClient,
    upserted,
  }
}

describe('loadAiConfig', () => {
  it('returns null when no row exists', async () => {
    const { client } = fakeSupabase(null)
    expect(await loadAiConfig(client, 'acct-1')).toBeNull()
  })

  it('decrypts the stored key', async () => {
    const { client } = fakeSupabase({
      account_id: 'acct-1',
      provider: 'openai',
      model: 'gpt-test',
      api_key_encrypted: 'enc:sk-real',
      agent_enabled: true,
      pipeline_move_enabled: false,
      knowledge_enabled: true,
      embeddings_model: 'text-embedding-test',
      embeddings_api_key_encrypted: 'enc:sk-embeddings',
      auto_reply_max_per_conversation: 3,
      handoff_agent_id: null,
    })
    const config = await loadAiConfig(client, 'acct-1')
    expect(config?.apiKey).toBe('sk-real')
    expect(config?.agentEnabled).toBe(true)
    expect(config?.knowledgeEnabled).toBe(true)
    expect(config?.embeddingsModel).toBe('text-embedding-test')
    expect(config?.embeddingsApiKey).toBe('sk-embeddings')
  })
})

describe('saveAiConfig', () => {
  it('encrypts the key before upserting', async () => {
    const { client, upserted } = fakeSupabase(null)
    await saveAiConfig(client, 'acct-1', {
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'sk-real',
      agentEnabled: true,
      pipelineMoveEnabled: false,
      knowledgeEnabled: true,
      embeddingsModel: 'text-embedding-test',
      embeddingsApiKey: 'sk-embeddings',
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
    })
    expect(upserted[0].api_key_encrypted).toBe('enc:sk-real')
    expect(upserted[0].knowledge_enabled).toBe(true)
    expect(upserted[0].embeddings_model).toBe('text-embedding-test')
    expect(upserted[0].embeddings_api_key_encrypted).toBe('enc:sk-embeddings')
    expect(upserted[0].account_id).toBe('acct-1')
  })
})
