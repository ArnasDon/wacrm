// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() — send each recipient's message (phone-variant
//                        retry), stamp each recipient row + the
//                        aggregate counts, finalize status.
//
// Two content sources, gated by the account's provider (Meta requires
// an approved template for business-initiated sends; uazapi has no
// such pipeline — see provider-types.ts):
//   - Meta:   templateName (+ templateLanguage) — existing path.
//   - uazapi: bodyText (optionally mediaUrl/mediaKind) — free text,
//             personalized via the same {{1}}/{{2}} positional
//             convention templates already use (interpolateBodyText).
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import {
  resolveProviderConfig,
  buildProvider,
  sendWithPhoneRetry,
  interpolateBodyText,
  WhatsAppNotConfiguredError,
} from '@/lib/whatsapp/send-core';
import {
  isMetaProvider,
  type WhatsAppProvider,
  type ProviderMediaKind,
} from '@/lib/whatsapp/provider-types';

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
  /** Positional body params for the template/free-text body ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  /** Meta path — required unless `bodyText` is set. */
  templateName?: string | null;
  templateLanguage?: string | null;
  /** uazapi path — required unless `templateName` is set. */
  bodyText?: string | null;
  mediaUrl?: string | null;
  mediaKind?: ProviderMediaKind | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  params: string[];
}

export interface BroadcastPlan {
  broadcastId: string;
  provider: WhatsAppProvider;
  /** Meta path fields — set when this plan sends a template. */
  templateName: string | null;
  templateLanguage: string | null;
  templateRow: MessageTemplate | null;
  /** uazapi path fields — set when this plan sends free text. */
  bodyText: string | null;
  mediaUrl: string | null;
  mediaKind: ProviderMediaKind | null;
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
  const { name, recipients } = params;
  const templateName = params.templateName?.trim() || null;
  const templateLanguage = params.templateLanguage || 'en_US';
  const bodyText = params.bodyText?.trim() || null;

  // Pure, provider-independent checks first — no DB call needed to
  // reject a request that supplies no content source at all, or a
  // malformed recipient list.
  if (!templateName && !bodyText) {
    throw new BroadcastError(
      'bad_request',
      "Either 'template_name' or 'body_text' is required",
      400
    );
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
  // by the caller).
  let providerConfig;
  try {
    providerConfig = await resolveProviderConfig(db, accountId);
  } catch (err) {
    if (err instanceof WhatsAppNotConfiguredError) {
      throw new BroadcastError('whatsapp_not_configured', err.message, 400);
    }
    throw err;
  }
  const provider = buildProvider(providerConfig);

  // Each provider has exactly one valid content source — Meta requires
  // an approved template (its own policy, not ours; see
  // provider-types.ts), uazapi has no such pipeline so it takes free
  // text instead. Reject the mismatched combination up front rather
  // than letting deliverBroadcast discover it mid-fan-out.
  if (providerConfig.provider === 'meta') {
    if (!templateName) {
      throw new BroadcastError('bad_request', "'template_name' is required", 400);
    }
  } else {
    if (!bodyText) {
      throw new BroadcastError(
        'bad_request',
        "'body_text' is required for broadcasts on this account's provider",
        400
      );
    }
  }

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  // Meta-only — uazapi's bodyText path has no local row to validate.
  let templateRow: MessageTemplate | null = null;
  if (templateName) {
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
    templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;
  }

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
      name: name || `API broadcast (${templateName ?? 'texto livre'})`,
      template_name: templateName,
      template_language: templateName ? templateLanguage : null,
      body_text: bodyText,
      media_url: params.mediaUrl?.trim() || null,
      media_kind: params.mediaKind ?? null,
      status: 'sending',
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .insert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
      }))
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
    provider,
    templateName,
    templateLanguage: templateName ? templateLanguage : null,
    templateRow,
    bodyText,
    mediaUrl: params.mediaUrl?.trim() || null,
    mediaKind: params.mediaKind ?? null,
    planned,
    rejected,
  };
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's message
 * (phone-variant retry) and stamp its `broadcast_recipients` row.
 * Best-effort per recipient — one failure never aborts the rest.
 * Designed to run inside `after()`.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * below advances them automatically, and later delivery/read webhooks
 * keep advancing them. We therefore never write those columns here —
 * only the terminal `status` — otherwise a manual value would race
 * and clobber the trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  let sentCount = 0;
  const provider = plan.provider;
  const useTemplate = plan.templateName !== null;

  if (useTemplate && !isMetaProvider(provider)) {
    // createBroadcast only builds a template-shaped plan for a Meta
    // provider — this is an invariant check, not a reachable path.
    throw new Error('deliverBroadcast: template plan built for a non-Meta provider');
  }

  for (const recipient of plan.planned) {
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    try {
      const { result } = await sendWithPhoneRetry(recipient.phone, async (variant) => {
        if (useTemplate && isMetaProvider(provider)) {
          const r = await provider.sendTemplate({
            to: variant,
            templateName: plan.templateName!,
            language: plan.templateLanguage!,
            template: plan.templateRow ?? undefined,
            params: recipient.params,
          });
          return r.messageId;
        }
        // Free-text path (uazapi, or any future non-template provider).
        const text = interpolateBodyText(plan.bodyText ?? '', recipient.params);
        if (plan.mediaUrl && plan.mediaKind) {
          const r = await provider.sendMedia({
            to: variant,
            kind: plan.mediaKind,
            link: plan.mediaUrl,
            caption: text || undefined,
          });
          return r.messageId;
        }
        const r = await provider.sendText({ to: variant, text });
        return r.messageId;
      });
      sentMessageId = result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Erro desconhecido';
    }

    if (sentMessageId) {
      sentCount++;
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
          error_message: lastError || 'Erro desconhecido',
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  // Terminal status only — counts are trigger-owned (see the note
  // above). If nothing sent, the broadcast failed outright; a partial
  // send is still 'sent' (per-recipient failures show in failed_count).
  await db
    .from('broadcasts')
    .update({
      status: sentCount > 0 ? 'sent' : 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.broadcastId);
}
