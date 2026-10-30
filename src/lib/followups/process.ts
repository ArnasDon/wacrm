import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendPushToAccount } from '@/lib/push/server'

interface ReminderRow {
  out_notification_id: string
  out_account_id: string
  out_user_id: string
  out_conversation_id: string
  out_kind: 'tomorrow' | 'due'
  out_title: string
  out_body: string
}

/**
 * Creates any follow-up reminders that are now due (the DB function makes
 * the in-app notifications, exactly once each) and pushes each one to the
 * owner's phone/browser. Idempotent — call it as often as you like.
 */
export async function runFollowupReminders(): Promise<{ created: number; error?: string }> {
  const tz = process.env.FOLLOWUP_TIMEZONE || 'Asia/Kolkata'
  const hour = Number(process.env.FOLLOWUP_REMIND_HOUR ?? 9)
  const { data, error } = await supabaseAdmin().rpc('process_followup_reminders', {
    p_tz: tz,
    p_min_hour: Number.isFinite(hour) ? hour : 9,
  })
  if (error) {
    console.error('[followups] reminder run failed:', error.message)
    return { created: 0, error: error.message }
  }
  const rows = (data ?? []) as ReminderRow[]
  for (const r of rows) {
    // Push failures must never undo the (already stored) in-app notification.
    await sendPushToAccount(
      r.out_account_id,
      {
        v: 1,
        conversationId: r.out_conversation_id,
        title: r.out_title,
        body: r.out_body,
        url: `/inbox?c=${r.out_conversation_id}`,
        tag: `followup:${r.out_conversation_id}`,
        ts: Date.now(),
      },
      { userId: r.out_user_id },
    ).catch(() => undefined)
  }
  return { created: rows.length }
}
