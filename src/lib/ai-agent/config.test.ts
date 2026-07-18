import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiAgent, AiAgentRun, AiConversationState } from '@/types'

type QueryFilter = [column: string, value: unknown]

const h = vi.hoisted(() => ({
  state: {
    agent: null as AiAgent | null,
    state: null as AiConversationState | null,
    run: null as AiAgentRun | null,
    errors: {} as Record<string, string | undefined>,
    queries: [] as Array<{ table: string; filters: QueryFilter[]; limit?: number }>,
  },
}))

vi.mock('../flows/admin-client', () => {
  function builder(table: string) {
    const query = {
      filters: [] as QueryFilter[],
      limit: undefined as number | undefined,
    }

    const result = () => {
      const errorMessage = h.state.errors[table]
      const data = table === 'ai_agents'
        ? h.state.agent
        : table === 'ai_conversation_states'
          ? h.state.state
          : h.state.run

      h.state.queries.push({ table, filters: [...query.filters], limit: query.limit })
      return {
        data,
        error: errorMessage ? { message: errorMessage } : null,
      }
    }

    const client = {
      select: () => client,
      eq: (column: string, value: unknown) => {
        query.filters.push([column, value])
        return client
      },
      limit: (value: number) => {
        query.limit = value
        return client
      },
      maybeSingle: () => Promise.resolve(result()),
    }

    return client
  }

  return {
    supabaseAdmin: () => ({ from: builder }),
  }
})

import { loadAiAgentConfig, shouldRunAiAgent } from './config'

const accountId = 'account-1'
const conversationId = 'conversation-1'
const inboundMessageId = 'inbound-1'

beforeEach(() => {
  h.state.agent = null
  h.state.state = null
  h.state.run = null
  h.state.errors = {}
  h.state.queries = []
})

describe('loadAiAgentConfig', () => {
  it('returns the config for the matching account', async () => {
    h.state.agent = agent()

    await expect(loadAiAgentConfig(accountId)).resolves.toEqual(h.state.agent)

    expect(queryFor('ai_agents').filters).toContainEqual(['account_id', accountId])
  })

  it('surfaces a config lookup failure', async () => {
    h.state.errors.ai_agents = 'database unavailable'

    await expect(loadAiAgentConfig(accountId)).rejects.toThrow(
      'AI agent config lookup failed: database unavailable',
    )
  })
})

describe('shouldRunAiAgent', () => {
  it('skips when the account has no agent config', async () => {
    await expect(shouldRunAiAgent(input())).resolves.toEqual({
      shouldRun: false,
      reason: 'missing_config',
      agent: null,
      state: null,
    })
  })

  it('skips when the agent is disabled', async () => {
    h.state.agent = agent({ enabled: false })

    await expect(shouldRunAiAgent(input())).resolves.toMatchObject({
      shouldRun: false,
      reason: 'agent_disabled',
      agent: h.state.agent,
      state: null,
    })
  })

  it('surfaces a conversation state lookup failure', async () => {
    h.state.agent = agent()
    h.state.errors.ai_conversation_states = 'database unavailable'

    await expect(shouldRunAiAgent(input())).rejects.toThrow(
      'AI conversation state lookup failed: database unavailable',
    )
  })

  it.each([
    ['paused', 'conversation_paused'],
    ['handoff', 'conversation_handoff'],
    ['disabled', 'conversation_disabled'],
  ] as const)('skips a %s conversation', async (status, reason) => {
    h.state.agent = agent()
    h.state.state = conversationState({ status })

    await expect(shouldRunAiAgent(input())).resolves.toMatchObject({
      shouldRun: false,
      reason,
      agent: h.state.agent,
      state: h.state.state,
    })
  })

  it('skips an inbound message with an existing run', async () => {
    h.state.agent = agent()
    h.state.state = conversationState()
    h.state.run = agentRun()

    await expect(shouldRunAiAgent(input())).resolves.toMatchObject({
      shouldRun: false,
      reason: 'duplicate_inbound',
      agent: h.state.agent,
      state: h.state.state,
    })
  })

  it('surfaces an AI run lookup failure', async () => {
    h.state.agent = agent()
    h.state.errors.ai_agent_runs = 'database unavailable'

    await expect(shouldRunAiAgent(input())).rejects.toThrow(
      'AI run lookup failed: database unavailable',
    )
  })

  it('skips while the conversation is inside the configured cooldown', async () => {
    h.state.agent = agent({ cooldown_seconds: 60 })
    h.state.state = conversationState({ last_run_at: '2026-07-17T12:00:30.000Z' })

    await expect(shouldRunAiAgent(input({ now: new Date('2026-07-17T12:01:00.000Z') }))).resolves.toMatchObject({
      shouldRun: false,
      reason: 'cooldown_active',
      agent: h.state.agent,
      state: h.state.state,
    })
  })

  it('runs when the agent is enabled and no gate blocks the conversation', async () => {
    h.state.agent = agent({ cooldown_seconds: 60 })
    h.state.state = conversationState({ last_run_at: '2026-07-17T12:00:00.000Z' })

    await expect(shouldRunAiAgent(input({ now: new Date('2026-07-17T12:01:00.000Z') }))).resolves.toEqual({
      shouldRun: true,
      agent: h.state.agent,
      state: h.state.state,
    })

    expect(queryFor('ai_agents').filters).toContainEqual(['account_id', accountId])
    expect(queryFor('ai_conversation_states').filters).toEqual(expect.arrayContaining([
      ['account_id', accountId],
      ['conversation_id', conversationId],
    ]))
    expect(queryFor('ai_agent_runs').filters).toEqual(expect.arrayContaining([
      ['account_id', accountId],
      ['conversation_id', conversationId],
      ['inbound_message_id', inboundMessageId],
    ]))
    expect(queryFor('ai_agent_runs').limit).toBe(1)
  })
})

function input(overrides: Partial<Parameters<typeof shouldRunAiAgent>[0]> = {}) {
  return { accountId, conversationId, inboundMessageId, ...overrides }
}

function queryFor(table: string) {
  const query = h.state.queries.find((item) => item.table === table)
  if (!query) throw new Error(`Expected query for ${table}`)
  return query
}

function agent(overrides: Partial<AiAgent> = {}): AiAgent {
  return {
    id: 'agent-1',
    account_id: accountId,
    user_id: 'user-1',
    name: 'Support agent',
    enabled: true,
    model_provider: 'openai',
    model_name: 'gpt-5-mini',
    instructions: 'Help the customer.',
    auto_reply: true,
    auto_move_deals: false,
    handoff_keywords: [],
    max_messages: 10,
    cooldown_seconds: 0,
    created_at: '2026-07-17T12:00:00.000Z',
    updated_at: '2026-07-17T12:00:00.000Z',
    ...overrides,
  }
}

function conversationState(overrides: Partial<AiConversationState> = {}): AiConversationState {
  return {
    id: 'state-1',
    account_id: accountId,
    conversation_id: conversationId,
    ai_agent_id: 'agent-1',
    status: 'active',
    last_inbound_message_id: null,
    last_run_at: null,
    paused_reason: null,
    created_at: '2026-07-17T12:00:00.000Z',
    updated_at: '2026-07-17T12:00:00.000Z',
    ...overrides,
  }
}

function agentRun(overrides: Partial<AiAgentRun> = {}): AiAgentRun {
  return {
    id: 'run-1',
    account_id: accountId,
    ai_agent_id: 'agent-1',
    conversation_id: conversationId,
    inbound_message_id: inboundMessageId,
    status: 'queued',
    decision: null,
    error_message: null,
    started_at: null,
    finished_at: null,
    created_at: '2026-07-17T12:00:00.000Z',
    ...overrides,
  }
}
