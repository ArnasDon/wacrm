import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateTemplateFill } from '@/lib/ai/template-fill'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'

/**
 * POST /api/ai/template-fill  (agent+)
 *
 * Body: { conversation_id, template_id }
 * Returns: { values: Record<string, string> } — one key per body
 * variable number ("1", "2", ...) in the template, for the agent to
 * review/edit before sending. "Gerar com IA" in TemplatePicker.
 *
 * Only `conversation_id` + `template_id` come from the client — the
 * template's own body/variables/sample values and the lead's name are
 * always re-derived here from those ids (both RLS-scoped to the
 * caller's account), never trusted from the request body. Mirrors
 * /api/ai/draft's shape (auth, rate limit, config, usage logging).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-template-fill:${userId}`, RATE_LIMITS.aiTemplateFill)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-template-fill-acct:${accountId}`,
      RATE_LIMITS.aiTemplateFillAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    const templateId = body && typeof body.template_id === 'string' ? body.template_id : ''
    if (!conversationId || !templateId) {
      return NextResponse.json(
        { error: 'conversation_id and template_id are required' },
        { status: 400 },
      )
    }

    // RLS scopes both lookups to the caller's account — a missing row
    // means "not yours / not found" either way, same as /api/ai/draft.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/template-fill] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { data: template, error: tplErr } = await supabase
      .from('message_templates')
      .select('id, name, body_text, sample_values, status')
      .eq('id', templateId)
      .maybeSingle()
    if (tplErr) {
      console.error('[ai/template-fill] template lookup error:', tplErr)
      return NextResponse.json({ error: 'Failed to load template' }, { status: 500 })
    }
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    if (template.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Template is not approved' }, { status: 400 })
    }

    // Derived from the template row itself, never from the request —
    // the frontend's own variable list is only ever a UI hint.
    const variableIndices = extractVariableIndices(template.body_text)
    if (variableIndices.length === 0) {
      return NextResponse.json(
        { error: 'This template has no variables to fill' },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[ai/template-fill] loadAiConfig error:', err)
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

    const [{ data: contact }, messages] = await Promise.all([
      conversation.contact_id
        ? supabase.from('contacts').select('name').eq('id', conversation.contact_id).maybeSingle()
        : Promise.resolve({ data: null as { name?: string } | null }),
      buildConversationContext(supabase, conversationId),
    ])

    // Reuses the template's own Meta-submission sample values (entered
    // once, when the template was created) as the "what does {{N}} mean"
    // hint — no new metadata system.
    const sampleBody = (template.sample_values as { body?: string[] } | null)?.body ?? []
    const variables = variableIndices.map((index) => ({
      index,
      sampleValue: sampleBody[index - 1]?.trim() || null,
    }))

    const { result, usage } = await generateTemplateFill({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      expectedIndices: variableIndices,
      contactName: contact?.name || null,
      templateName: template.name,
      bodyText: template.body_text,
      variables,
      messages,
    })

    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'template_fill',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/template-fill] usage log skipped:', logErr)
    }

    if (!result) {
      return NextResponse.json(
        { error: 'AI did not return valid data. Try again.', code: 'invalid_ai_response' },
        { status: 502 },
      )
    }

    return NextResponse.json({ values: result })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
