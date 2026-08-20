// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() — send each recipient's template via Meta
//                        (phone-variant retry), stamp each recipient
//                        row + the aggregate counts, finalize status.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { resolveVariables, type VariableMapping } from '@/lib/whatsapp/template-variables';

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
  /** Campaigns planning note — migration 075. Unused by the plain broadcasts route. */
  description?: string | null;
  /**
   * 'sending' (default) keeps the existing public-API broadcasts
   * contract — POST /api/v1/broadcasts creates AND immediately sends.
   * 'ready' is for POST /api/v1/campaigns: materialize the campaign +
   * its recipients WITHOUT sending — section 10 of the Campaigns spec
   * requires that creating a campaign never sends messages by itself;
   * a separate POST /api/v1/campaigns/{id}/send (gated by the same
   * 'broadcasts:send' scope + an explicit `confirm`) does that.
   */
  status?: 'sending' | 'ready';
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  params: string[];
}

export interface BroadcastPlan {
  broadcastId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
}

const MAX_RECIPIENTS = 1000;

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<BroadcastPlan> {
  const { name, templateName, recipients } = params;
  const status = params.status ?? 'sending';
  const templateLanguage = params.templateLanguage || 'en_US';

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  // Config (fail fast + provides the audit trail owner already resolved
  // by the caller). Meta send needs phone_number_id + decrypted token.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }
  const templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(typeof r.to === 'string' ? r.to : '');
    if (!isValidE164(sanitized)) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: sanitized,
    });
    resolved.push({
      contactId: id,
      phone: sanitized,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once and its
  // params aren't silently overwritten by a later duplicate — and so
  // the row↔params pairing below (keyed by contact_id) is unambiguous.
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  if (deduped.length === 0) {
    throw new BroadcastError(
      'bad_request',
      'No recipients had a valid E.164 phone number',
      400
    );
  }

  // Persist the broadcast + its recipients. The count columns
  // (sent/delivered/read/replied/failed) are owned by the DB aggregate
  // trigger (migrations 003/005) and derived purely from
  // broadcast_recipients rows — we deliberately do NOT seed them here
  // (a manual value would be clobbered by the trigger on the first
  // recipient change). `rejected` phones have no recipient row, so they
  // are reported to the caller in the POST response, not in these
  // persisted counts.
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      name: name || `API broadcast (${templateName})`,
      description: params.description || null,
      template_name: templateName,
      template_language: templateLanguage,
      status,
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // upsert + ignoreDuplicates (backed by migration 075's unique index
  // on broadcast_recipients(broadcast_id, contact_id)) rather than a
  // plain insert: a retried request against an existing campaign (see
  // POST /api/v1/campaigns/{id}/recipients) can't double-insert a
  // recipient — it's a DB-level guarantee, not just caller discipline.
  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .upsert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
      })),
      { onConflict: 'broadcast_id,contact_id', ignoreDuplicates: true }
    )
    .select('id, contact_id');
  if (rErr || !recipientRows) {
    console.error('[broadcast-core] create recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // Pair each inserted recipient row back to its phone/params by
  // contact_id — unambiguous now that duplicates are collapsed.
  const byContact = new Map(deduped.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = recipientRows.map((row) => {
    const r = byContact.get(row.contact_id as string)!;
    return { recipientRowId: row.id as string, phone: r.phone, params: r.params };
  });

  return {
    broadcastId: broadcast.id,
    templateName,
    templateLanguage,
    phoneNumberId: config.phone_number_id,
    accessToken,
    templateRow,
    planned,
    rejected,
  };
}

/**
 * Build a {@link BroadcastPlan} for a campaign whose recipients were
 * already materialized (POST /api/v1/campaigns, or the dashboard's
 * "ready" campaigns) — used by POST /api/v1/campaigns/{id}/send. Unlike
 * {@link createBroadcast}, nothing is inserted here: it only reads the
 * `pending` `broadcast_recipients` rows already on the campaign, so
 * calling it twice (a retried send request) plans exactly the rows
 * still pending — already-sent ones are never re-planned, matching the
 * dashboard's `startCampaignSending` idempotency (section 5 of the
 * spec).
 */
export async function buildPlanForExistingCampaign(
  db: SupabaseClient,
  accountId: string,
  campaignId: string
): Promise<BroadcastPlan> {
  const { data: campaign, error: campaignErr } = await db
    .from('broadcasts')
    .select('id, status, send_channel, template_name, template_language, template_variables, header_media_url')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (campaignErr || !campaign) {
    throw new BroadcastError('not_found', 'Campaign not found', 404);
  }
  if (campaign.send_channel === 'external') {
    // Section 4/7 of the spec: WACRM prepares/registers an 'external'
    // campaign but never sends it — only POST .../recipients/{id}/result
    // (reporting a send that already happened outside WACRM) applies.
    throw new BroadcastError(
      'bad_request',
      "This is an external-send campaign — WACRM does not dispatch it. Report results via POST /campaigns/{id}/recipients/{recipientId}/result instead.",
      400
    );
  }
  if (campaign.status === 'sent' || campaign.status === 'cancelled') {
    throw new BroadcastError(
      'bad_request',
      `Campaign is already ${campaign.status} — nothing to send`,
      400
    );
  }

  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);

  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', campaign.template_name)
    .eq('language', campaign.template_language)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before sending.',
      500
    );
  }
  const templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;

  const { data: pending, error: pendingErr } = await db
    .from('broadcast_recipients')
    .select('id, contact:contacts(id, phone, name, email, company)')
    .eq('broadcast_id', campaignId)
    .eq('status', 'pending');
  if (pendingErr) {
    throw new BroadcastError('internal', 'Failed to read campaign recipients', 500);
  }

  const variables = (campaign.template_variables ?? {}) as Record<
    string,
    VariableMapping
  >;
  type PendingContact = {
    id: string;
    phone: string | null;
    name: string | null;
    email: string | null;
    company: string | null;
  };
  const contactIds = (pending ?? [])
    .map((r) => (r.contact as unknown as PendingContact | null)?.id)
    .filter((id): id is string => Boolean(id));
  const customValueIndex = await fetchCustomValueIndexServer(db, contactIds);

  const planned: PlannedRecipient[] = [];
  for (const row of pending ?? []) {
    const contact = row.contact as unknown as PendingContact | null;
    if (!contact?.phone) continue;
    planned.push({
      recipientRowId: row.id as string,
      phone: contact.phone,
      params: resolveVariables(
        variables,
        {
          name: contact.name ?? undefined,
          phone: contact.phone,
          email: contact.email ?? undefined,
          company: contact.company ?? undefined,
        },
        customValueIndex.get(contact.id)
      ),
    });
  }

  return {
    broadcastId: campaignId,
    templateName: campaign.template_name,
    templateLanguage: campaign.template_language,
    phoneNumberId: config.phone_number_id,
    accessToken,
    templateRow,
    planned,
    rejected: 0,
  };
}

/** contactId → (customFieldId → value) — server-side twin of the client hook's index. */
async function fetchCustomValueIndexServer(
  db: SupabaseClient,
  contactIds: string[]
): Promise<Map<string, Map<string, string>>> {
  const index = new Map<string, Map<string, string>>();
  if (contactIds.length === 0) return index;
  const { data } = await db
    .from('contact_custom_values')
    .select('contact_id, custom_field_id, value')
    .in('contact_id', contactIds);
  for (const row of data ?? []) {
    const bucket = index.get(row.contact_id) ?? new Map<string, string>();
    bucket.set(row.custom_field_id, row.value ?? '');
    index.set(row.contact_id, bucket);
  }
  return index;
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's template
 * (phone-variant retry) and stamp its `broadcast_recipients` row.
 * Best-effort per recipient — one failure never aborts the rest.
 * Designed to run inside `after()`.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * below advances them automatically, and later Meta delivery/read
 * webhooks keep advancing them. We therefore never write those columns
 * here — only the terminal `status` — otherwise a manual value would
 * race and clobber the trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  for (const recipient of plan.planned) {
    const variants = phoneVariants(recipient.phone);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    for (const variant of variants) {
      try {
        const result = await sendTemplateMessage({
          phoneNumberId: plan.phoneNumberId,
          accessToken: plan.accessToken,
          to: variant,
          templateName: plan.templateName,
          language: plan.templateLanguage,
          template: plan.templateRow ?? undefined,
          params: recipient.params,
        });
        sentMessageId = result.messageId;
        lastError = null;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        lastError = message;
        // Only a "recipient not allowed" error is worth another variant.
        if (!isRecipientNotAllowedError(message)) break;
      }
    }

    if (sentMessageId) {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.recipientRowId);
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  // Terminal status only — counts are trigger-owned (see the note
  // above). Read the DB's own pending/failed counts rather than just
  // this run's sentCount: buildPlanForExistingCampaign can plan a
  // second, smaller batch of `pending` rows for a campaign that
  // already has earlier successful sends (a resumed campaign send),
  // and this run alone succeeding-or-not isn't the whole picture.
  const { count: stillPending } = await db
    .from('broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('broadcast_id', plan.broadcastId)
    .eq('status', 'pending');
  if ((stillPending ?? 0) === 0) {
    const { data: totals } = await db
      .from('broadcasts')
      .select('total_recipients, failed_count')
      .eq('id', plan.broadcastId)
      .single();
    const finalStatus =
      totals && totals.failed_count >= totals.total_recipients ? 'failed' : 'sent';
    await db
      .from('broadcasts')
      .update({ status: finalStatus, updated_at: new Date().toISOString() })
      .eq('id', plan.broadcastId);
  }
}
