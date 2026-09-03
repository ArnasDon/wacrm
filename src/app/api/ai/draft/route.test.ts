import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from '@/lib/ai/types'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

// ============================================================
// POST /api/ai/draft — this route never had a test file before
// (Fase 2 audit, 2.8 — GAP DE COBERTURA; hardening plan, paso 1).
//
// What stays REAL (never mocked): `@/lib/auth/account`'s error classes
// + `toErrorResponse` (only `requireRole` itself is swapped out, via a
// partial mock, so the route's real 401/403 mapping is exercised, not
// re-invented here); `@/lib/ai/routing`'s `routeAiContext` (pure,
// deterministic — this is precisely what proves `hasCatalog: false`
// really has the effect draft/route.ts's own comment claims, rather
// than just trusting the comment); `@/lib/ai/defaults`'s
// `buildSystemPrompt`/`buildSystemPromptBlocks` (so the assertions on
// prompt content below are against the actual scaffold, not a
// hand-written substitute); `@/lib/ai/query`'s `latestUserMessage`;
// `@/lib/ai/business-profile/context`'s `buildBusinessProfileContext`
// (pure formatting, never exercised unless a test configures a
// profile).
//
// What's mocked, and why: `requireRole` (would otherwise need a real
// Supabase session), `loadAiConfig`/`buildConversationContext`/
// `retrieveKnowledge`/`accountHasKnowledgeBase`/
// `loadBusinessProfileForAgent` (all real DB reads — mirrors the exact
// mocking level `auto-reply.test.ts` already uses for the same
// functions), `generateReply` (would otherwise call a real LLM
// provider — the seam test that runs this for real lives in
// `auto-reply.test.ts`, not here), `logAiUsage` (fire-and-forget
// telemetry, irrelevant to this route's contract), and
// `@/lib/flows/meta-send` — draft/route.ts does not import it today,
// but mocking it here is a deliberate regression guard: if a future
// change ever wired a WhatsApp send into this route, this file's
// `toHaveBeenCalledTimes(0)` checks would fail immediately instead of
// silently sending real messages the next time this suite runs against
// a real account.
// ============================================================

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  accountHasKnowledgeBase: vi.fn(),
  loadBusinessProfileForAgent: vi.fn(),
  generateReply: vi.fn(),
  logAiUsage: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: h.requireRole }
})
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/ai/context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('@/lib/ai/knowledge', () => ({
  retrieveKnowledge: h.retrieveKnowledge,
  accountHasKnowledgeBase: h.accountHasKnowledgeBase,
}))
vi.mock('@/lib/ai/business-profile/service', () => ({
  loadBusinessProfileForAgent: h.loadBusinessProfileForAgent,
}))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: h.logAiUsage }))
// route.ts constructs this client itself (`supabaseAdmin()`) to hand to
// the (mocked) `logAiUsage` above — without this mock, the real
// `supabaseAdmin()` throws (no service-role key in the test env) before
// `logAiUsage` is ever reached, which the route's own try/catch swallows
// silently. That would still leave every test passing, but only by
// accident of an unrelated exception — mocking this directly is what
// actually exercises `logAiUsage` the way production does.
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
}))

import { POST } from './route'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { AiError } from '@/lib/ai/types'

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    agentBehavior: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

/** Minimal double for the one raw Supabase call this route makes
 *  directly (`.from('conversations').select('id').eq(...).maybeSingle()`)
 *  — every other data access goes through the mocked library functions
 *  above, so this only needs to answer that one chain. */
function fakeSupabase(conversationRow: { id: string } | null, opts: { convErr?: boolean } = {}) {
  return {
    from: (table: string) => {
      if (table !== 'conversations') {
        throw new Error(`unexpected table in test double: ${table}`)
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve(
                opts.convErr
                  ? { data: null, error: { message: 'connection reset' } }
                  : { data: conversationRow, error: null },
              ),
          }),
        }),
      }
    },
  }
}

function requireRoleOk(accountId = 'acct-1', userId = 'user-1', conversationRow: { id: string } | null = { id: 'conv-1' }) {
  h.requireRole.mockResolvedValue({
    supabase: fakeSupabase(conversationRow),
    accountId,
    userId,
  })
}

function postRequest(body: Record<string, unknown> | undefined) {
  return new Request('http://localhost/api/ai/draft', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.requireRole.mockReset()
  h.loadAiConfig.mockReset().mockResolvedValue(aiConfig())
  h.buildConversationContext.mockReset().mockResolvedValue([{ role: 'user', content: 'Hola, necesito ayuda' }])
  h.retrieveKnowledge.mockReset().mockResolvedValue([])
  h.accountHasKnowledgeBase.mockReset().mockResolvedValue(true)
  h.loadBusinessProfileForAgent.mockReset().mockResolvedValue(null)
  h.generateReply
    .mockReset()
    .mockResolvedValue({ text: 'Draft suggestion', handoff: false, usage: null, toolCalls: [] })
  h.logAiUsage.mockReset().mockResolvedValue(undefined)
  h.engineSendText.mockReset()
  h.engineSendMedia.mockReset()
})

describe('POST /api/ai/draft — authorization', () => {
  it('requireRole rejecting with ForbiddenError (insufficient role) surfaces the real 403', async () => {
    h.requireRole.mockRejectedValue(new ForbiddenError("This action requires the 'agent' role or higher"))

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(403)
    expect(body.error).toBe("This action requires the 'agent' role or higher")
  })

  it('requireRole rejecting with UnauthorizedError (no session) surfaces the real 401', async () => {
    h.requireRole.mockRejectedValue(new UnauthorizedError())

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))

    expect(res.status).toBe(401)
  })
})

describe('POST /api/ai/draft — validation', () => {
  it('missing conversation_id → 400', async () => {
    requireRoleOk()

    const res = await POST(postRequest({}))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(400)
    expect(body.error).toBe('conversation_id is required')
    expect(h.loadAiConfig).not.toHaveBeenCalled()
  })

  it('a conversation the RLS-scoped client cannot see → 404 (missing row, not an error)', async () => {
    h.requireRole.mockResolvedValue({ supabase: fakeSupabase(null), accountId: 'acct-1', userId: 'user-1' })

    const res = await POST(postRequest({ conversation_id: 'conv-does-not-exist' }))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(404)
    expect(body.error).toBe('Conversation not found')
  })

  it('a real Supabase error on the conversation lookup → 500, never the raw error', async () => {
    h.requireRole.mockResolvedValue({
      supabase: fakeSupabase(null, { convErr: true }),
      accountId: 'acct-1',
      userId: 'user-1',
    })

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))

    expect(res.status).toBe(500)
  })

  it('ai_not_configured when loadAiConfig resolves null', async () => {
    requireRoleOk()
    h.loadAiConfig.mockResolvedValue(null)

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { code: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe('ai_not_configured')
  })

  it('no_messages when the conversation has nothing to draft from yet', async () => {
    requireRoleOk()
    h.buildConversationContext.mockResolvedValue([])

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { code: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe('no_messages')
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('an undecryptable stored API key surfaces key_decrypt_failed, distinct from ai_not_configured', async () => {
    requireRoleOk()
    h.loadAiConfig.mockRejectedValue(new Error('bad ENCRYPTION_KEY'))

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { code: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe('key_decrypt_failed')
  })

  it('an AiError thrown by generateReply (e.g. an empty/timeout response) preserves its real status and code', async () => {
    requireRoleOk()
    h.generateReply.mockRejectedValue(
      new AiError('OpenAI returned an empty response.', { code: 'empty_response', status: 502 }),
    )

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { error: string; code: string }

    expect(res.status).toBe(502)
    expect(body.code).toBe('empty_response')
    expect(body.error).toBe('OpenAI returned an empty response.')
  })
})

describe('POST /api/ai/draft — happy path', () => {
  it('returns the drafted text on success', async () => {
    requireRoleOk()

    const res = await POST(postRequest({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { draft: string }

    expect(res.status).toBe(200)
    expect(body.draft).toBe('Draft suggestion')
  })

  it('never sends anything over WhatsApp — draft only ever hands text back to the composer', async () => {
    requireRoleOk()

    await POST(postRequest({ conversation_id: 'conv-1' }))

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/draft — hasCatalog: false is real, not just documented', () => {
  it('generateReply is called with no `tools` and no `executeTool` — draft never attaches catalog tools', async () => {
    requireRoleOk()

    await POST(postRequest({ conversation_id: 'conv-1' }))

    expect(h.generateReply).toHaveBeenCalledTimes(1)
    const callArgs = h.generateReply.mock.calls[0][0]
    expect(callArgs.tools).toBeUndefined()
    expect(callArgs.executeTool).toBeUndefined()
  })

  it('a price/stock question still produces a prompt whose ONLY declared source of truth is the Knowledge Base — the real routeAiContext/buildSystemPrompt never attach catalog rules here', async () => {
    requireRoleOk()
    // Strong catalog vocabulary (routing.ts's own CATALOG_WORDS/PHRASES) —
    // if `hasCatalog: false` were ever dropped from this route, routing
    // would have every reason to treat this as a catalog question.
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Cuánto cuesta el producto y qué colores tienen disponibles?' },
    ])

    await POST(postRequest({ conversation_id: 'conv-1' }))

    const callArgs = h.generateReply.mock.calls[0][0]
    const systemPrompt: string = callArgs.systemPrompt
    expect(systemPrompt).toContain(
      'The KNOWLEDGE BASE below is the ONLY source of truth for product information.',
    )
    expect(systemPrompt).not.toContain('CATALOG TOOLS')
  })

  it('mode is always "draft" — the AUTO-REPLY MODE block (added only when mode==="auto_reply") never appears in the prompt this route builds', async () => {
    requireRoleOk()

    await POST(postRequest({ conversation_id: 'conv-1' }))

    const systemPrompt: string = h.generateReply.mock.calls[0][0].systemPrompt
    // Note: the shared Guidelines block legitimately mentions the bare
    // "[[HANDOFF]]" sentinel text even in draft mode ("...or reply with
    // [[HANDOFF]] in auto-reply mode" — a conditional reference, not an
    // instruction to draft itself), so asserting against that substring
    // would be a false positive. The actual mode-gated block is the
    // "AUTO-REPLY MODE —" section header, added only when
    // mode === 'auto_reply' (see defaults.ts::buildSystemPromptParts).
    expect(systemPrompt).not.toContain('AUTO-REPLY MODE —')
  })
})

describe('POST /api/ai/draft — accountId isolation', () => {
  it('every downstream call is scoped by THIS request\'s accountId, never a hardcoded or smuggled one', async () => {
    requireRoleOk('acct-2', 'user-9')

    await POST(postRequest({ conversation_id: 'conv-1' }))

    expect(h.loadAiConfig.mock.calls[0][1]).toBe('acct-2')
    expect(h.accountHasKnowledgeBase.mock.calls[0][1]).toBe('acct-2')
    expect(h.retrieveKnowledge.mock.calls[0][1]).toBe('acct-2')
  })

  it('a body-supplied account_id (if the caller tried to smuggle one) is never read — accountId always comes from requireRole', async () => {
    requireRoleOk('acct-2', 'user-9')

    await POST(postRequest({ conversation_id: 'conv-1', account_id: 'acct-1', accountId: 'acct-1' }))

    expect(h.loadAiConfig.mock.calls[0][1]).toBe('acct-2')
  })
})
