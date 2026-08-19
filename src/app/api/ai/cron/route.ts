import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'

/**
 * Reset a stale AI reply-cap/handoff pause after enough customer
 * inactivity, per-account opt-in (`ai_configs.dormancy_reset_hours`,
 * null = disabled — see migration 044).
 *
 * Without this, `conversations.ai_autoreply_disabled` stays true
 * forever once set (reply cap hit, or the model handed off) — only a
 * human clicking "Resume AI" clears it. A customer who goes quiet and
 * comes back weeks later with something unrelated gets permanent
 * silence until an agent happens to notice. This sweep gives accounts
 * that opt in a fresh bot attempt instead.
 *
 * Never touches a conversation a human explicitly paused via "Take
 * over" (`ai_paused_by_human = true`, set in
 * src/app/api/ai/autoreply/[conversationId]/route.ts) — only the bot's
 * own pauses are eligible, regardless of how long they've sat quiet.
 *
 * Staleness is measured against `conversations.last_message_at`, which
 * is already maintained on every inbound and outbound message (see
 * migration 037 / src/lib/flows/meta-send.ts) — no extra query needed
 * to find "when did this conversation last do anything".
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET`, same idiom as
 * src/app/api/flows/cron/route.ts — one secret for operators to
 * provision, independent URL so one sweep failing doesn't block another.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Constant-time compare — see flows/cron for the same idiom.
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()

  const { data: configs, error } = await admin
    .from('ai_configs')
    .select('account_id, dormancy_reset_hours')
    .not('dormancy_reset_hours', 'is', null)

  if (error) {
    console.error('[ai-cron] config scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!configs?.length) return NextResponse.json({ reset: 0 })

  let reset = 0
  for (const cfg of configs as { account_id: string; dormancy_reset_hours: number }[]) {
    const cutoff = new Date(
      Date.now() - cfg.dormancy_reset_hours * 60 * 60 * 1000,
    ).toISOString()

    // Same fields "Resume AI" clears — a stale bot-caused pause gets
    // exactly the fresh start a human clicking that button would give it.
    const { data: updated, error: updErr } = await admin
      .from('conversations')
      .update({
        ai_autoreply_disabled: false,
        ai_reply_count: 0,
        ai_handoff_summary: null,
        assigned_agent_id: null,
      })
      .eq('account_id', cfg.account_id)
      .eq('ai_autoreply_disabled', true)
      .eq('ai_paused_by_human', false)
      .not('last_message_at', 'is', null)
      .lt('last_message_at', cutoff)
      .select('id')

    if (updErr) {
      console.error(`[ai-cron] reset failed for account ${cfg.account_id}:`, updErr.message)
      continue
    }
    reset += updated?.length ?? 0
  }

  return NextResponse.json({ reset })
}
