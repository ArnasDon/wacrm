// ============================================================
// Shared campaign logic for the public API (v1) / MCP campaign
// endpoints. A "campaign" IS a `broadcasts` row — see migration 075's
// header comment. This file only adds the account-scoped read/write
// helpers the routes need; the actual send fan-out stays in
// broadcast-core.ts (createBroadcast / buildPlanForExistingCampaign /
// deliverBroadcast) so there is exactly one send engine.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { createBroadcast, BroadcastError } from '@/lib/whatsapp/broadcast-core';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { keysetFilter, buildPage, type Cursor } from '@/lib/api/v1/pagination';

const CAMPAIGN_SELECT =
  'id, name, description, send_channel, template_name, template_language, message_text, header_media_url, status, ' +
  'total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count, ' +
  'created_at, updated_at';

export interface ApiCampaign {
  id: string;
  name: string;
  description: string | null;
  /** 'api' (official WhatsApp API + template) or 'external' (WhatsApp Web, prepared by WACRM but sent manually) — migration 076. */
  send_channel: 'api' | 'external';
  template_name: string | null;
  template_language: string;
  /** Free-text body — only set for send_channel = 'external'. */
  message_text: string | null;
  /** Media header URL (api) or the optional external-message image (migration 076). */
  header_media_url: string | null;
  status: string;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  /** total_recipients minus every terminal-status recipient — the "quantidade pendente" the spec asks for. */
  pending_count: number;
  created_at: string;
  updated_at: string;
}

function serializeCampaign(row: Record<string, unknown>): ApiCampaign {
  const total = row.total_recipients as number;
  const sent = row.sent_count as number;
  const delivered = row.delivered_count as number;
  const read = row.read_count as number;
  const replied = row.replied_count as number;
  const failed = row.failed_count as number;
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    send_channel: (row.send_channel as 'api' | 'external') ?? 'api',
    template_name: (row.template_name as string | null) ?? null,
    template_language: row.template_language as string,
    message_text: (row.message_text as string | null) ?? null,
    header_media_url: (row.header_media_url as string | null) ?? null,
    status: row.status as string,
    total_recipients: total,
    sent_count: sent,
    delivered_count: delivered,
    read_count: read,
    replied_count: replied,
    failed_count: failed,
    // sent/delivered/read/replied are cumulative stages of the same
    // recipient (a delivered message was also sent), so only `sent`
    // and `failed` are mutually-exclusive terminal buckets against
    // `total` for a pending count — delivered/read/replied don't add
    // further to "no longer pending".
    pending_count: Math.max(0, total - sent - failed),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function listCampaigns(
  db: SupabaseClient,
  accountId: string,
  opts: { limit: number; cursor: Cursor | null }
): Promise<{ items: ApiCampaign[]; nextCursor: string | null }> {
  let query = db
    .from('broadcasts')
    .select(CAMPAIGN_SELECT)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit + 1);

  const kf = keysetFilter(opts.cursor);
  if (kf) query = query.or(kf);

  const { data, error } = await query;
  if (error) throw new BroadcastError('internal', 'Failed to list campaigns', 500);

  const { items, nextCursor } = buildPage(
    (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
    opts.limit
  );
  return { items: items.map((r) => serializeCampaign(r as unknown as Record<string, unknown>)), nextCursor };
}

export async function getCampaign(
  db: SupabaseClient,
  accountId: string,
  campaignId: string
): Promise<ApiCampaign | null> {
  const { data, error } = await db
    .from('broadcasts')
    .select(CAMPAIGN_SELECT)
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeCampaign(data as unknown as Record<string, unknown>);
}

export interface CreateCampaignInput {
  name: string;
  description?: string | null;
  /** 'api' (default) — official template. 'external' — free-text message, WhatsApp Web (migration 076). */
  sendChannel?: 'api' | 'external';
  templateName?: string;
  templateLanguage?: string | null;
  /** Required when sendChannel = 'external'. */
  messageText?: string;
  /** Optional image for sendChannel = 'external'. */
  imageUrl?: string;
  /** Optional initial recipients — same shape as POST /api/v1/broadcasts. Additional ones can be added via addCampaignRecipients. */
  recipients?: { to: string; params?: string[] }[];
}

/**
 * Create a campaign in 'ready' (recipients supplied) or 'draft' (none
 * supplied yet — add them later via addCampaignRecipients) status.
 * NEVER sends — section 10 of the spec: campaign creation must not be
 * able to trigger a WhatsApp send by itself. Sending an 'external'
 * campaign isn't even possible from WACRM (spec section 4/7) — only
 * POST /campaigns/{id}/send exists, and it's 'api'-only.
 */
export async function createCampaign(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: CreateCampaignInput
): Promise<ApiCampaign> {
  const sendChannel = input.sendChannel ?? 'api';

  if (sendChannel === 'external') {
    return createExternalCampaign(db, accountId, auditUserId, input);
  }

  if (!input.templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required for the api channel", 400);
  }

  if (!input.recipients || input.recipients.length === 0) {
    // No recipients yet — write a bare draft row directly (createBroadcast
    // requires a non-empty recipient list since it's shared with the
    // send-immediately broadcasts route).
    const { data, error } = await db
      .from('broadcasts')
      .insert({
        account_id: accountId,
        user_id: auditUserId,
        name: input.name,
        description: input.description || null,
        send_channel: 'api',
        template_name: input.templateName,
        template_language: input.templateLanguage || 'en_US',
        status: 'draft',
        total_recipients: 0,
      })
      .select(CAMPAIGN_SELECT)
      .single();
    if (error || !data) {
      throw new BroadcastError('internal', 'Failed to create campaign', 500);
    }
    return serializeCampaign(data as unknown as Record<string, unknown>);
  }

  const plan = await createBroadcast(db, accountId, auditUserId, {
    name: input.name,
    description: input.description,
    templateName: input.templateName,
    templateLanguage: input.templateLanguage,
    recipients: input.recipients,
    status: 'ready',
  });
  const campaign = await getCampaign(db, accountId, plan.broadcastId);
  if (!campaign) throw new BroadcastError('internal', 'Failed to read created campaign', 500);
  return campaign;
}

/**
 * 'external' channel — no Meta config/template validation (there's
 * nothing to send via the API), just the same phone→contact
 * resolution + dedup-safe recipient insert createBroadcast uses. WACRM
 * prepares and registers; it never calls Meta for these rows.
 */
async function createExternalCampaign(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: CreateCampaignInput
): Promise<ApiCampaign> {
  const messageText = input.messageText?.trim();
  if (!messageText) {
    throw new BroadcastError('bad_request', "'message_text' is required for the external channel", 400);
  }

  const recipients = input.recipients ?? [];
  const contactIds: string[] = [];
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(typeof r.to === 'string' ? r.to : '');
    if (!isValidE164(sanitized)) continue;
    const { id } = await findOrCreateContact(db, accountId, auditUserId, { phone: sanitized });
    contactIds.push(id);
  }
  const uniqueContactIds = [...new Set(contactIds)];

  const { data: broadcast, error: insertErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      name: input.name,
      description: input.description || null,
      send_channel: 'external',
      template_name: null,
      message_text: messageText,
      header_media_url: input.imageUrl?.trim() || null,
      status: uniqueContactIds.length > 0 ? 'ready' : 'draft',
      total_recipients: uniqueContactIds.length,
    })
    .select('id')
    .single();
  if (insertErr || !broadcast) {
    throw new BroadcastError('internal', 'Failed to create campaign', 500);
  }

  if (uniqueContactIds.length > 0) {
    const { error: recipientsErr } = await db.from('broadcast_recipients').upsert(
      uniqueContactIds.map((contactId) => ({
        broadcast_id: broadcast.id,
        contact_id: contactId,
        status: 'pending' as const,
      })),
      { onConflict: 'broadcast_id,contact_id', ignoreDuplicates: true }
    );
    if (recipientsErr) {
      throw new BroadcastError('internal', 'Failed to add campaign recipients', 500);
    }
  }

  const campaign = await getCampaign(db, accountId, broadcast.id as string);
  if (!campaign) throw new BroadcastError('internal', 'Failed to read created campaign', 500);
  return campaign;
}

export interface AddRecipientsInput {
  recipients: { to: string }[];
}

/**
 * Add recipients to an existing campaign. Idempotent — the underlying
 * upsert (migration 075's unique index) silently skips a contact
 * already on the campaign, so calling this twice with an overlapping
 * list never double-adds anyone (spec section 5).
 */
export async function addCampaignRecipients(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  campaignId: string,
  input: AddRecipientsInput
): Promise<{ added: number; total_recipients: number }> {
  const campaign = await getCampaign(db, accountId, campaignId);
  if (!campaign) throw new BroadcastError('not_found', 'Campaign not found', 404);
  if (campaign.status === 'sent' || campaign.status === 'cancelled') {
    throw new BroadcastError(
      'bad_request',
      `Campaign is ${campaign.status} — recipients can't be added`,
      400
    );
  }

  const contactIds: string[] = [];
  for (const r of input.recipients) {
    const sanitized = sanitizePhoneForMeta(typeof r.to === 'string' ? r.to : '');
    if (!isValidE164(sanitized)) continue;
    const { id } = await findOrCreateContact(db, accountId, auditUserId, { phone: sanitized });
    contactIds.push(id);
  }
  const unique = [...new Set(contactIds)];
  if (unique.length === 0) {
    return { added: 0, total_recipients: campaign.total_recipients };
  }

  const { data: inserted, error } = await db
    .from('broadcast_recipients')
    .upsert(
      unique.map((contactId) => ({
        broadcast_id: campaignId,
        contact_id: contactId,
        status: 'pending' as const,
      })),
      { onConflict: 'broadcast_id,contact_id', ignoreDuplicates: true }
    )
    .select('id');
  if (error) throw new BroadcastError('internal', 'Failed to add recipients', 500);

  const { count } = await db
    .from('broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('broadcast_id', campaignId);

  const total_recipients = count ?? campaign.total_recipients;
  if (total_recipients !== campaign.total_recipients) {
    await db
      .from('broadcasts')
      .update({
        total_recipients,
        status: campaign.status === 'draft' ? 'ready' : campaign.status,
      })
      .eq('id', campaignId);
  }

  return { added: (inserted ?? []).length, total_recipients };
}

export interface ApiCampaignRecipient {
  id: string;
  contact_id: string | null;
  phone: string | null;
  name: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
  whatsapp_message_id: string | null;
  created_at: string;
}

export async function listCampaignRecipients(
  db: SupabaseClient,
  accountId: string,
  campaignId: string,
  opts: { limit: number; cursor: Cursor | null; status?: string }
): Promise<{ items: ApiCampaignRecipient[]; nextCursor: string | null }> {
  const campaign = await getCampaign(db, accountId, campaignId);
  if (!campaign) throw new BroadcastError('not_found', 'Campaign not found', 404);

  let query = db
    .from('broadcast_recipients')
    .select(
      'id, contact_id, status, sent_at, delivered_at, read_at, error_message, whatsapp_message_id, created_at, contact:contacts(name, phone)'
    )
    .eq('broadcast_id', campaignId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit + 1);

  if (opts.status) query = query.eq('status', opts.status);
  const kf = keysetFilter(opts.cursor);
  if (kf) query = query.or(kf);

  const { data, error } = await query;
  if (error) throw new BroadcastError('internal', 'Failed to list campaign recipients', 500);

  interface RawRecipientRow {
    id: string;
    contact_id: string | null;
    status: string;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    error_message: string | null;
    whatsapp_message_id: string | null;
    created_at: string;
    contact: { name: string | null; phone: string | null } | null;
  }

  const { items: page, nextCursor } = buildPage(
    (data ?? []) as unknown as RawRecipientRow[],
    opts.limit
  );

  const items = page.map((row) => ({
    id: row.id,
    contact_id: row.contact_id,
    phone: row.contact?.phone ?? null,
    name: row.contact?.name ?? null,
    status: row.status,
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    read_at: row.read_at,
    error_message: row.error_message,
    whatsapp_message_id: row.whatsapp_message_id,
    created_at: row.created_at,
  }));
  return { items, nextCursor };
}

export interface ContactCampaignHistoryEntry {
  campaign_id: string;
  campaign_name: string;
  template_name: string;
  campaign_status: string;
  recipient_status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
  created_at: string;
}

/** "Quais campanhas esse cliente já recebeu?" — wraps migration 075's get_contact_campaign_history RPC. */
export async function getContactCampaignHistory(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ContactCampaignHistoryEntry[]> {
  // Confirm the contact belongs to this account before calling the RPC
  // (the RPC itself is SECURITY INVOKER + RLS-scoped, but this gives a
  // clean 404 instead of a silently-empty list for a foreign id).
  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!contact) throw new BroadcastError('not_found', 'Contact not found', 404);

  const { data, error } = await db.rpc('get_contact_campaign_history', {
    p_contact_id: contactId,
  });
  if (error) throw new BroadcastError('internal', 'Failed to read campaign history', 500);
  return (data ?? []) as ContactCampaignHistoryEntry[];
}

export interface ReportRecipientResultInput {
  status: 'sent' | 'failed';
  /** Defaults to now() when status = 'sent' and this is omitted. */
  sentAt?: string;
  errorMessage?: string;
  /**
   * The external executor's own reference for this send (e.g. a
   * WhatsApp Web message id it captured) — stored in the same
   * `whatsapp_message_id` column the API channel uses for Meta's
   * message id, since both mean "this send's external reference".
   */
  externalReference?: string;
}

/**
 * Record the result of an 'external' send WACRM never performed
 * itself (spec section 4: "depois do envio, o resultado deve retornar
 * ao WACRM"). Conditioned on the recipient still being `pending` —
 * spec section 5's "não duplicar envios" applies here too: a retried
 * or duplicate report can't flip an already-resolved recipient again,
 * so double-reporting is a no-op, not a double-counted send.
 */
export async function reportRecipientResult(
  db: SupabaseClient,
  accountId: string,
  campaignId: string,
  recipientId: string,
  input: ReportRecipientResultInput
): Promise<{ updated: boolean; status: string }> {
  const campaign = await getCampaign(db, accountId, campaignId);
  if (!campaign) throw new BroadcastError('not_found', 'Campaign not found', 404);

  // Read first so a request against an already-resolved recipient can
  // return a clean, idempotent "already reported" instead of silently
  // updating 0 rows and looking like success.
  const { data: existing, error: readErr } = await db
    .from('broadcast_recipients')
    .select('id, status')
    .eq('id', recipientId)
    .eq('broadcast_id', campaignId)
    .maybeSingle();
  if (readErr) throw new BroadcastError('internal', 'Failed to read recipient', 500);
  if (!existing) throw new BroadcastError('not_found', 'Recipient not found on this campaign', 404);

  if (existing.status !== 'pending') {
    // Already reported (or otherwise resolved) — idempotent no-op.
    return { updated: false, status: existing.status as string };
  }

  const patch =
    input.status === 'sent'
      ? {
          status: 'sent' as const,
          sent_at: input.sentAt || new Date().toISOString(),
          whatsapp_message_id: input.externalReference || null,
          error_message: null,
        }
      : {
          status: 'failed' as const,
          error_message: input.errorMessage || 'Unknown error',
        };

  // The WHERE still pins status = 'pending' — a concurrent report
  // racing this one loses instead of double-applying (spec section 5).
  const { data: updated, error: updateErr } = await db
    .from('broadcast_recipients')
    .update(patch)
    .eq('id', recipientId)
    .eq('broadcast_id', campaignId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (updateErr) throw new BroadcastError('internal', 'Failed to record result', 500);
  if (!updated) {
    // Lost the race — re-read so the caller still gets a truthful status.
    const { data: after } = await db
      .from('broadcast_recipients')
      .select('status')
      .eq('id', recipientId)
      .maybeSingle();
    return { updated: false, status: (after?.status as string) ?? existing.status };
  }

  return { updated: true, status: patch.status };
}
