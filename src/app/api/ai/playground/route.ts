import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { createAutoReplyTools } from '@/lib/ai/tools'
import { loadAgentToolPermissions, restrictToPreviewSafe } from '@/lib/ai/tool-permissions'
import { applySkillNarrowing, loadAgentSkills } from '@/lib/ai/skills'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * same `auto_reply` system prompt, skills and tool-calling loop the live
 * bot uses, scoped to PREVIEW_SAFE_TOOL_KEYS (read/informational tools
 * only) since there is no real conversation or contact here for a
 * mutating tool (create_deal, add_tag, schedule_visit) to attach to.
 * Reads the config even when the master switch is off (requireActive:
 * false) so you can try it before going live. Stateless: the client sends
 * the running transcript each turn; there is no conversationId/contactId,
 * so per-call telemetry (agent_tool_calls) is skipped for this surface —
 * see the conversationId guard in tools/index.ts's executeTool wrapper.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter((m: unknown): m is ChatMessage => {
        if (!m || typeof m !== 'object') return false
        const candidate = m as ChatMessage
        return (
          (candidate.role === 'user' || candidate.role === 'assistant') &&
          typeof candidate.content === 'string' &&
          candidate.content.trim().length > 0
        )
      })
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json({ error: 'Send a message to test the agent.' }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

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
        conversationId: '',
        contactId: '',
        configOwnerUserId: userId,
        config,
        permissions: effectivePermissions,
        toolInstructions,
      })
      tools = toolRuntime.tools
      executeTool = tools.length > 0 ? toolRuntime.executeTool : undefined
    }

    const { text, handoff } = await generateReply({
      config,
      systemPrompt,
      messages,
      tools,
      executeTool,
    })
    return NextResponse.json({ reply: text, handoff })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
