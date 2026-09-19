import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { hasCreditsForOne, chargeBillableMessage } from '@/lib/billing/charge';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { Contact, MessageTemplate } from '@/types';

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (!v) return '';
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    return customValues?.get(v.value) ?? '';
  });
}

/**
 * Process a single pending recipient for a given broadcast.
 * Stamps recipient row with 'sent' or 'failed' and returns result.
 * Guaranteed never to throw unhandled exceptions.
 */
export async function processSingleRecipient(
  db: SupabaseClient,
  broadcast: any,
): Promise<{ noMorePending: boolean; success: boolean }> {
  try {
    // 1. Fetch 1 pending recipient for this broadcast
    const { data: recipients, error: rErr } = await db
      .from('broadcast_recipients')
      .select('*, contact:contacts(*)')
      .eq('broadcast_id', broadcast.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (rErr || !recipients || recipients.length === 0) {
      return { noMorePending: true, success: false };
    }

    const recipient = recipients[0];

    // Safely resolve contact object (handling PostgREST object or array joins)
    let contact: Contact | null = null;
    if (recipient.contact) {
      contact = (
        Array.isArray(recipient.contact)
          ? recipient.contact[0]
          : recipient.contact
      ) as Contact | null;
    }

    if ((!contact || !contact.phone) && recipient.contact_id) {
      const { data: fetchedContact } = await db
        .from('contacts')
        .select('*')
        .eq('id', recipient.contact_id)
        .maybeSingle();
      contact = fetchedContact as Contact | null;
    }

    if (!contact || !contact.phone) {
      console.warn(
        `[broadcast-processor] Recipient ${recipient.id} missing contact or phone number`,
      );
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: 'No contact or phone number found',
        })
        .eq('id', recipient.id);

      return { noMorePending: false, success: false };
    }

    // 2. Fetch WhatsApp config for account
    const { data: config, error: configErr } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', broadcast.account_id)
      .single();

    if (configErr || !config || !config.access_token) {
      console.error(
        `[broadcast-processor] Missing WhatsApp config for account ${broadcast.account_id}:`,
        configErr,
      );
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: 'WhatsApp integration not configured for account',
        })
        .eq('id', recipient.id);

      return { noMorePending: false, success: false };
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch (err) {
      console.error(
        `[broadcast-processor] Token decryption failed for account ${broadcast.account_id}:`,
        err,
      );
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: 'Failed to decrypt WhatsApp access token',
        })
        .eq('id', recipient.id);

      return { noMorePending: false, success: false };
    }

    // 3. Fetch template row if template_name is specified
    let templateRow: MessageTemplate | null = null;
    if (broadcast.template_name) {
      let query = db
        .from('message_templates')
        .select('*')
        .eq('account_id', broadcast.account_id)
        .eq('name', broadcast.template_name);

      if (broadcast.template_language) {
        query = query.eq('language', broadcast.template_language);
      }

      const { data: rawTemplateRow } = await query.maybeSingle();

      if (rawTemplateRow && isMessageTemplate(rawTemplateRow)) {
        templateRow = rawTemplateRow as MessageTemplate;
      } else {
        // Fallback lookup without language filter if exact language match failed
        const { data: fallbackRow } = await db
          .from('message_templates')
          .select('*')
          .eq('account_id', broadcast.account_id)
          .eq('name', broadcast.template_name)
          .maybeSingle();

        if (fallbackRow && isMessageTemplate(fallbackRow)) {
          templateRow = fallbackRow as MessageTemplate;
        }
      }
    }

    // 4. Fetch custom values for contact if variables reference custom fields
    let customValuesMap: Map<string, string> | undefined;
    const variables = broadcast.template_variables as Record<
      string,
      VariableMapping
    > | null;

    if (variables) {
      const hasCustomFieldVar = Object.values(variables).some(
        (v) => v && v.type === 'custom_field',
      );

      if (hasCustomFieldVar) {
        const { data: cValues } = await db
          .from('contact_custom_values')
          .select('custom_field_id, value')
          .eq('contact_id', contact.id);

        customValuesMap = new Map<string, string>();
        for (const row of cValues ?? []) {
          customValuesMap.set(row.custom_field_id, row.value ?? '');
        }
      }
    }

    // 5. Resolve template variables
    const params = variables
      ? resolveVariables(variables, contact, customValuesMap)
      : [];

    // 6. Check for header media URL in audience_filter
    const audienceFilter = broadcast.audience_filter as {
      headerMediaUrl?: string;
    } | null;
    const headerMediaUrl = audienceFilter?.headerMediaUrl?.trim();
    const headerType = templateRow?.header_type;
    const isMediaHeader =
      headerType === 'image' ||
      headerType === 'video' ||
      headerType === 'document';
    const messageParams =
      isMediaHeader && headerMediaUrl ? { headerMediaUrl } : undefined;

    // 7. Pre-check prepaid credit balance before sending template broadcast
    const hasCredits = await hasCreditsForOne(broadcast.account_id);
    if (!hasCredits) {
      console.warn(
        `[broadcast-processor] Insufficient prepaid credits for account ${broadcast.account_id}, pausing broadcast send.`
      );
      return { noMorePending: true, success: false };
    }

    // 8. Sanitize phone & build variants
    const sanitized = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitized)) {
      console.warn(
        `[broadcast-processor] Invalid E.164 phone number: ${contact.phone}`,
      );
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: 'Invalid E.164 phone number format',
        })
        .eq('id', recipient.id);

      return { noMorePending: false, success: false };
    }

    const variants = phoneVariants(sanitized);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    for (const variant of variants) {
      try {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: variant,
          templateName: broadcast.template_name,
          language: broadcast.template_language || 'en_US',
          template: templateRow ?? undefined,
          messageParams,
          params,
        });
        sentMessageId = result.messageId;
        lastError = null;
        break;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error';
        lastError = errorMessage;
        if (!isRecipientNotAllowedError(errorMessage)) break;
      }
    }

    // 9. Stamp recipient row & debit credit wallet
    if (sentMessageId) {
      console.log(
        `[broadcast-processor] Sent broadcast message to ${contact.phone} (wamid: ${sentMessageId})`,
      );
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.id);

      void chargeBillableMessage(broadcast.account_id, 'broadcast', broadcast.id);
    } else {
      console.error(
        `[broadcast-processor] Failed to send broadcast to ${contact.phone}:`,
        lastError,
      );
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Failed to send message',
        })
        .eq('id', recipient.id);
    }

    return { noMorePending: false, success: Boolean(sentMessageId) };
  } catch (uncaughtErr) {
    const errorMsg =
      uncaughtErr instanceof Error ? uncaughtErr.message : 'Uncaught error';
    console.error(`[broadcast-processor] Uncaught exception in processSingleRecipient:`, uncaughtErr);
    return { noMorePending: false, success: false };
  }
}

/**
 * Drain all pending recipients for a single broadcast on the server side.
 * Sends recipients sequentially with a 200ms pause between sends.
 * Guaranteed to process all pending items without halting on individual recipient failures.
 */
export async function drainBroadcastQueue(
  db: SupabaseClient,
  broadcastId: string,
  delayMs = 200,
  maxBatchSize = 100,
): Promise<void> {
  console.log(`[broadcast-drain] Starting background drain for broadcast ${broadcastId}`);
  let processedInThisRun = 0;

  while (processedInThisRun < maxBatchSize) {
    // 1. Fetch current broadcast status
    const { data: broadcast } = await db
      .from('broadcasts')
      .select('*')
      .eq('id', broadcastId)
      .single();

    if (!broadcast) {
      console.log(`[broadcast-drain] Broadcast ${broadcastId} not found, stopping drain.`);
      break;
    }

    // Ensure broadcast status is 'sending' if pending recipients exist
    if (broadcast.status !== 'sending') {
      const { count: pendingCount } = await db
        .from('broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');

      if (pendingCount && pendingCount > 0) {
        console.log(`[broadcast-drain] Re-activating broadcast ${broadcastId} to 'sending' to drain ${pendingCount} pending recipients.`);
        await db
          .from('broadcasts')
          .update({ status: 'sending', updated_at: new Date().toISOString() })
          .eq('id', broadcastId);
      } else {
        await checkAndFinalizeIfDone(db, broadcastId);
        break;
      }
    }

    // 2. Process 1 pending recipient with try-catch safety
    let result: { noMorePending: boolean; success: boolean };
    try {
      result = await processSingleRecipient(db, broadcast);
    } catch (err) {
      console.error(`[broadcast-drain] Error processing recipient for ${broadcastId}:`, err);
      result = { noMorePending: false, success: false };
    }

    if (result.noMorePending) {
      console.log(
        `[broadcast-drain] No more pending recipients for broadcast ${broadcastId}.`,
      );
      await checkAndFinalizeIfDone(db, broadcastId);
      break;
    }

    processedInThisRun++;

    // 3. Check remaining pending count
    const { count: remainingPending } = await db
      .from('broadcast_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending');

    if (!remainingPending || remainingPending === 0) {
      await checkAndFinalizeIfDone(db, broadcastId);
      break;
    }

    // 4. Short 200ms pause between sends (smooth rate control)
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  await checkAndFinalizeIfDone(db, broadcastId);
}

// Number of messages sent per cron invocation. Cloudflare cron fires once per
// minute, so this equals the messages-per-minute delivery rate.
const MESSAGES_PER_RUN = 10;

// Pause between the sequential sends within a single run, so the messages go
// out one after another rather than back-to-back in the same instant.
// Budget: INTER_MESSAGE_DELAY_MS x (MESSAGES_PER_RUN - 1) must stay well under
// the route's maxDuration (60s), leaving room for the sends themselves.
const INTER_MESSAGE_DELAY_MS = 1000;

/**
 * Sends MESSAGES_PER_RUN (10) queued recipients sequentially per invocation.
 * The cron Worker invokes this endpoint once per minute, so the delivery rate
 * is 10 messages per minute, which keeps the work within a single request's
 * lifetime and keeps pacing predictable.
 */
export async function processBroadcastQueue(
  db: SupabaseClient,
): Promise<{ processed: number; completed: number }> {
  let processedCount = 0;
  const completedCount = 0;

  for (let i = 0; i < MESSAGES_PER_RUN; i++) {
    // Re-select the oldest queued recipient globally each iteration so that
    // (a) simultaneous broadcasts do not multiply the configured rate, and
    // (b) a later send can come from a different broadcast if the previous
    //     broadcast just ran out of pending recipients.
    const { data: pendingRecipients } = await db
      .from('broadcast_recipients')
      .select('broadcast_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (!pendingRecipients || pendingRecipients.length === 0) {
      break; // Nothing left to send this run.
    }

    const broadcastId = pendingRecipients[0].broadcast_id;
    await drainBroadcastQueue(db, broadcastId, 0, 1).catch((err) =>
      console.error(
        `[broadcast-cron] Error processing broadcast ${broadcastId}:`,
        err,
      ),
    );
    processedCount++;

    // Pause before the next send (skip after the last one).
    if (i < MESSAGES_PER_RUN - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, INTER_MESSAGE_DELAY_MS),
      );
    }
  }

  return { processed: processedCount, completed: completedCount };
}

export async function cancelBroadcastPendingQueue(
  db: SupabaseClient,
  broadcastId: string,
): Promise<void> {
  await db
    .from('broadcast_recipients')
    .update({
      status: 'failed',
      error_message: 'Cancelled by user',
    })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  await checkAndFinalizeIfDone(db, broadcastId);
}

export async function checkAndFinalizeIfDone(
  db: SupabaseClient,
  broadcastId: string,
): Promise<void> {
  const { count: pendingCount } = await db
    .from('broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  if (pendingCount === 0 || pendingCount === null) {
    const { data: b } = await db
      .from('broadcasts')
      .select(
        'sent_count, delivered_count, read_count, replied_count, total_recipients',
      )
      .eq('id', broadcastId)
      .single();

    if (!b) return;

    const totalSuccess =
      (b.sent_count || 0) +
      (b.delivered_count || 0) +
      (b.read_count || 0) +
      (b.replied_count || 0);

    const finalStatus = totalSuccess > 0 ? 'sent' : 'failed';

    await db
      .from('broadcasts')
      .update({
        status: finalStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', broadcastId);
  }
}
