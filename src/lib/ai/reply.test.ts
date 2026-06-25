/**
 * Orchestration tests for `maybeReplyToInbound` (spec §6, §14).
 *
 * The Anthropic SDK and the service-role Supabase admin client are mocked;
 * `callAssistant` is injected per call (spec §14). No network, no DB. We
 * drive the engine entirely through programmable mock state and assert the
 * terminal effects:
 *   disabled        → skip (no model call, no send, no escalate)
 *   human-owned     → skip
 *   keyword         → escalate, model NOT called
 *   cap reached     → escalate, model NOT called
 *   low confidence  → escalate + log escalated
 *   happy path      → send + log replied (with usage + latency)
 *   thrown error    → escalate + log error (never throws)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AiAssistantConfig } from '@/types'

// ---- Programmable service-role admin-client mock --------------------------
// Lives in a hoisted block so the vi.mock factory below can close over it.
// Mirrors the builder-style mock in src/lib/automations/engine.test.ts.
const h = vi.hoisted(() => ({
  state: {
    config: null as AiAssistantConfig | null,
    conversation: { ai_handling: true } as { ai_handling?: boolean } | null,
    contactPhone: '+254700111222' as string | null,
    kbEntries: [] as Record<string, unknown>[],
    history: [] as Record<string, unknown>[],
    repliesTodayCount: 0 as number,
    // Force an error on a specific table read to exercise the catch path.
    failTable: null as string | null,
    // Captured effects.
    insertedLogs: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h

  function resolve(ops: {
    table: string
    type: string
    payload?: unknown
    head: boolean
  }): { data: unknown; error: unknown; count?: number } {
    const { table, type } = ops

    if (state.failTable === table) {
      return { data: null, error: { message: `forced failure on ${table}` } }
    }

    if (table === 'ai_assistant_config') {
      return { data: state.config, error: null }
    }
    if (table === 'conversations') {
      if (type === 'select') return { data: state.conversation, error: null }
      return { data: null, error: null } // update (escalate is mocked, but be safe)
    }
    if (table === 'contacts') {
      return { data: state.contactPhone ? { phone: state.contactPhone } : null, error: null }
    }
    if (table === 'knowledge_base_entries') {
      return { data: state.kbEntries, error: null }
    }
    if (table === 'messages') {
      return { data: state.history, error: null }
    }
    if (table === 'ai_reply_log') {
      if (type === 'insert') {
        state.insertedLogs.push((ops.payload as Record<string, unknown>) ?? {})
        return { data: null, error: null }
      }
      // count query (head: true)
      return { data: null, error: null, count: state.repliesTodayCount }
    }
    return { data: null, error: null }
  }

  function builder(table: string) {
    const ops = { table, type: 'select', payload: undefined as unknown, head: false }
    const b: Record<string, unknown> = {
      select: (_cols?: unknown, opts?: { head?: boolean }) => {
        if (opts?.head) ops.head = true
        return b
      },
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      eq: () => b,
      gte: () => b,
      order: () => b,
      limit: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      single: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        h.state.fromCalls.push(t)
        return builder(t)
      },
    }),
  }
})

// Mock the network-touching siblings so we assert calls without Meta I/O.
const sendAiReply = vi.fn(
  async (_args: unknown) => ({ whatsapp_message_id: 'wamid.1' }),
)
const escalateConversation = vi.fn(async (_args: unknown) => {})
vi.mock('./send', () => ({ sendAiReply: (a: unknown) => sendAiReply(a) }))
vi.mock('./escalate', () => ({
  escalateConversation: (a: unknown) => escalateConversation(a),
}))

// Guard: the real Anthropic SDK must never be constructed in tests.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      throw new Error('Anthropic SDK was constructed in a test')
    }
  },
}))

import { maybeReplyToInbound } from './reply'

// ---- Fixtures -------------------------------------------------------------

function config(overrides: Partial<AiAssistantConfig> = {}): AiAssistantConfig {
  return {
    id: 'cfg-1',
    account_id: 'acct-1',
    enabled: true,
    system_prompt: 'You are support for {business_name}.',
    handoff_message: 'A human will be with you shortly.',
    escalation_keywords: ['refund', 'lawyer'],
    business_name: 'Acme',
    model: 'claude-sonnet-4-6',
    daily_reply_cap: 500,
    created_at: '2026-06-25T00:00:00Z',
    updated_at: '2026-06-25T00:00:00Z',
    ...overrides,
  }
}

const BASE_ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  messageId: 'msg-1',
  accessToken: 'token-xyz',
  phoneNumberId: 'pn-1',
}

/** A confident, non-empty model verdict — drives the happy path. */
function confidentResult() {
  return {
    answer: 'We are open 9am to 5pm, Monday to Friday.',
    confident: true,
    reason: 'Opening hours are in the KB.',
    usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 1000 },
  }
}

/** A not-confident verdict — drives the low-confidence escalation. */
function unsureResult() {
  return {
    answer: '',
    confident: false,
    reason: 'KB does not cover this.',
    usage: { input_tokens: 1200, output_tokens: 10, cache_read_input_tokens: 1000 },
  }
}

beforeEach(() => {
  h.state.config = config()
  h.state.conversation = { ai_handling: true }
  h.state.contactPhone = '+254700111222'
  h.state.kbEntries = [
    {
      id: 'kb-1',
      account_id: 'acct-1',
      title: 'Hours',
      content: 'Open 9-5 Mon-Fri.',
      source_type: 'manual',
      enabled: true,
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    },
  ]
  h.state.history = []
  h.state.repliesTodayCount = 0
  h.state.failTable = null
  h.state.insertedLogs = []
  h.state.fromCalls = []
  sendAiReply.mockClear()
  escalateConversation.mockClear()
})

function lastLog() {
  return h.state.insertedLogs[h.state.insertedLogs.length - 1]
}

// ---- Tests ----------------------------------------------------------------

describe('maybeReplyToInbound — disabled → skip', () => {
  it('skips when no config row exists (AI never configured)', async () => {
    h.state.config = null
    const callAssistant = vi.fn()

    await maybeReplyToInbound({ ...BASE_ARGS, inboundText: 'hi', callAssistant })

    expect(callAssistant).not.toHaveBeenCalled()
    expect(sendAiReply).not.toHaveBeenCalled()
    expect(escalateConversation).not.toHaveBeenCalled()
    expect(lastLog()).toMatchObject({ decision: 'skipped', reason: 'no_config' })
  })

  it('skips when config exists but enabled is false', async () => {
    h.state.config = config({ enabled: false })
    const callAssistant = vi.fn()

    await maybeReplyToInbound({ ...BASE_ARGS, inboundText: 'hi', callAssistant })

    expect(callAssistant).not.toHaveBeenCalled()
    expect(sendAiReply).not.toHaveBeenCalled()
    expect(escalateConversation).not.toHaveBeenCalled()
    expect(lastLog()).toMatchObject({ decision: 'skipped', reason: 'disabled' })
  })
})

describe('maybeReplyToInbound — human-owned → skip', () => {
  it('skips when the conversation has ai_handling=false (a human took over)', async () => {
    h.state.conversation = { ai_handling: false }
    const callAssistant = vi.fn()

    await maybeReplyToInbound({ ...BASE_ARGS, inboundText: 'hello', callAssistant })

    expect(callAssistant).not.toHaveBeenCalled()
    expect(sendAiReply).not.toHaveBeenCalled()
    expect(escalateConversation).not.toHaveBeenCalled()
    expect(lastLog()).toMatchObject({ decision: 'skipped', reason: 'human_takeover' })
  })
})

describe('maybeReplyToInbound — keyword → escalate (no model call)', () => {
  it('escalates on a configured keyword WITHOUT calling the model', async () => {
    const callAssistant = vi.fn()

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'I want a refund please',
      callAssistant,
    })

    // The model must NOT be called on a guardrail hit (spec §6).
    expect(callAssistant).not.toHaveBeenCalled()
    expect(sendAiReply).not.toHaveBeenCalled()
    expect(escalateConversation).toHaveBeenCalledTimes(1)
    expect(escalateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', reason: 'keyword' }),
    )
    expect(lastLog()).toMatchObject({ decision: 'escalated', reason: 'keyword' })
  })

  it('escalates on an explicit "talk to a human" request without the model', async () => {
    const callAssistant = vi.fn()

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'Can I talk to a human?',
      callAssistant,
    })

    expect(callAssistant).not.toHaveBeenCalled()
    expect(escalateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'keyword' }),
    )
  })
})

describe('maybeReplyToInbound — daily cap → escalate', () => {
  it('escalates with reason cap_reached when today’s replies hit the cap', async () => {
    h.state.config = config({ daily_reply_cap: 5 })
    h.state.repliesTodayCount = 5
    const callAssistant = vi.fn()

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'what are your hours?',
      callAssistant,
    })

    expect(callAssistant).not.toHaveBeenCalled()
    expect(sendAiReply).not.toHaveBeenCalled()
    expect(escalateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'cap_reached' }),
    )
    expect(lastLog()).toMatchObject({ decision: 'escalated', reason: 'cap_reached' })
  })

  it('does NOT escalate on the cap when still below it', async () => {
    h.state.config = config({ daily_reply_cap: 500 })
    h.state.repliesTodayCount = 499
    const callAssistant = vi.fn(async () => confidentResult())

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'what are your hours?',
      callAssistant,
    })

    expect(callAssistant).toHaveBeenCalledTimes(1)
    expect(sendAiReply).toHaveBeenCalledTimes(1)
  })
})

describe('maybeReplyToInbound — low confidence → escalate', () => {
  it('escalates with low_confidence and logs the model usage', async () => {
    const callAssistant = vi.fn(async () => unsureResult())

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'do you offer financing?',
      callAssistant,
    })

    expect(callAssistant).toHaveBeenCalledTimes(1)
    expect(sendAiReply).not.toHaveBeenCalled()
    expect(escalateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'low_confidence' }),
    )
    expect(lastLog()).toMatchObject({
      decision: 'escalated',
      reason: 'low_confidence',
      confident: false,
      model: 'claude-sonnet-4-6',
      input_tokens: 1200,
      output_tokens: 10,
      cache_read_tokens: 1000,
    })
  })
})

describe('maybeReplyToInbound — happy path → send + log', () => {
  it('sends the reply and logs decision=replied with usage + latency', async () => {
    const callAssistant = vi.fn(async () => confidentResult())

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'what are your opening hours?',
      callAssistant,
    })

    expect(callAssistant).toHaveBeenCalledTimes(1)
    // Sent over the bot path with the model's answer text.
    expect(sendAiReply).toHaveBeenCalledTimes(1)
    expect(sendAiReply).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        text: 'We are open 9am to 5pm, Monday to Friday.',
        accessToken: 'token-xyz',
        phoneNumberId: 'pn-1',
      }),
    )
    expect(escalateConversation).not.toHaveBeenCalled()

    const log = lastLog()
    expect(log).toMatchObject({
      decision: 'replied',
      confident: true,
      model: 'claude-sonnet-4-6',
      input_tokens: 1200,
      output_tokens: 40,
      cache_read_tokens: 1000,
    })
    expect(typeof log.latency_ms).toBe('number')
    expect(log.latency_ms as number).toBeGreaterThanOrEqual(0)
  })

  it('passes the assembled system + messages to the model wrapper', async () => {
    const callAssistant = vi.fn(async (_args: unknown) => confidentResult())

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'what are your opening hours?',
      callAssistant,
    })

    const arg = callAssistant.mock.calls[0][0] as {
      model: string
      system: { text: string }[]
      messages: { role: string; content: string }[]
    }
    expect(arg.model).toBe('claude-sonnet-4-6')
    // KB block is the last system block and carries the entry content.
    expect(arg.system[arg.system.length - 1].text).toContain('Open 9-5 Mon-Fri.')
    // The inbound text is the final user message.
    const last = arg.messages[arg.messages.length - 1]
    expect(last).toEqual({ role: 'user', content: 'what are your opening hours?' })
  })
})

describe('maybeReplyToInbound — thrown error → escalate (never throws)', () => {
  it('escalates with reason=error and logs when the model call throws', async () => {
    const callAssistant = vi.fn(async () => {
      throw new Error('anthropic 529 overloaded')
    })

    await expect(
      maybeReplyToInbound({
        ...BASE_ARGS,
        inboundText: 'what are your hours?',
        callAssistant,
      }),
    ).resolves.toBeUndefined()

    expect(sendAiReply).not.toHaveBeenCalled()
    expect(escalateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'error' }),
    )
    expect(lastLog()).toMatchObject({ decision: 'error' })
    expect((lastLog().reason as string) ?? '').toContain('anthropic 529 overloaded')
  })

  it('escalates on a send failure (sent decision but Meta/DB threw)', async () => {
    sendAiReply.mockRejectedValueOnce(new Error('sent to Meta but DB insert failed'))
    const callAssistant = vi.fn(async () => confidentResult())

    await maybeReplyToInbound({
      ...BASE_ARGS,
      inboundText: 'what are your hours?',
      callAssistant,
    })

    expect(escalateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'error' }),
    )
    expect(lastLog()).toMatchObject({ decision: 'error' })
  })

  it('never throws even if the cap-count read fails', async () => {
    h.state.failTable = 'ai_reply_log'
    const callAssistant = vi.fn(async () => confidentResult())

    // The first ai_reply_log access is the cap count (head select); forcing
    // it to error sends the run down the catch path. Must resolve, not throw.
    await expect(
      maybeReplyToInbound({
        ...BASE_ARGS,
        inboundText: 'what are your hours?',
        callAssistant,
      }),
    ).resolves.toBeUndefined()

    expect(callAssistant).not.toHaveBeenCalled()
    expect(escalateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'error' }),
    )
  })
})
