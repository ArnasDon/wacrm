import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiConfig } from './types'

// ============================================================
// H-6 fix (Punto 6 audit) — dispatchInboundToAiReply() mutual exclusion
// per conversation. See supabase/migrations/060_ai_processing_claim.sql
// and the claim/release/drain-loop code in auto-reply.ts.
//
// DETERMINISM, NOT TIMING — same discipline as src/app/api/whatsapp/
// webhook/first-inbound-race.test.ts (migration 053's own test file),
// which this file deliberately mirrors: every mock body here resolves
// via a *synchronous* statement sequence (no setTimeout, no real I/O).
// JS is single-threaded, so two `dispatchInboundToAiReply()` calls
// driven through `Promise.all([...])` can never literally overlap —
// whichever call reaches a given mock statement first runs that
// statement's entire body, including its state mutation, to completion
// before the other call's corresponding statement runs. That is exactly
// the property a real Postgres row-level UPDATE gives the claim/release
// functions (see the migration's own reasoning for why this holds
// against real concurrent HTTP requests, and its one disclosed,
// deliberately-accepted residual limitation), so the interleaving here
// is repeatable and never flaky.
//
// Real, unmocked: ./context (buildConversationContext,
// latestCustomerMessageId — both query the fake `messages` table
// below), ./query (latestUserMessage), ./routing (routeAiContext),
// ./catalog/context (catalogContextToPromptText/updateCatalogContext —
// inert here, catalog is off), ./handoff, ./business-profile/handoff-
// intent. Mocked: ./config, ./generate, ./knowledge, ./catalog/
// resolver (forced off — these tests are about concurrency, not
// catalog/knowledge behavior), ./business-profile/service,
// @/lib/flows/meta-send, ./admin-client (the fake DB below).
// ============================================================

interface ConvRow {
  id: string
  account_id: string
  assigned_agent_id: string | null
  ai_autoreply_disabled: boolean
  ai_reply_count: number
  ai_processing_started_at: string | null
  ai_catalog_context: unknown | null
}
interface MsgRow {
  id: string
  conversation_id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  created_at: string
}

const h = vi.hoisted(() => ({
  state: {
    conversations: [] as ConvRow[],
    messages: [] as MsgRow[],
    seq: 0,
    claimSlotOk: true,
  },
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
  loadAiConfig: vi.fn(),
}))

function nextId(prefix: string): string {
  h.state.seq += 1
  return `${prefix}-${h.state.seq}`
}

function seedConversation(overrides: Partial<ConvRow> = {}): ConvRow {
  const conv: ConvRow = {
    id: overrides.id ?? nextId('conv'),
    account_id: overrides.account_id ?? 'acct-1',
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    ai_processing_started_at: null,
    ai_catalog_context: null,
    ...overrides,
  }
  h.state.conversations.push(conv)
  return conv
}

function seedCustomerMessage(conversationId: string, text: string, atMs: number): MsgRow {
  const row: MsgRow = {
    id: nextId('msg'),
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: text,
    created_at: new Date(atMs).toISOString(),
  }
  h.state.messages.push(row)
  return row
}

// ------------------------------------------------------------
// Generic in-memory Postgres-shaped fake, extended (beyond the H-5
// fakes' plain .eq()/.in()) with .order()/.limit()/.or() — the exact
// filter surface buildConversationContext/latestCustomerMessageId/
// claimAiProcessing actually use.
// ------------------------------------------------------------
function fakeDb() {
  function conversationsTable() {
    return {
      select: () => {
        const filters: [string, unknown][] = []
        const api = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return api
          },
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.conversations.find((c) => filters.every(([col, val]) => (c as never)[col] === val)) ?? null,
              error: null,
            }),
        }
        return api
      },
      update: (payload: Partial<ConvRow>) => {
        const filters: [string, unknown][] = []
        let orExpr: string | null = null
        const matches = (row: ConvRow) =>
          filters.every(([col, val]) => (row as never)[col] === val) &&
          (!orExpr ||
            orExpr.split(',').some((clause) => {
              const [col, op, val] = clause.split('.')
              const current = (row as never)[col] as string | null
              if (op === 'is') return val === 'null' ? current === null : String(current) === val
              if (op === 'lt') return typeof current === 'string' && current < val
              return false
            }))
        const api = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return api
          },
          or: (expr: string) => {
            orExpr = expr
            return api
          },
          select: () => api,
          maybeSingle: () => Promise.resolve(run(true)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(run(false)).then(resolve, reject),
        }
        function run(single: boolean) {
          const matched = h.state.conversations.filter(matches)
          for (const row of matched) Object.assign(row, payload)
          const rows = matched.map((r) => ({ id: r.id }))
          if (single) return { data: rows[0] ?? null, error: null }
          return { data: rows, error: null }
        }
        return api
      },
    }
  }

  function messagesTable() {
    return {
      select: () => {
        const filters: [string, unknown][] = []
        let limitN = Infinity
        let desc = false
        const api = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return api
          },
          order: (_col: string, opts?: { ascending?: boolean }) => {
            desc = opts?.ascending === false
            return api
          },
          limit: (n: number) => {
            limitN = n
            return api
          },
          maybeSingle: () => Promise.resolve(run(true)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(run(false)).then(resolve, reject),
        }
        function run(single: boolean) {
          let matched = h.state.messages.filter((m) => filters.every(([col, val]) => (m as never)[col] === val))
          matched = [...matched].sort((a, b) =>
            desc ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at),
          )
          matched = matched.slice(0, limitN)
          if (single) return { data: matched[0] ?? null, error: null }
          return { data: matched, error: null }
        }
        return api
      },
    }
  }

  return {
    from: (table: string) => {
      if (table === 'automations') {
        const chain = { select: () => chain, eq: () => chain, in: () => chain, limit: () => Promise.resolve({ data: [], error: null }) }
        return chain
      }
      if (table === 'conversations') return conversationsTable()
      if (table === 'messages') return messagesTable()
      throw new Error(`unexpected table in H-7 concurrency fake: ${table}`)
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_ai_reply_slot') {
        const conv = h.state.conversations.find((c) => c.id === args.conversation_id)
        if (!conv) return Promise.resolve({ data: false, error: null })
        if (!h.state.claimSlotOk || conv.ai_reply_count >= (args.max_replies as number)) {
          return Promise.resolve({ data: false, error: null })
        }
        conv.ai_reply_count += 1
        return Promise.resolve({ data: true, error: null })
      }
      if (name === 'release_or_continue_ai_processing') {
        const conv = h.state.conversations.find((c) => c.id === args.p_conversation_id)
        const latest = [...h.state.messages]
          .filter((m) => m.conversation_id === args.p_conversation_id && m.sender_type === 'customer' && m.content_type === 'text')
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        const latestId = latest?.id ?? null
        const releaseIt = latestId === null || latestId === args.p_last_seen_message_id
        if (conv) conv.ai_processing_started_at = releaseIt ? null : new Date().toISOString()
        // RETURNS TABLE → an array of rows (real convention — see
        // insert_inbound_customer_message, migration 053); the real
        // code reads `data?.[0]`, never `.maybeSingle()`.
        return Promise.resolve({ data: [{ released: releaseIt, latest_message_id: latestId }], error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  }
}

vi.mock('./admin-client', () => ({ supabaseAdmin: () => fakeDb() }))
vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./knowledge', () => ({
  retrieveKnowledge: vi.fn().mockResolvedValue([]),
  accountHasKnowledgeBase: vi.fn().mockResolvedValue(false),
}))
vi.mock('./catalog/resolver', () => ({
  hasActiveCatalogSources: vi.fn().mockResolvedValue(false),
  createResolverCache: () => ({}),
}))
vi.mock('./business-profile/service', () => ({
  loadBusinessProfileForAgent: vi.fn().mockResolvedValue({ profile: null, departments: [], contacts: [] }),
}))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
}))

import { dispatchInboundToAiReply } from './auto-reply'

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    agentBehavior: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function dispatchArgs(conv: ConvRow) {
  return { accountId: conv.account_id, conversationId: conv.id, contactId: 'contact-1', configOwnerUserId: 'user-1' }
}

function reply(text: string) {
  return { text, handoff: false, usage: null, toolCalls: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.conversations = []
  h.state.messages = []
  h.state.seq = 0
  h.state.claimSlotOk = true
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.generateReply.mockResolvedValue(reply('Hello!'))
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wam-1' })
})

describe('H-7 — dispatchInboundToAiReply mutual exclusion per conversation', () => {
  it('TEST 1 — two concurrent dispatches of the SAME conversation: exactly one generates+sends, never two overlapping generations', async () => {
    const conv = seedConversation()
    seedCustomerMessage(conv.id, 'Quiero un celular', 1_700_000_000_000)

    let concurrentGenerations = 0
    let maxConcurrentGenerations = 0
    h.generateReply.mockImplementation(async () => {
      concurrentGenerations++
      maxConcurrentGenerations = Math.max(maxConcurrentGenerations, concurrentGenerations)
      const result = reply('Hello!')
      concurrentGenerations--
      return result
    })

    await Promise.all([dispatchInboundToAiReply(dispatchArgs(conv)), dispatchInboundToAiReply(dispatchArgs(conv))])

    // The core H-6 property: never two generations "in flight" at once
    // for the same conversation.
    expect(maxConcurrentGenerations).toBe(1)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    // The claim is released afterward — a later dispatch is never stuck.
    expect(conv.ai_processing_started_at).toBeNull()
  })

  it('TEST 2 — THREE concurrent dispatches of the same conversation: still at most one generation at a time', async () => {
    const conv = seedConversation()
    seedCustomerMessage(conv.id, 'Hola', 1_700_000_000_000)

    let concurrentGenerations = 0
    let maxConcurrentGenerations = 0
    h.generateReply.mockImplementation(async () => {
      concurrentGenerations++
      maxConcurrentGenerations = Math.max(maxConcurrentGenerations, concurrentGenerations)
      const result = reply('Hello!')
      concurrentGenerations--
      return result
    })

    await Promise.all([
      dispatchInboundToAiReply(dispatchArgs(conv)),
      dispatchInboundToAiReply(dispatchArgs(conv)),
      dispatchInboundToAiReply(dispatchArgs(conv)),
    ])

    expect(maxConcurrentGenerations).toBe(1)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(conv.ai_processing_started_at).toBeNull()
  })

  it('TEST 3 — processing fails (generateReply throws): the claim is released, and the very next dispatch is not blocked', async () => {
    const conv = seedConversation()
    seedCustomerMessage(conv.id, 'Hola', 1_700_000_000_000)
    h.generateReply.mockRejectedValueOnce(new Error('provider down'))

    await dispatchInboundToAiReply(dispatchArgs(conv))
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(conv.ai_processing_started_at).toBeNull() // released despite the error
    // The failure path hands off — auto-reply is now disabled for this
    // thread, exactly like the existing F2 behavior (unchanged by H-6).
    expect(conv.ai_autoreply_disabled).toBe(true)

    // Retry: re-enable and confirm a fresh dispatch is NOT rejected as
    // "already in progress".
    conv.ai_autoreply_disabled = false
    h.generateReply.mockResolvedValueOnce(reply('Recovered!'))
    await dispatchInboundToAiReply(dispatchArgs(conv))
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(conv.ai_processing_started_at).toBeNull()
  })

  it('TEST 4 — a stale claim (abandoned by a crashed/killed instance) is recovered by the next dispatch', async () => {
    const conv = seedConversation({ ai_processing_started_at: new Date(Date.now() - 15 * 60_000).toISOString() })
    seedCustomerMessage(conv.id, 'Hola', 1_700_000_000_000)

    await dispatchInboundToAiReply(dispatchArgs(conv))
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(conv.ai_processing_started_at).toBeNull()
  })

  it('a LIVE (non-stale) claim blocks a dispatch cleanly — no generation, no send, claim left exactly as it was', async () => {
    const liveClaim = new Date().toISOString()
    const conv = seedConversation({ ai_processing_started_at: liveClaim })
    seedCustomerMessage(conv.id, 'Hola', 1_700_000_000_000)

    await dispatchInboundToAiReply(dispatchArgs(conv))
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(conv.ai_processing_started_at).toBe(liveClaim) // untouched — still "owned" by whoever holds it
  })

  it('TEST 5 — two DIFFERENT conversations dispatched concurrently never block each other', async () => {
    const convA = seedConversation()
    const convB = seedConversation()
    seedCustomerMessage(convA.id, 'Hola A', 1_700_000_000_000)
    seedCustomerMessage(convB.id, 'Hola B', 1_700_000_000_000)

    await Promise.all([dispatchInboundToAiReply(dispatchArgs(convA)), dispatchInboundToAiReply(dispatchArgs(convB))])

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(convA.ai_processing_started_at).toBeNull()
    expect(convB.ai_processing_started_at).toBeNull()
  })

  it('TEST 6 — handoff: the claim never stays held, and no AI reply is sent once the model hands off', async () => {
    const conv = seedConversation()
    seedCustomerMessage(conv.id, 'Quiero hablar con una persona', 1_700_000_000_000)
    h.generateReply.mockResolvedValueOnce({ text: '', handoff: true, usage: null, toolCalls: [] })

    await dispatchInboundToAiReply(dispatchArgs(conv))

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(conv.ai_autoreply_disabled).toBe(true)
    expect(conv.ai_processing_started_at).toBeNull() // never left stuck after a handoff
  })

  it('TEST 7 — a message arriving WHILE generating is never lost: the SAME dispatch drains it, never a second competing generation', async () => {
    const conv = seedConversation()
    const msgA = seedCustomerMessage(conv.id, 'Quiero un celular', 1_700_000_000_000)

    // The first generateReply call simulates "a second customer message
    // arrives while the model is thinking" as a real, observable side
    // effect on the shared `messages` table — deterministic (no
    // setTimeout), exactly the discipline first-inbound-race.test.ts
    // itself uses. The reply text lets the assertions below prove which
    // physical call produced which sent message.
    h.generateReply
      .mockImplementationOnce(async () => {
        seedCustomerMessage(conv.id, 'Menos de 20 mil', 1_700_000_005_000) // arrives mid-generation
        return reply('Buscando celulares para ti...')
      })
      .mockImplementationOnce(async (args: { messages: { role: string; content: string }[] }) => {
        // By the time the SECOND (drain-loop) generation runs, it must
        // see BOTH customer messages — proof the second one was not lost.
        expect(args.messages.map((m) => m.content)).toEqual(['Quiero un celular', 'Menos de 20 mil'])
        return reply('Tenemos varios modelos por menos de 20 mil.')
      })

    await dispatchInboundToAiReply(dispatchArgs(conv))

    // Both messages answered — by the SAME dispatch, via the drain loop
    // — never by a second, independently-racing dispatch.
    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'Buscando celulares para ti...' }))
    expect(h.engineSendText).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'Tenemos varios modelos por menos de 20 mil.' }))
    expect(conv.ai_processing_started_at).toBeNull()
    expect(msgA.content_text).toBe('Quiero un celular') // sanity: the original message itself is untouched
  })

  it('TEST 7b — while dispatch A drains a newer message, a genuinely concurrent dispatch B still cannot generate in parallel', async () => {
    const conv = seedConversation()
    seedCustomerMessage(conv.id, 'Quiero un celular', 1_700_000_000_000)

    let concurrentGenerations = 0
    let maxConcurrentGenerations = 0
    h.generateReply
      .mockImplementationOnce(async () => {
        // Message B "arrives" and a second, real dispatch call fires for
        // it — while A is still inside its own first generation.
        seedCustomerMessage(conv.id, 'Menos de 20 mil', 1_700_000_005_000)
        concurrentGenerations++
        maxConcurrentGenerations = Math.max(maxConcurrentGenerations, concurrentGenerations)
        await dispatchInboundToAiReply(dispatchArgs(conv)) // dispatch B, nested — fails the claim, returns immediately
        concurrentGenerations--
        return reply('Buscando...')
      })
      .mockImplementationOnce(async () => {
        concurrentGenerations++
        maxConcurrentGenerations = Math.max(maxConcurrentGenerations, concurrentGenerations)
        const result = reply('Aquí tienes opciones.')
        concurrentGenerations--
        return result
      })

    await dispatchInboundToAiReply(dispatchArgs(conv)) // dispatch A

    expect(maxConcurrentGenerations).toBe(1) // B never generated concurrently with A
    expect(h.generateReply).toHaveBeenCalledTimes(2) // A's two drain-loop turns only
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(conv.ai_processing_started_at).toBeNull()
  })
})
