import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateFollowupFreeMessage, selectFollowupTemplate } from '@/lib/ai/followup-message'
import { logAiUsage } from '@/lib/ai/usage'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

interface FollowupPayload {
  reason?: string | null
  approach_summary?: string | null
  [key: string]: unknown
}

/**
 * POST /api/ai/suggestions/[id]/followup/generate  (agent+)
 *
 * Drafts (or regenerates — same endpoint, "Regenerar" just calls it
 * again) the follow-up message for one of the two send modes. Never
 * sends anything — this only produces text/a template selection for
 * the user to review; persisted into the suggestion's `payload.draft`
 * so it survives a page reload before the user acts on it.
 *
 * `mode: 'template'` can come back with `selection: null` when no
 * approved template fits (or none exist) — the client falls back to
 * offering "Copiar para WhatsApp" only, per the block's spec.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`followup-generate:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const mode = body?.mode
    if (mode !== 'free' && mode !== 'template') {
      return bad('mode must be "free" or "template"')
    }

    const { data: suggestion, error: fetchError } = await supabase
      .from('ai_suggestions')
      .select('id, category, contact_id, conversation_id, payload, contact:contacts(name)')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchError) return bad('Failed to load suggestion', 500)
    if (!suggestion) return bad('Not found', 404)
    if (suggestion.category !== 'followup') return bad('Suggestion is not a follow-up')
    if (!suggestion.conversation_id) return bad('Suggestion has no conversation to draft for')

    const config = await loadAiConfig(supabase, accountId)
    if (!config) {
      return bad('AI is not configured/active for this account yet — set it up in Settings > Agentes de IA', 409)
    }

    const payload = (suggestion.payload ?? {}) as FollowupPayload
    const contactName =
      (suggestion.contact as { name?: string } | null)?.name || 'Lead'

    if (mode === 'free') {
      const { text, usage } = await generateFollowupFreeMessage({
        db: supabase,
        config,
        conversationId: suggestion.conversation_id,
        contactName,
        reason: payload.reason ?? null,
        approachSummary: payload.approach_summary ?? null,
      })
      void logAiUsage(supabase, {
        accountId,
        conversationId: suggestion.conversation_id,
        mode: 'followup',
        provider: config.provider,
        model: config.model,
        usage,
      })

      const draft = { mode: 'free' as const, text }
      await supabase
        .from('ai_suggestions')
        .update({ payload: { ...payload, draft } })
        .eq('id', id)

      return NextResponse.json({ draft })
    }

    const { selection, usage } = await selectFollowupTemplate(supabase, accountId, config, {
      contactName,
      reason: payload.reason ?? null,
      approachSummary: payload.approach_summary ?? null,
    })
    void logAiUsage(supabase, {
      accountId,
      conversationId: suggestion.conversation_id,
      mode: 'followup',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (!selection) {
      return NextResponse.json({ draft: null })
    }

    const draft = {
      mode: 'template' as const,
      template_id: selection.template.id,
      template_name: selection.template.name,
      body_text: selection.template.body_text,
      values: selection.values,
    }
    await supabase
      .from('ai_suggestions')
      .update({ payload: { ...payload, draft } })
      .eq('id', id)

    return NextResponse.json({ draft })
  } catch (err) {
    return toErrorResponse(err)
  }
}
