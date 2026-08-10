import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { AI_SUGGESTION_STATUSES } from '@/lib/ai-suggestion-status'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import type { AiSuggestionStatus } from '@/types'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

interface PipelineMovePayload {
  deal_id?: unknown
  to_stage_id?: unknown
}

interface LearningPayload {
  info?: unknown
  context_summary?: unknown
  application?: unknown
  [key: string]: unknown
}

/**
 * PATCH /api/ai/suggestions/[id]  (agent+)
 *
 * Moves a suggestion through its status lifecycle (pending →
 * approved/rejected/ignored/done). Open to any agent+ — resolving a
 * suggestion is operational work, not an account setting (mirrors
 * ai_suggestions_update RLS, which allows any member).
 *
 * `snoozed_until` ("Adiar", BLOCO 3/4) rides along on a `status:
 * 'pending'` request — a snoozed suggestion isn't resolved, just
 * hidden from the default pending view until that timestamp (see the
 * list route). Absent = leave unchanged; explicit `null` clears it.
 * Resolving a suggestion to any non-pending status always clears it.
 *
 * A `pipeline_move` suggestion being approved ("Aceitar" in the
 * Central de IA) additionally EXECUTES the move: it updates the
 * deal's stage_id to `payload.to_stage_id` before flipping the
 * suggestion's status, using the same RLS-scoped write path as the
 * Pipeline board's drag-and-drop (deals_update requires agent+, same
 * as this route). If the deal move fails, the suggestion is left
 * untouched — never mark "approved" without having actually moved the
 * lead. `resolved_by`/`resolved_at` (already on the row from BLOCO
 * 1/4) plus the untouched `payload` (from_stage/to_stage/score/
 * justification) are the permanent audit trail — the row is never
 * deleted, so nothing here needs a separate history table.
 *
 * A `learning` suggestion supports `learning_edit` ("Editar", BLOCO
 * 4/4) — corrections merged into `payload` independent of `status` —
 * and being approved writes it into the account's EXISTING knowledge
 * base (`ai_knowledge_documents` + `ingestDocument`, same path as
 * Settings > Agentes de IA's knowledge editor), never a new store.
 * That write requires admin+ (the KB's own INSERT policy), stricter
 * than this route's normal agent+ floor — reject/edit stay agent+.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId, userId, role } = await requireRole('agent')

    const limit = checkRateLimit(`ai-suggestions-patch:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const status = body.status as AiSuggestionStatus
    if (!AI_SUGGESTION_STATUSES.includes(status)) {
      return bad(`status must be one of: ${AI_SUGGESTION_STATUSES.join(', ')}`)
    }

    const snoozeProvided = 'snoozed_until' in body
    let snoozedUntil: string | null = null
    if (snoozeProvided && body.snoozed_until !== null) {
      const parsed = new Date(body.snoozed_until as string)
      if (Number.isNaN(parsed.getTime())) return bad('snoozed_until must be a valid date or null')
      snoozedUntil = parsed.toISOString()
    }
    if (status !== 'pending') snoozedUntil = null // resolving always clears a snooze

    const { data: existing, error: fetchError } = await supabase
      .from('ai_suggestions')
      .select('id, category, title, payload')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchError) {
      console.error('[ai/suggestions PATCH] fetch error:', fetchError)
      return NextResponse.json(
        { error: 'Failed to load AI suggestion' },
        { status: 500 },
      )
    }
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // "Editar" (BLOCO 4/4, learning only): corrections to the proposed
    // knowledge, independent of status — the same call can edit and
    // approve together, or just edit and leave it pending for someone
    // else to approve later. Applied to `existing.payload` before
    // anything below reads it, so an edit+approve in one request uses
    // the corrected text.
    let payload = (existing.payload ?? {}) as LearningPayload
    if (
      existing.category === 'learning' &&
      body.learning_edit &&
      typeof body.learning_edit === 'object'
    ) {
      const edit = body.learning_edit as Record<string, unknown>
      payload = {
        ...payload,
        ...(typeof edit.info === 'string' && edit.info.trim() ? { info: edit.info.trim() } : {}),
        ...(typeof edit.context_summary === 'string'
          ? { context_summary: edit.context_summary.trim() || null }
          : {}),
        ...(typeof edit.application === 'string'
          ? { application: edit.application.trim() || null }
          : {}),
      }
      const { error: editError } = await supabase
        .from('ai_suggestions')
        .update({ payload })
        .eq('id', id)
        .eq('account_id', accountId)
      if (editError) {
        console.error('[ai/suggestions PATCH] learning edit error:', editError)
        return bad('Failed to save the edit', 500)
      }
    }

    if (status === 'approved' && existing.category === 'learning') {
      // The knowledge base (ai_knowledge_documents) is admin-managed —
      // its own INSERT policy requires admin+ (migration 030) — so
      // approving a learning needs the same bar, even though this
      // route otherwise only requires agent+.
      if (!hasMinRole(role, 'admin')) {
        return bad('Approving a learning requires an account admin', 403)
      }
      const info = typeof payload.info === 'string' && payload.info.trim() ? payload.info.trim() : existing.title
      const contextSummary = typeof payload.context_summary === 'string' ? payload.context_summary : null
      const application = typeof payload.application === 'string' ? payload.application : null
      const content = [
        info,
        contextSummary ? `Contexto: ${contextSummary}` : null,
        application ? `Aplicação sugerida: ${application}` : null,
      ]
        .filter(Boolean)
        .join('\n\n')

      const { data: doc, error: docError } = await supabase
        .from('ai_knowledge_documents')
        .insert({ account_id: accountId, created_by: userId, title: info.slice(0, 200), content })
        .select('id')
        .single()
      if (docError || !doc) {
        console.error('[ai/suggestions PATCH] knowledge insert error:', docError)
        return bad('Failed to save the learning to the knowledge base', 500)
      }

      // Best-effort indexing, same tolerance as POST /api/ai/knowledge:
      // the document is already saved and lexically searchable even if
      // embedding fails (e.g. no/expired embeddings key) — approval
      // still succeeds, it just doesn't block on semantic indexing.
      try {
        const { key: embeddingsApiKey } = await loadEmbeddingsKey(supabase, accountId)
        await ingestDocument(supabase, accountId, { embeddingsApiKey }, doc.id, content)
      } catch (err) {
        console.error('[ai/suggestions PATCH] knowledge ingest error:', err)
      }

      payload = { ...payload, knowledge_document_id: doc.id }
      await supabase.from('ai_suggestions').update({ payload }).eq('id', id).eq('account_id', accountId)
    }

    if (status === 'approved' && existing.category === 'pipeline_move') {
      const payload = (existing.payload ?? {}) as PipelineMovePayload
      const dealId = typeof payload.deal_id === 'string' ? payload.deal_id : null
      const toStageId = typeof payload.to_stage_id === 'string' ? payload.to_stage_id : null
      if (!dealId || !toStageId) {
        return bad('Suggestion is missing deal/stage information and cannot be accepted')
      }
      const { data: movedDeal, error: moveError } = await supabase
        .from('deals')
        .update({ stage_id: toStageId })
        .eq('id', dealId)
        .eq('account_id', accountId)
        .select('id')
        .maybeSingle()
      if (moveError) {
        console.error('[ai/suggestions PATCH] deal move error:', moveError)
        return NextResponse.json(
          { error: 'Failed to move the deal to the suggested stage' },
          { status: 500 },
        )
      }
      if (!movedDeal) {
        return bad('The deal behind this suggestion no longer exists')
      }
    }

    const resolved = status !== 'pending'
    const update: Record<string, unknown> = {
      status,
      resolved_by: resolved ? userId : null,
      resolved_at: resolved ? new Date().toISOString() : null,
    }
    if (resolved || snoozeProvided) update.snoozed_until = snoozedUntil

    const { data, error } = await supabase
      .from('ai_suggestions')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*, contact:contacts(id, name, avatar_url)')
      .maybeSingle()

    if (error) {
      console.error('[ai/suggestions PATCH] update error:', error)
      return NextResponse.json(
        { error: 'Failed to update AI suggestion' },
        { status: 500 },
      )
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ suggestion: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/suggestions/[id]  (admin+)
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const { error } = await supabase
      .from('ai_suggestions')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      console.error('[ai/suggestions DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI suggestion' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
