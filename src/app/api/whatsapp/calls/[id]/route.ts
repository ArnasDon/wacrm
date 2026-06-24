import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { manageCall, type CallAction } from '@/lib/whatsapp/meta-api'

/**
 * Call-control endpoint for an inbound WhatsApp call (Phase 2).
 *
 * POST /api/whatsapp/calls/{id}
 *   body: { action: 'pre_accept'|'accept'|'reject'|'terminate', sdp?: string }
 *
 * `{id}` is our internal `call_logs.id` (UUID) — never Meta's call id —
 * so account scoping rides on RLS like everywhere else. The route
 * resolves the row, relays the action to Meta (using the stored
 * meta_call_id + the account's decrypted token), then advances the
 * row's status/timing. The agent's SDP answer (for pre_accept/accept)
 * is produced by the browser softphone and passed through verbatim.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_ACTIONS: ReadonlySet<CallAction> = new Set([
  'pre_accept',
  'accept',
  'reject',
  'terminate',
])

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // Answering / declining / hanging up is operational — agent+.
    const ctx = await requireRole('agent')

    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid call id.' }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      sdp?: string
    }
    const action = body.action as CallAction
    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `Invalid action. Expected one of ${[...VALID_ACTIONS].join(', ')}.` },
        { status: 400 },
      )
    }
    if ((action === 'pre_accept' || action === 'accept') && !body.sdp) {
      return NextResponse.json(
        { error: `Action '${action}' requires an SDP answer.` },
        { status: 400 },
      )
    }

    // Resolve the call row (RLS already scopes to the caller's account;
    // the explicit account_id eq mirrors the rest of the codebase).
    const { data: call, error: callErr } = await ctx.supabase
      .from('call_logs')
      .select('id, meta_call_id, status, answered_at, started_at')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (callErr) {
      console.error('[calls] fetch error:', callErr.message)
      return NextResponse.json({ error: 'Could not load call.' }, { status: 500 })
    }
    if (!call) {
      return NextResponse.json({ error: 'Call not found.' }, { status: 404 })
    }
    if (!call.meta_call_id) {
      return NextResponse.json(
        { error: 'Call has no Meta call id yet — cannot control it.' },
        { status: 409 },
      )
    }

    // Account's WhatsApp credentials.
    const { data: config, error: configErr } = await ctx.supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (configErr || !config) {
      return NextResponse.json(
        { error: 'WhatsApp is not configured for this account.' },
        { status: 409 },
      )
    }

    // Relay to Meta. A Meta-side failure surfaces its real message.
    await manageCall({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      callId: call.meta_call_id,
      action,
      sdp: body.sdp,
    })

    // Advance our row to match the action taken.
    const nowIso = new Date().toISOString()
    const patch: Record<string, unknown> = {}
    if (action === 'accept') {
      patch.status = 'connected'
      patch.answered_at = call.answered_at ?? nowIso
      patch.answered_by_user_id = ctx.userId
    } else if (action === 'reject') {
      patch.status = 'declined'
      patch.ended_at = nowIso
      patch.end_reason = 'agent_declined'
    } else if (action === 'terminate') {
      const answeredAt = call.answered_at
      patch.status = answeredAt ? 'completed' : 'missed'
      patch.ended_at = nowIso
      patch.end_reason = 'agent_hung_up'
      if (answeredAt) {
        patch.duration_seconds = Math.max(
          0,
          Math.round((Date.parse(nowIso) - Date.parse(answeredAt)) / 1000),
        )
      }
    }
    // pre_accept is early media — no status change (call stays ringing
    // until the agent fully accepts).

    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await ctx.supabase
        .from('call_logs')
        .update(patch)
        .eq('id', id)
        .eq('account_id', ctx.accountId)
      if (updErr) {
        // Meta already actioned the call; log but don't fail the request.
        console.error('[calls] row update failed after Meta action:', updErr.message)
      }
    }

    return NextResponse.json({ ok: true, action })
  } catch (err) {
    return toErrorResponse(err)
  }
}
