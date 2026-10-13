import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { cleanTranscript, runPlaygroundTurn } from '@/lib/ai/playground'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp; see
 * `runPlaygroundTurn` for what it does and doesn't simulate. Markers the
 * model emits are stripped from `reply`, as on the live bot.
 * Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = await checkSharedRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const messages = cleanTranscript(body?.messages)
    if (!messages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }
    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 },
      )
    }

    const { text, handoff } = await runPlaygroundTurn(supabase, accountId, messages)
    return NextResponse.json({ reply: text, handoff })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
