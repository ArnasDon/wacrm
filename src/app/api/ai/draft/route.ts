import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { createWhatsAppImageResolver } from '@/lib/ai/image-context'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { createAutoReplyTools } from '@/lib/ai/tools'
import { loadAgentToolPermissions, restrictToPreviewSafe } from '@/lib/ai/tool-permissions'
import { applySkillNarrowing, loadAgentSkills } from '@/lib/ai/skills'

/**
 * POST /api/ai/draft  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { draft } — a suggested reply for the agent to edit + send.
 *
 * Uses the account's configured provider/key (BYO). Never sends a WhatsApp
 * message or writes CRM data — it only hands text back to the composer for
 * a human to review. May call read-only/informational tools (catalogue and
 * knowledge search, style opinion — see PREVIEW_SAFE_TOOL_KEYS) the same
 * way the live auto-reply bot does; mutating tools are always excluded.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-draft:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    // Also cap the whole team's draws on the shared BYO provider key.
    const accountLimit = checkRateLimit(`ai-draft-acct:${accountId}`, RATE_LIMITS.aiDraftAccount)
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }

    // RLS scopes the SSR client to the caller's account, so a missing
    // row means "not yours / not found" either way.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/draft] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      // Decrypt failure — surface distinctly from "not configured".
      console.error('[ai/draft] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'AI assistant is not set up. Enable it in Settings → AI Assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId, {
      resolveImage: createWhatsAppImageResolver(supabase, accountId),
    })
    // Nothing to draft from — a brand-new thread with no customer text
    // would otherwise produce a nonsensical reply-to-nothing.
    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: 'No messages to draft from yet.',
          code: 'no_messages',
        },
        { status: 400 },
      )
    }

    // Ground the draft in the account's knowledge base (best-effort —
    // returns [] when there's no KB or retrieval fails).
    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge,
    })

    // Same tool-calling loop the live auto-reply bot uses, scoped down to
    // PREVIEW_SAFE_TOOL_KEYS: a draft is text a human reviews before it
    // becomes a real message, so nothing here may create a deal, tag a
    // contact, or book a visit before anyone decided to send anything.
    const db = supabaseAdmin()
    let tools: ReturnType<typeof createAutoReplyTools>['tools'] | undefined
    let executeTool: ReturnType<typeof createAutoReplyTools>['executeTool'] | undefined
    if (config.agentId) {
      const [{ permissions, instructions: toolInstructions }, skills] = await Promise.all([
        loadAgentToolPermissions(db, accountId, config.agentId),
        loadAgentSkills(db, accountId, config.agentId),
      ])
      const effectivePermissions = restrictToPreviewSafe(applySkillNarrowing(permissions, skills))
      const toolRuntime = createAutoReplyTools({
        db,
        accountId,
        conversationId,
        contactId: conversation.contact_id,
        configOwnerUserId: userId,
        config,
        permissions: effectivePermissions,
        toolInstructions,
      })
      tools = toolRuntime.tools
      executeTool = tools.length > 0 ? toolRuntime.executeTool : undefined
    }

    const { text, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
      tools,
      executeTool,
    })

    // Record spend on the account's BYO key. Best-effort + via the
    // service role (the log has no `authenticated` INSERT policy). This
    // must not fail or delay the draft the agent is waiting on, so:
    //  - the whole thing is wrapped (constructing the admin client throws
    //    if the service-role key is unset — that must not 500 the draft);
    //  - it's fire-and-forget (`void`), not awaited, so the response
    //    isn't held for a DB round-trip.
    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/draft] usage log skipped:', logErr)
    }

    return NextResponse.json({ draft: text })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
