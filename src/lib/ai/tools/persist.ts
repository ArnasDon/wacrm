import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolCallRecord } from './types'

/**
 * Insert one `messages` row per tool call the model made, so the
 * invocation + its result show up inline in the existing inbox thread
 * — reusing the existing `messages` realtime pipeline rather than a
 * new channel (see `supabase/migrations/040_ai_tools.sql`).
 *
 * Never throws: a failed insert here must not stop the customer-facing
 * reply that follows it. The stored `request.headers` already has any
 * credential redacted (see `executeTool`) — nothing here needs to
 * redact again, but nothing here ever touches `authSecret` either.
 */
export async function persistToolCallMessages(
  db: SupabaseClient,
  conversationId: string,
  toolCalls: ToolCallRecord[],
): Promise<void> {
  if (toolCalls.length === 0) return

  const rows = toolCalls.map((call) => {
    const status = call.result.ok ? 'success' : 'error'
    return {
      conversation_id: conversationId,
      sender_type: 'bot' as const,
      content_type: 'tool_call' as const,
      content_text: `🔧 Called ${call.toolName}${status === 'error' ? ' — failed' : ''}`,
      status: 'sent' as const,
      ai_generated: true,
      tool_call_payload: {
        tool_name: call.toolName,
        status,
        request: call.result.request,
        response: { status: call.result.status, body_excerpt: call.result.body },
        duration_ms: call.result.durationMs,
        error_message: call.result.error,
      },
    }
  })

  const { error } = await db.from('messages').insert(rows)
  if (error) {
    console.error('[ai tools] failed to persist tool-call messages:', error)
  }
}
