import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  AI_SUGGESTION_CATEGORIES,
  AI_SUGGESTION_STATUSES,
} from '@/lib/ai-suggestion-status'
import type { AiSuggestionCategory, AiSuggestionStatus } from '@/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/suggestions
 *
 * Lists the account's AI suggestions for the Central de IA. Any
 * member may read — resolving a suggestion is normal day-to-day
 * work, not an admin setting (mirrors ai_suggestions_select RLS).
 *
 * Query params (all optional): status, category, contactId,
 * conversationId, limit (default 200, max 500).
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)

    const status = url.searchParams.get('status')
    if (status && !AI_SUGGESTION_STATUSES.includes(status as AiSuggestionStatus)) {
      return bad(`status must be one of: ${AI_SUGGESTION_STATUSES.join(', ')}`)
    }
    const category = url.searchParams.get('category')
    if (
      category &&
      !AI_SUGGESTION_CATEGORIES.includes(category as AiSuggestionCategory)
    ) {
      return bad(`category must be one of: ${AI_SUGGESTION_CATEGORIES.join(', ')}`)
    }
    const contactId = url.searchParams.get('contactId')
    const conversationId = url.searchParams.get('conversationId')
    const limit = Math.min(
      500,
      Math.max(1, Number(url.searchParams.get('limit')) || 200),
    )

    let query = supabase
      .from('ai_suggestions')
      .select('*, contact:contacts(id, name, avatar_url)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)
    if (category) query = query.eq('category', category)
    if (contactId) query = query.eq('contact_id', contactId)
    if (conversationId) query = query.eq('conversation_id', conversationId)
    // A snoozed ("Adiar", BLOCO 3/4) suggestion is still status='pending'
    // — it isn't resolved, just postponed — so the default pending view
    // must hide it until snoozed_until passes, or "Adiar" would be a
    // no-op. Only applies to the pending view; other status filters
    // (e.g. an explicit history view) still show snoozed rows as-is.
    if (status === 'pending') {
      query = query.or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`)
    }

    const { data, error } = await query
    if (error) {
      console.error('[ai/suggestions GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI suggestions' },
        { status: 500 },
      )
    }

    return NextResponse.json({ suggestions: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/suggestions  (admin+)
 *
 * Manual/administrative creation. The future suggestion-generation
 * job is expected to run as service_role (bypasses RLS entirely) —
 * this endpoint exists for manual seeding/testing of the Central de
 * IA while no generator exists yet.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-suggestions:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const category = body.category as AiSuggestionCategory
    if (!AI_SUGGESTION_CATEGORIES.includes(category)) {
      return bad(`category must be one of: ${AI_SUGGESTION_CATEGORIES.join(', ')}`)
    }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return bad('title is required')

    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null
    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null
    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : null
    const payload =
      body.payload && typeof body.payload === 'object' ? body.payload : {}

    const { data, error } = await supabase
      .from('ai_suggestions')
      .insert({
        account_id: accountId,
        created_by: userId,
        category,
        title,
        description,
        contact_id: contactId,
        conversation_id: conversationId,
        payload,
      })
      .select('*, contact:contacts(id, name, avatar_url)')
      .single()

    if (error) {
      console.error('[ai/suggestions POST] insert error:', error)
      return NextResponse.json(
        { error: 'Failed to create AI suggestion' },
        { status: 500 },
      )
    }

    return NextResponse.json({ suggestion: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
