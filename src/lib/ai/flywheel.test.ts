import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import type { AiConfig } from './types'

const mocks = vi.hoisted(() => ({
  generateReply: vi.fn(),
  loadAiConfig: vi.fn(),
}))

vi.mock('./generate', () => ({ generateReply: mocks.generateReply }))
vi.mock('./config', () => ({ loadAiConfig: mocks.loadAiConfig }))

import { lessonsPrompt, retrieveAppliedLessons, runHandoffLessonDetector } from './flywheel'

const config: AiConfig = {
  provider: 'openai',
  model: 'test-model',
  apiKey: 'test-key',
  systemPrompt: 'Vendemos roupa desportiva.',
  commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 3,
  bufferWindowSeconds: 12,
  maxReplyChunks: 3,
  handoffAgentId: null,
  embeddingsApiKey: null,
}

/** Chainable query-builder stub: every filter method returns itself, and the
 *  object is thenable so `await` resolves to the given result — same shape
 *  as the real Supabase builder. */
function chainable(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {
    select: vi.fn(() => obj),
    not: vi.fn(() => obj),
    gte: vi.fn(() => obj),
    order: vi.fn(() => obj),
    limit: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  }
  return obj
}

beforeEach(() => vi.clearAllMocks())

describe('lessonsPrompt', () => {
  it('returns null with no lessons', () => {
    expect(lessonsPrompt([])).toBeNull()
  })

  it('numbers each lesson and frames them as standing rules', () => {
    const prompt = lessonsPrompt(['Confirma sempre o tamanho antes de prometer entrega.'])
    expect(prompt).toContain('Lições aprendidas')
    expect(prompt).toContain('[L1] Confirma sempre o tamanho')
  })
})

describe('retrieveAppliedLessons', () => {
  it('returns applied lesson content, most recent first', async () => {
    const db = {
      from: vi.fn(() =>
        chainable({ data: [{ content: 'Regra A' }, { content: 'Regra B' }], error: null }),
      ),
    } as unknown as WacrmSupabaseClient
    const result = await retrieveAppliedLessons(db, 'acct-1')
    expect(result).toEqual(['Regra A', 'Regra B'])
  })

  it('degrades to an empty list on a query error', async () => {
    const db = {
      from: vi.fn(() => chainable({ data: null, error: new Error('boom') })),
    } as unknown as WacrmSupabaseClient
    const result = await retrieveAppliedLessons(db, 'acct-1')
    expect(result).toEqual([])
  })
})

describe('runHandoffLessonDetector', () => {
  it('drafts and stores a lesson from a fresh handoff', async () => {
    mocks.loadAiConfig.mockResolvedValue(config)
    mocks.generateReply.mockResolvedValue({
      text: 'Confirma sempre a cor disponível antes de aceitar o pedido.',
      handoff: false,
      usage: null,
    })
    const insert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn()
    from
      .mockReturnValueOnce(
        chainable({
          data: [
            {
              id: 'conv-1',
              account_id: 'acct-1',
              ai_handoff_summary: 'Cliente pediu uma cor que já não existe.',
              ai_handoff_at: '2026-08-01T10:00:00.000Z',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(chainable({ data: null, error: null })) // exists-check: none yet
      .mockReturnValueOnce({ insert })
    const db = { from } as unknown as WacrmSupabaseClient

    const result = await runHandoffLessonDetector(db, { limit: 5 })

    expect(result).toEqual({ created: 1, skipped: 0, failed: 0 })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acct-1',
        kind: 'lesson',
        status: 'pending',
        fingerprint: 'conv-1:2026-08-01T10:00:00.000Z',
        content: 'Confirma sempre a cor disponível antes de aceitar o pedido.',
      }),
    )
  })

  it('skips a handoff already mined, without calling the model', async () => {
    const from = vi.fn()
    from
      .mockReturnValueOnce(
        chainable({
          data: [
            {
              id: 'conv-1',
              account_id: 'acct-1',
              ai_handoff_summary: 'Cliente queria falar com humano.',
              ai_handoff_at: '2026-08-01T10:00:00.000Z',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(chainable({ data: { id: 'existing-suggestion' }, error: null }))
    const db = { from } as unknown as WacrmSupabaseClient

    const result = await runHandoffLessonDetector(db, { limit: 5 })

    expect(result).toEqual({ created: 0, skipped: 1, failed: 0 })
    expect(mocks.generateReply).not.toHaveBeenCalled()
  })

  it('skips without inserting when the model finds no reusable pattern', async () => {
    mocks.loadAiConfig.mockResolvedValue(config)
    mocks.generateReply.mockResolvedValue({ text: '[SEM_LICAO]', handoff: false, usage: null })
    const insert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn()
    from
      .mockReturnValueOnce(
        chainable({
          data: [
            {
              id: 'conv-1',
              account_id: 'acct-1',
              ai_handoff_summary: 'Caso muito específico sem padrão.',
              ai_handoff_at: '2026-08-01T10:00:00.000Z',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(chainable({ data: null, error: null }))
      .mockReturnValueOnce({ insert })
    const db = { from } as unknown as WacrmSupabaseClient

    const result = await runHandoffLessonDetector(db, { limit: 5 })

    expect(result).toEqual({ created: 0, skipped: 1, failed: 0 })
    expect(insert).not.toHaveBeenCalled()
  })

  it('reports a failure without throwing when the initial scan errors', async () => {
    const db = {
      from: vi.fn(() => chainable({ data: null, error: new Error('db down') })),
    } as unknown as WacrmSupabaseClient

    const result = await runHandoffLessonDetector(db, { limit: 5 })

    expect(result).toEqual({ created: 0, skipped: 0, failed: 1 })
  })
})
