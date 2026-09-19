import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { readJson } from '@/lib/http/errors'
import { str } from '@/lib/http/validate'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendText } from '@/lib/whatsapp/store'

/**
 * POST { conversationId, text } — agent reply from the inbox.
 * Role is checked BEFORE anything is sent (the old route sent via
 * Meta first and only failed at the DB insert for viewers).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)
    const conversationId = parseId(body.conversationId, 'conversationId')
    const text = str(body.text, 'text', { max: 4096 })
    const message = await sendText(ctx, conversationId, text, 'agent', ctx.userId)
    return NextResponse.json({ message })
  } catch (err) {
    return toErrorResponse(err)
  }
}
