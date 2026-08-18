import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiToolById } from '@/lib/ai/tools/config'
import { executeTool } from '@/lib/ai/tools/execute'

/**
 * POST /api/ai/tools/[id]/test  (admin+)
 *
 * Fires the tool for real, server-side, with the sample values the
 * admin typed into the "Test tool" panel — the same "test it live"
 * ethos as the agent Playground, but for one tool in isolation rather
 * than a whole conversation. The decrypted credential is used to build
 * the request here and never sent to the browser; the response is the
 * same shape `executeTool` returns, minus nothing extra to redact
 * (request.headers already has the credential masked).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const { supabase, accountId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-toolcall:${accountId}`, RATE_LIMITS.aiToolCall)
    if (!limit.success) return rateLimitResponse(limit)

    const tool = await loadAiToolById(supabase, accountId, id)
    if (!tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const args =
      body && typeof body === 'object' && body.args && typeof body.args === 'object'
        ? (body.args as Record<string, unknown>)
        : {}

    const result = await executeTool(tool, args)
    return NextResponse.json({ result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
