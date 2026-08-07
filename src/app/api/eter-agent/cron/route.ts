import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  getDueScheduledMessages,
  claimScheduledMessage,
  markScheduledMessageSent,
  markScheduledMessageFailed,
  type ScheduledMessage,
  type ScheduledMessageKind,
} from '@/lib/eter/repo/scheduled-messages.repo'
import { findApprovedTemplateByName } from '@/lib/eter/repo/message-templates.repo'
import { isWithinSessionWindow } from '@/lib/eter/session-window'
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send'

/**
 * Drain due `agent_scheduled_messages` rows — the quiet-lead follow-up
 * cadence (followups.ts `scheduleFollowUpCadence`) and meeting
 * reminders (`scheduleMeetingReminders`), which together are what
 * makes the `send_reminder` agent tool actually schedule something
 * instead of returning its "not implemented" stub.
 *
 * Same auth + claim pattern as `/api/automations/cron` and
 * `/api/flows/cron`: a shared secret via `x-cron-secret` matching
 * `AUTOMATION_CRON_SECRET` (reused rather than a new env var — see
 * docs/eter-agent-config.md — so operators provision one cron secret,
 * not three), and a conditional UPDATE-by-id claim (status
 * 'pending' -> 'processing') so overlapping invocations can't double-send.
 *
 * Meta's 24h customer-service window: a scheduled message due for
 * delivery outside that window MUST be an approved template, never
 * free text (see session-window.ts). The template is looked up by
 * naming convention against `message_templates` — `eter_<kind>`, e.g.
 * `eter_follow_up_1d`. If no such APPROVED template exists for the
 * account, the row is marked `failed` with a clear reason rather than
 * silently skipped or sent as free text in violation of Meta policy.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const due = await getDueScheduledMessages(admin, { limit: 50 })
  if (due.length === 0) return NextResponse.json({ sent: 0, failed: 0, skipped: 0 })

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const row of due) {
    const claimed = await claimScheduledMessage(admin, row.id)
    if (!claimed) {
      skipped++
      continue
    }

    try {
      await sendOne(admin, claimed)
      await markScheduledMessageSent(admin, claimed.id)
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markScheduledMessageFailed(admin, claimed.id, message)
      failed++
    }
  }

  return NextResponse.json({ sent, failed, skipped })
}

const TEMPLATE_NAME_BY_KIND: Record<ScheduledMessageKind, string> = {
  follow_up_1d: 'eter_follow_up_1d',
  follow_up_3d: 'eter_follow_up_3d',
  follow_up_7d: 'eter_follow_up_7d',
  reminder_24h: 'eter_reminder_24h',
  reminder_2h: 'eter_reminder_2h',
}

async function sendOne(
  admin: ReturnType<typeof supabaseAdmin>,
  row: ScheduledMessage,
): Promise<void> {
  if (!row.conversationId || !row.contactId) {
    throw new Error('scheduled message has no conversation/contact to send to')
  }

  const { data: wcfg, error: wcfgErr } = await admin
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', row.accountId)
    .maybeSingle()
  if (wcfgErr) throw wcfgErr
  const userId = (wcfg as { user_id: string } | null)?.user_id
  if (!userId) throw new Error('whatsapp_config not found for account')

  const withinWindow = await isWithinSessionWindow(admin, row.conversationId)

  if (withinWindow) {
    const text = row.payload.freeText
    if (!text) throw new Error(`scheduled message ${row.id} has no freeText payload`)
    await engineSendText({
      accountId: row.accountId,
      userId,
      conversationId: row.conversationId,
      contactId: row.contactId,
      text,
    })
    return
  }

  // Outside the 24h window — an approved template is required. Never
  // fall back to free text here, even if one is present in payload.
  const templateName = TEMPLATE_NAME_BY_KIND[row.kind]
  const template = await findApprovedTemplateByName(admin, row.accountId, templateName)
  if (!template) {
    throw new Error(
      `outside the 24h session window and no APPROVED template "${templateName}" configured for this account`,
    )
  }
  await engineSendTemplate({
    accountId: row.accountId,
    userId,
    conversationId: row.conversationId,
    contactId: row.contactId,
    templateName: template.name,
    language: template.language,
  })
}
