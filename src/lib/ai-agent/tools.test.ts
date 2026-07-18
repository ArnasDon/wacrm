import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiAgentContext } from './context'

const mocks = vi.hoisted(() => ({ sendMessageToConversation: vi.fn() }))
vi.mock('@/lib/whatsapp/send-message', () => ({ sendMessageToConversation: mocks.sendMessageToConversation }))

import {
  AiAgentToolError,
  executeAiAgentDecision,
  executeDealAction,
} from './tools'

type Response = { data?: unknown; error?: { message: string } | null }

function fakeDb(responses: Record<string, Response[]> = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const db = {
    from(table: string) {
      const next = () => responses[table]?.shift() ?? { data: null, error: null }
      const query = {
        select(...args: unknown[]) { calls.push({ table, method: 'select', args }); return query },
        insert(...args: unknown[]) { calls.push({ table, method: 'insert', args }); return query },
        update(...args: unknown[]) { calls.push({ table, method: 'update', args }); return query },
        upsert(...args: unknown[]) { calls.push({ table, method: 'upsert', args }); return query },
        eq(...args: unknown[]) { calls.push({ table, method: 'eq', args }); return query },
        in(...args: unknown[]) { calls.push({ table, method: 'in', args }); return query },
        limit(...args: unknown[]) { calls.push({ table, method: 'limit', args }); return query },
        single() { return Promise.resolve(next()) },
        maybeSingle() { return Promise.resolve(next()) },
        then(resolve: (value: Response) => unknown) { return Promise.resolve(next()).then(resolve) },
      }
      return query
    },
  } as unknown as SupabaseClient
  return { db, calls }
}

const context: AiAgentContext = {
  conversation: { id: 'conv-1', status: 'pending', assigned_agent_id: null, last_message_text: null, last_message_at: null, created_at: '', updated_at: '' },
  contact: { id: 'contact-1', phone: '+15551234567', name: null, email: null, company: null },
  messages: [], activeDeal: null, pipelines: [],
}

describe('executeAiAgentDecision', () => {
  beforeEach(() => mocks.sendMessageToConversation.mockReset())

  it('sends reply text as a bot and returns message IDs', async () => {
    const { db } = fakeDb({ ai_agents: [{ data: { user_id: 'user-1' }, error: null }] })
    mocks.sendMessageToConversation.mockResolvedValue({ messageId: 'msg-1', whatsappMessageId: 'wa-1' })

    await expect(executeAiAgentDecision({ db, accountId: 'acct-1', aiAgentId: 'agent-1', conversationId: 'conv-1', context, decision: { action: 'reply', text: 'Hello', confidence: 1 } }))
      .resolves.toEqual({ replyMessageId: 'msg-1', whatsappMessageId: 'wa-1', dealAction: { type: 'none' } })
    expect(mocks.sendMessageToConversation).toHaveBeenCalledWith(db, 'acct-1', { conversationId: 'conv-1', messageType: 'text', contentText: 'Hello', senderType: 'bot', aiGenerated: true })
  })

  it('does not send a no_reply decision', async () => {
    const { db } = fakeDb({ ai_agents: [{ data: { user_id: 'user-1' }, error: null }] })
    await executeAiAgentDecision({ db, accountId: 'acct-1', aiAgentId: 'agent-1', conversationId: 'conv-1', context, decision: { action: 'no_reply', reason: 'quiet', confidence: 1 } })
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('reopens the account conversation for handoff', async () => {
    const { db, calls } = fakeDb({ ai_agents: [{ data: null, error: { message: 'AI agent lookup failed' } }], ai_conversation_states: [{}], conversations: [{}] })
    await expect(executeAiAgentDecision({ db, accountId: 'acct-1', aiAgentId: 'agent-1', conversationId: 'conv-1', context, decision: { action: 'handoff', reason: 'human needed', confidence: 1 } }))
      .resolves.toEqual({ handoff: { status: 'handoff' } })
    expect(calls).not.toContainEqual(expect.objectContaining({ table: 'ai_conversation_states', method: 'upsert' }))
    expect(calls).toContainEqual({ table: 'conversations', method: 'eq', args: ['account_id', 'acct-1'] })
    expect(calls).toContainEqual({ table: 'conversations', method: 'eq', args: ['id', 'conv-1'] })
  })

  it('does not reopen handoff when a takeover is detected before the side effect', async () => {
    const { db, calls } = fakeDb({ conversations: [{}] })
    const takeover = new Error('conversation_paused')

    await expect(executeAiAgentDecision({
      db,
      accountId: 'acct-1',
      aiAgentId: 'agent-1',
      conversationId: 'conv-1',
      context,
      decision: { action: 'handoff', reason: 'human needed', confidence: 1 },
      assertCanRun: vi.fn().mockRejectedValue(takeover),
    })).rejects.toBe(takeover)

    expect(calls).not.toContainEqual(expect.objectContaining({ table: 'conversations', method: 'update' }))
  })
})

describe('executeDealAction', () => {
  const base = { accountId: 'acct-1', userId: 'user-1', conversationId: 'conv-1', contactId: 'contact-1', activeDealId: 'deal-1' }

  it('creates an account-scoped deal after validating pipeline and stage, using default currency', async () => {
    const { db, calls } = fakeDb({ pipelines: [{ data: { id: 'pipe-1' }, error: null }], pipeline_stages: [{ data: { id: 'stage-1' }, error: null }], accounts: [{ data: { default_currency: 'BRL' }, error: null }], deals: [{ data: null, error: null }, { data: null, error: null }, { data: { id: 'deal-1' }, error: null }] })
    await expect(executeDealAction({ db, ...base, action: { type: 'create', pipeline_id: 'pipe-1', stage_id: 'stage-1', title: 'New deal', value: 50 } })).resolves.toEqual({ type: 'created', dealId: 'deal-1' })
    expect(calls).toContainEqual(expect.objectContaining({ table: 'deals', method: 'insert', args: [expect.objectContaining({ account_id: 'acct-1', user_id: 'user-1', pipeline_id: 'pipe-1', stage_id: 'stage-1', contact_id: 'contact-1', conversation_id: 'conv-1', currency: 'BRL', value: 50, status: 'open' })] }))
  })

  it.each([
    ['absent', {}],
    ['null', { default_currency: null }],
  ])('falls back to USD when the default currency is %s', async (_description, account) => {
    const { db, calls } = fakeDb({
      pipelines: [{ data: { id: 'pipe-1' }, error: null }],
      pipeline_stages: [{ data: { id: 'stage-1' }, error: null }],
      accounts: [{ data: account, error: null }],
      deals: [{ data: null, error: null }, { data: null, error: null }, { data: { id: 'deal-1' }, error: null }],
    })

    await executeDealAction({ db, ...base, action: { type: 'create', pipeline_id: 'pipe-1', stage_id: 'stage-1', title: 'New deal' } })

    expect(calls).toContainEqual(expect.objectContaining({
      table: 'deals',
      method: 'insert',
      args: [expect.objectContaining({ currency: 'USD' })],
    }))
  })

  it('requires a contact to create a deal', async () => {
    const { db } = fakeDb()
    await expect(executeDealAction({ db, ...base, contactId: null, action: { type: 'create', pipeline_id: 'pipe-1', stage_id: 'stage-1', title: 'New' } })).rejects.toMatchObject({ code: 'missing_contact' } satisfies Partial<AiAgentToolError>)
  })

  it('rejects creating a duplicate open deal for the same conversation', async () => {
    const { db } = fakeDb({
      pipelines: [{ data: { id: 'pipe-1' }, error: null }],
      pipeline_stages: [{ data: { id: 'stage-1' }, error: null }],
      deals: [{ data: { id: 'deal-existing' }, error: null }],
    })

    await expect(executeDealAction({ db, ...base, action: { type: 'create', pipeline_id: 'pipe-1', stage_id: 'stage-1', title: 'New deal' } }))
      .rejects.toMatchObject({ code: 'duplicate_deal' })
  })

  it('rejects moving a deal from another account', async () => {
    const { db } = fakeDb({ deals: [{ data: null, error: null }] })
    await expect(executeDealAction({ db, ...base, action: { type: 'move', deal_id: 'deal-other', stage_id: 'stage-1', reason: 'x' } })).rejects.toMatchObject({ code: 'invalid_deal' })
  })

  it('rejects moving a same-account deal that is not tied to the conversation or contact', async () => {
    const { db } = fakeDb({ deals: [{ data: { id: 'deal-1', pipeline_id: 'pipe-1', conversation_id: 'conv-other', contact_id: 'contact-other', status: 'open' }, error: null }] })

    await expect(executeDealAction({ db, ...base, action: { type: 'move', deal_id: 'deal-1', stage_id: 'stage-1', reason: 'x' } }))
      .rejects.toMatchObject({ code: 'invalid_deal' })
  })

  it('rejects moving to a stage outside an account-owned pipeline', async () => {
    const { db, calls } = fakeDb({ deals: [{ data: { id: 'deal-1', pipeline_id: 'pipe-1', conversation_id: 'conv-1', contact_id: 'contact-1', status: 'open' }, error: null }], pipeline_stages: [{ data: null, error: null }] })
    await expect(executeDealAction({ db, ...base, action: { type: 'move', deal_id: 'deal-1', stage_id: 'stage-other', reason: 'x' } })).rejects.toMatchObject({ code: 'invalid_stage' })
    expect(calls).toContainEqual({ table: 'pipeline_stages', method: 'eq', args: ['pipeline_id', 'pipe-1'] })
  })

  it('moves an account-owned deal and adds a bot-visible marker with the account-owned stage name', async () => {
    const { db, calls } = fakeDb({ deals: [{ data: { id: 'deal-1', pipeline_id: 'pipe-1', conversation_id: 'conv-1', contact_id: 'contact-1', status: 'open' }, error: null }, { data: null, error: null }], pipeline_stages: [{ data: { id: 'stage-2', name: 'Proposal Sent' }, error: null }], conversations: [{ data: { id: 'conv-1' }, error: null }], messages: [{ data: null, error: null }] })
    await expect(executeDealAction({ db, ...base, action: { type: 'move', deal_id: 'deal-1', stage_id: 'stage-2', reason: 'x' } })).resolves.toEqual({ type: 'moved', dealId: 'deal-1', stageId: 'stage-2' })
    expect(calls).toContainEqual(expect.objectContaining({ table: 'deals', method: 'update', args: [expect.objectContaining({ stage_id: 'stage-2', updated_at: expect.any(String) })] }))
    expect(calls).toContainEqual(expect.objectContaining({ table: 'messages', method: 'insert', args: [expect.objectContaining({
      conversation_id: 'conv-1', sender_type: 'bot', content_type: 'text', content_text: 'AI moved deal to Proposal Sent', status: 'sent',
    })] }))
    expect(calls).toContainEqual({ table: 'conversations', method: 'eq', args: ['account_id', 'acct-1'] })
    expect(calls).toContainEqual({ table: 'conversations', method: 'eq', args: ['id', 'conv-1'] })
  })

  it('does not fail the run when the deal move audit marker cannot be inserted', async () => {
    const { db } = fakeDb({ deals: [{ data: { id: 'deal-1', pipeline_id: 'pipe-1', conversation_id: 'conv-1', contact_id: 'contact-1', status: 'open' }, error: null }, { data: null, error: null }], pipeline_stages: [{ data: { id: 'stage-2', name: 'Proposal Sent' }, error: null }], conversations: [{ data: { id: 'conv-1' }, error: null }], messages: [{ data: null, error: { message: 'marker insert failed' } }] })
    await expect(executeDealAction({ db, ...base, action: { type: 'move', deal_id: 'deal-1', stage_id: 'stage-2', reason: 'x' } })).resolves.toEqual({ type: 'moved', dealId: 'deal-1', stageId: 'stage-2' })
  })

  it('updates only supplied editable deal fields', async () => {
    const { db, calls } = fakeDb({ deals: [{ data: { id: 'deal-1', pipeline_id: 'pipe-1', conversation_id: 'conv-1', contact_id: 'contact-1', status: 'open' }, error: null }, { data: null, error: null }] })
    await expect(executeDealAction({ db, ...base, action: { type: 'update', deal_id: 'deal-1', title: 'Updated', expected_close_date: '2026-08-01' } })).resolves.toEqual({ type: 'updated', dealId: 'deal-1' })
    expect(calls).toContainEqual({ table: 'deals', method: 'update', args: [{ title: 'Updated', expected_close_date: '2026-08-01', updated_at: expect.any(String) }] })
  })
})
