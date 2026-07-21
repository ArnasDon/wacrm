import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { loadAutomationResources } from '@/lib/automations/resources'
import { generateAutomationFromPrompt } from '@/lib/ai/automation-generate'
import { validateStepsForActivation, validateTriggerForActivation } from '@/lib/automations/validate'
import { AiError } from '@/lib/ai/types'

const MAX_MESSAGE_LENGTH = 2000

/**
 * POST /api/automations/generate (agent+)
 *
 * One copilot turn: appends `message` to `history`, asks the model for
 * either a clarifying question or a draft automation. Never persists
 * anything — the client hands a returned draft to the existing
 * POST /api/automations with is_active:false, then opens the normal
 * builder for human review before activation.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-copilot:${userId}`, RATE_LIMITS.aiCopilot)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `message is too long (max ${MAX_MESSAGE_LENGTH} characters)` }, { status: 400 })
    }
    const history = Array.isArray(body?.history)
      ? body.history.filter(
          (h: unknown): h is { role: 'user' | 'assistant'; text: string } =>
            !!h &&
            typeof h === 'object' &&
            ((h as { role?: unknown }).role === 'user' || (h as { role?: unknown }).role === 'assistant') &&
            typeof (h as { text?: unknown }).text === 'string',
        )
      : []

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[automations/generate] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', { code: 'key_decrypt_failed', status: 400 })
    })
    if (!config) {
      return NextResponse.json(
        { error: 'No AI agent configured yet. Add your provider key under Settings → AI agent.', code: 'ai_not_configured' },
        { status: 400 },
      )
    }

    const resources = await loadAutomationResources(supabase, accountId)
    const turn = await generateAutomationFromPrompt({
      config,
      history: [...history, { role: 'user' as const, text: message }],
      resources,
    })

    if (turn.kind === 'question') {
      return NextResponse.json({ kind: 'question', text: turn.text })
    }

    const issues = [
      ...validateTriggerForActivation(turn.automation.trigger_type, turn.automation.trigger_config),
      ...validateStepsForActivation(turn.automation.steps),
    ]
    return NextResponse.json({ kind: 'draft', automation: turn.automation, issues })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
