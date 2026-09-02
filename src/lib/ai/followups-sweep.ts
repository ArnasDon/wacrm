// ============================================================
// Follow-up sweep — the DB side of automated nudges. Called once per
// tick by /api/ai/followups/cron.
//
// For every account with follow-ups enabled, walk its open WhatsApp
// conversations that are still "in the AI's hands" (open, unassigned,
// not handed off, auto-reply not disabled), and for each one where the
// customer went quiet on us, send the next due step (`nextDueFollowup`)
// and log the attempt.
//
// Deliberately conservative about WHICH conversations qualify — a
// wrongly-sent nudge is worse than a missed one:
//   - the last message must be ours (we're waiting on the customer),
//   - there must be a real inbound to anchor the delay to,
//   - no `schedule_appointment` on record for the contact (demo booked),
//   - no active Flow run for the contact (the flow owns the thread).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import type { SendMessageParams } from '@/lib/messaging/types';
import {
  parseFollowupSteps,
  nextDueFollowup,
  renderFollowupText,
  type FollowupStep,
} from './followups';

const MAX_ACCOUNTS = 200;
const MAX_CONVERSATIONS_PER_ACCOUNT = 300;
/** Hard cap on provider sends in one tick, so a backlog drains over a
 *  few ticks instead of hammering Meta / the account's number. */
const MAX_SENDS_PER_RUN = 150;

export interface FollowupSweepResult {
  accounts: number;
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}

interface AccountCfg {
  account_id: string;
  followups: unknown;
  followups_business_hours_only: boolean;
  followups_window_start_hour: number;
  followups_window_end_hour: number;
  accounts: { timezone: string } | { timezone: string }[] | null;
}

export async function runFollowupSweep(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<FollowupSweepResult> {
  const res: FollowupSweepResult = {
    accounts: 0,
    scanned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  const { data: configs, error } = await admin
    .from('ai_configs')
    .select(
      'account_id, followups, followups_business_hours_only, followups_window_start_hour, followups_window_end_hour, accounts(timezone)',
    )
    .eq('followups_enabled', true)
    .limit(MAX_ACCOUNTS);

  if (error) throw new Error(`followups: config scan failed: ${error.message}`);
  if (!configs?.length) return res;

  let sendsLeft = MAX_SENDS_PER_RUN;

  for (const cfg of configs as AccountCfg[]) {
    if (sendsLeft <= 0) break;

    const parsed = parseFollowupSteps(cfg.followups);
    if (!parsed.ok || parsed.steps.length === 0) continue;
    const steps = parsed.steps;

    const tzField = Array.isArray(cfg.accounts) ? cfg.accounts[0] : cfg.accounts;
    const timeZone = tzField?.timezone || 'America/Guatemala';
    res.accounts++;

    const { data: convos, error: cErr } = await admin
      .from('conversations')
      .select('id, contact_id')
      .eq('account_id', cfg.account_id)
      .eq('status', 'open')
      .eq('channel', 'whatsapp')
      .is('assigned_agent_id', null)
      .is('ai_handoff_at', null)
      .or('ai_autoreply_disabled.is.null,ai_autoreply_disabled.is.false')
      .order('last_message_at', { ascending: true })
      .limit(MAX_CONVERSATIONS_PER_ACCOUNT);

    if (cErr) {
      console.error('[followups] conversation scan failed', cfg.account_id, cErr.message);
      continue;
    }
    if (!convos?.length) continue;

    for (const c of convos) {
      if (sendsLeft <= 0) break;
      res.scanned++;

      let decision: Awaited<ReturnType<typeof evaluateConversation>>;
      try {
        decision = await evaluateConversation(admin, {
          accountId: cfg.account_id,
          conversationId: c.id as string,
          contactId: (c.contact_id as string | null) ?? null,
          steps,
          now,
          timeZone,
          businessHoursOnly: cfg.followups_business_hours_only,
          windowStartHour: cfg.followups_window_start_hour,
          windowEndHour: cfg.followups_window_end_hour,
        });
      } catch (e) {
        console.error(
          '[followups] evaluate threw',
          c.id,
          e instanceof Error ? e.message : e,
        );
        res.skipped++;
        continue;
      }

      if (!decision) {
        res.skipped++;
        continue;
      }

      const { step, stepIndex, lastCustomerAt, contactName } = decision;
      sendsLeft--;

      let messageId: string | null = null;
      let errText: string | null = null;
      try {
        const params: SendMessageParams =
          step.type === 'template'
            ? {
                conversationId: c.id as string,
                messageType: 'template',
                templateName: step.template_name,
                templateLanguage: step.template_language || null,
                senderType: 'bot',
              }
            : {
                conversationId: c.id as string,
                messageType: 'text',
                contentText: renderFollowupText(step.text, { contactName }),
                senderType: 'bot',
              };
        const sent = await sendMessageToConversation(admin, cfg.account_id, params);
        messageId = sent.messageId;
        res.sent++;
      } catch (e) {
        errText =
          e instanceof SendMessageError
            ? `${e.code}: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        res.failed++;
        console.error('[followups] send failed', c.id, errText);
      }

      // Record the attempt (success OR failure) so this step is consumed
      // and the sweep advances — a permanently-bad template must not be
      // retried every tick.
      const { error: logErr } = await admin.from('ai_followup_log').insert({
        account_id: cfg.account_id,
        conversation_id: c.id,
        contact_id: c.contact_id,
        step_index: stepIndex,
        step_type: step.type,
        message_id: messageId,
        error: errText,
        since_customer_at: lastCustomerAt.toISOString(),
      });
      if (logErr && logErr.code !== '23505') {
        // 23505 = another overlapping sweep already logged this step.
        console.error('[followups] log insert failed', c.id, logErr.message);
      }
    }
  }

  return res;
}

interface EvalArgs {
  accountId: string;
  conversationId: string;
  contactId: string | null;
  steps: FollowupStep[];
  now: Date;
  timeZone: string;
  businessHoursOnly: boolean;
  windowStartHour: number;
  windowEndHour: number;
}

async function evaluateConversation(
  admin: SupabaseClient,
  args: EvalArgs,
): Promise<
  | {
      step: FollowupStep;
      stepIndex: number;
      lastCustomerAt: Date;
      contactName: string | null;
    }
  | null
> {
  // Last message in the thread — if it's the customer's, we're not the
  // ones waiting; a flow / auto-reply / human should answer, not a nudge.
  const { data: lastRows } = await admin
    .from('messages')
    .select('sender_type, created_at')
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .limit(1);
  const last = lastRows?.[0];
  if (!last || last.sender_type === 'customer') return null;

  // The inbound the delay is measured from.
  const { data: lcRows } = await admin
    .from('messages')
    .select('created_at')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1);
  const lcRow = lcRows?.[0];
  if (!lcRow) return null;
  const lastCustomerAt = new Date(lcRow.created_at as string);

  if (args.contactId) {
    // Demo / appointment already booked for this contact → stop nudging.
    const { data: appt } = await admin
      .from('ai_action_log')
      .select('id')
      .eq('account_id', args.accountId)
      .eq('action', 'schedule_appointment')
      .eq('target_id', args.contactId)
      .limit(1);
    if (appt?.length) return null;

    // A live Flow run owns the conversation — let it drive.
    const { data: fr } = await admin
      .from('flow_runs')
      .select('id')
      .eq('account_id', args.accountId)
      .eq('contact_id', args.contactId)
      .eq('status', 'active')
      .limit(1);
    if (fr?.length) return null;
  }

  // Attempts already made in this silence streak (after the cutoff).
  const { data: priorRows } = await admin
    .from('ai_followup_log')
    .select('step_index, sent_at')
    .eq('conversation_id', args.conversationId)
    .gt('sent_at', lastCustomerAt.toISOString())
    .order('sent_at', { ascending: true });
  const priorLog = (priorRows ?? []).map((r) => ({
    stepIndex: r.step_index as number,
    sentAt: new Date(r.sent_at as string),
  }));

  const due = nextDueFollowup({
    steps: args.steps,
    lastCustomerAt,
    priorLog,
    now: args.now,
    businessHoursOnly: args.businessHoursOnly,
    windowStartHour: args.windowStartHour,
    windowEndHour: args.windowEndHour,
    timeZone: args.timeZone,
  });
  if (!due) return null;

  let contactName: string | null = null;
  if (args.contactId) {
    const { data: ct } = await admin
      .from('contacts')
      .select('name')
      .eq('id', args.contactId)
      .maybeSingle();
    contactName = (ct?.name as string | null) ?? null;
  }

  return { step: due.step, stepIndex: due.stepIndex, lastCustomerAt, contactName };
}
