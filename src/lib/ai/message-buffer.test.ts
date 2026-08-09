import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import type { AiConfig } from './types'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}))

import {
  dispatchBufferedInboundToAiReply,
  registerInboundForAiBuffer,
} from './message-buffer'

const DISPATCH_ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  inboundMessageId: 'wamid.inbound-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    agentId: 'agent-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    bufferWindowSeconds: 12,
    maxReplyChunks: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.rpc.mockImplementation((name: string) => {
    if (name === 'schedule_ai_dispatch') {
      return Promise.resolve({ data: 1, error: null })
    }
    return Promise.resolve({ data: true, error: null })
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AI message buffer', () => {
  it('registers each inbound with the atomic generation RPC', async () => {
    await expect(
      registerInboundForAiBuffer({
        accountId: 'acct-1',
        conversationId: 'conv-1',
      })
    ).resolves.toBe(1)

    expect(h.rpc).toHaveBeenCalledWith('schedule_ai_dispatch', {
      p_account_id: 'acct-1',
      p_conversation_id: 'conv-1',
    })
  })

  it('preserves the single-message behaviour after the configured quiet window', async () => {
    const pending = dispatchBufferedInboundToAiReply({
      ...DISPATCH_ARGS,
      generation: 1,
    })

    await vi.advanceTimersByTimeAsync(11_999)
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await pending

    expect(h.rpc).toHaveBeenCalledWith('claim_ai_dispatch', {
      p_account_id: 'acct-1',
      p_conversation_id: 'conv-1',
      p_generation: 1,
    })
    expect(h.dispatchInboundToAiReply).toHaveBeenCalledOnce()
    expect(h.dispatchInboundToAiReply).toHaveBeenCalledWith(DISPATCH_ARGS)
  })

  it('lets only the newest rapid fragment dispatch after rebuilding context', async () => {
    const fragments = ['Quero umas sapatilhas']
    let fragmentsSeenAtDispatch: string[] = []
    h.dispatchInboundToAiReply.mockImplementation(async () => {
      fragmentsSeenAtDispatch = [...fragments]
    })
    h.rpc.mockImplementation(
      (name: string, args: { p_generation?: number }) => {
        if (name === 'claim_ai_dispatch') {
          return Promise.resolve({
            data: args.p_generation === 2,
            error: null,
          })
        }
        return Promise.resolve({ data: 1, error: null })
      }
    )

    const first = dispatchBufferedInboundToAiReply({
      ...DISPATCH_ARGS,
      generation: 1,
    })
    fragments.push('pretas', 'tamanho 42')
    const latest = dispatchBufferedInboundToAiReply({
      ...DISPATCH_ARGS,
      generation: 2,
    })

    await vi.runAllTimersAsync()
    await Promise.all([first, latest])

    expect(h.dispatchInboundToAiReply).toHaveBeenCalledOnce()
    expect(fragmentsSeenAtDispatch).toEqual([
      'Quero umas sapatilhas',
      'pretas',
      'tamanho 42',
    ])
  })

  it('allows exactly one winner when two invocations race for one generation', async () => {
    let claimed = false
    h.rpc.mockImplementation((name: string) => {
      if (name !== 'claim_ai_dispatch') {
        return Promise.resolve({ data: 1, error: null })
      }
      if (claimed) return Promise.resolve({ data: false, error: null })
      claimed = true
      return Promise.resolve({ data: true, error: null })
    })

    const attempts = [
      dispatchBufferedInboundToAiReply({ ...DISPATCH_ARGS, generation: 3 }),
      dispatchBufferedInboundToAiReply({ ...DISPATCH_ARGS, generation: 3 }),
    ]
    await vi.runAllTimersAsync()
    await Promise.all(attempts)

    expect(h.dispatchInboundToAiReply).toHaveBeenCalledOnce()
  })
})
