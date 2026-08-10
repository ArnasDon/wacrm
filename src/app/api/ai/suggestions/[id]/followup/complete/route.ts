import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/ai/suggestions/[id]/followup/complete  (agent+)
 *
 * "Follow-up realizado" — the manual confirmation for the "Copiar
 * para WhatsApp" mode (the CRM has no visibility into a send made
 * from the agent's personal WhatsApp, so this is the only way that
 * mode ever resolves) and a fallback for "Enviar pelo CRM" in case the
 * automatic resolve-on-send (see /api/whatsapp/send) didn't fire.
 * Idempotent: completing an already-done follow-up is a no-op success,
 * not an error — a double click must not throw.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId, userId } = await requireRole('agent')

    const body = await request.json().catch(() => null)
    const mode = body?.mode
    if (mode !== 'whatsapp' && mode !== 'crm') {
      return bad('mode must be "whatsapp" or "crm"')
    }
    const message = typeof body?.message === 'string' ? body.message : null
    const templateId = typeof body?.template_id === 'string' ? body.template_id : null

    const { data: existing, error: fetchError } = await supabase
      .from('ai_suggestions')
      .select('id, category, status, payload')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchError) return bad('Failed to load suggestion', 500)
    if (!existing) return bad('Not found', 404)
    if (existing.category !== 'followup') return bad('Suggestion is not a follow-up')
    if (existing.status === 'done') {
      return NextResponse.json({ success: true, already_done: true })
    }

    const payload = (existing.payload ?? {}) as Record<string, unknown>
    const { error } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'done',
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
        snoozed_until: null,
        payload: {
          ...payload,
          realized_mode: mode,
          realized_message: message,
          realized_template_id: templateId,
          realized_at: new Date().toISOString(),
        },
      })
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      console.error('[followup complete] update error:', error)
      return bad('Failed to record the follow-up', 500)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
