// ============================================================
// Broadcast resume / retry (issue #472).
//
// The dashboard wizard drives its own send loop from the browser tab
// that started the campaign, so closing the tab abandons the campaign
// mid-flight: the remaining recipients stay 'pending' and the
// broadcast sits in 'sending' forever. This module is the recovery —
// and the same machinery answers the reporter's other two asks,
// "reprocess pending" and "reprocess failed".
//
// It deliberately reuses `deliverBroadcast` rather than growing a
// second fan-out loop: same phone-variant retry, same per-recipient
// stamping, same trigger-owned counts.
//
// What it does NOT do is move the *initial* send server-side. The
// wizard still owns that; this makes an abandoned one recoverable.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { BroadcastError, type BroadcastPlan } from '@/lib/whatsapp/broadcast-core';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveTemplateRow } from '@/lib/whatsapp/template-body';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

/** Which recipients a resume pass picks up. */
export type ResumeScope = 'pending' | 'failed' | 'all';

export const RESUME_SCOPES: readonly ResumeScope[] = [
  'pending',
  'failed',
  'all',
];

/**
 * Recipients delivered per resume request. One pass runs inside
 * `after()`, so it is bounded by the host's function timeout — the cap
 * keeps a 5 000-recipient backlog from being one un-completable unit
 * of work. Whatever is left stays 'pending' and the caller is told how
 * many, so the UI can offer Resume again. Matches the public API's
 * per-request recipient cap.
 */
export const RESUME_MAX_PER_REQUEST = 1000;

/**
 * How long a `delivery_locked_at` stamp is honoured before it is read
 * as abandoned. Long enough that a legitimately slow pass is never
 * stolen from, short enough that a crashed one doesn't wedge the
 * campaign until someone touches the database.
 */
export const DELIVERY_LOCK_STALE_MS = 30 * 60 * 1000;

function scopeStatuses(scope: ResumeScope): string[] {
  if (scope === 'pending') return ['pending'];
  if (scope === 'failed') return ['failed'];
  return ['pending', 'failed'];
}

/**
 * Take the delivery lock for a broadcast.
 *
 * One conditional UPDATE, so the claim is atomic: a concurrent caller's
 * WHERE no longer matches and it gets `false`. Returns false when the
 * broadcast doesn't exist on this account, too — the caller treats both
 * as "not yours to run".
 */
export async function claimBroadcastDelivery(
  db: SupabaseClient,
  accountId: string,
  broadcastId: string,
  now: Date = new Date()
): Promise<boolean> {
  const staleCutoff = new Date(
    now.getTime() - DELIVERY_LOCK_STALE_MS
  ).toISOString();

  const { data, error } = await db
    .from('broadcasts')
    .update({ delivery_locked_at: now.toISOString() })
    .eq('id', broadcastId)
    .eq('account_id', accountId)
    .or(`delivery_locked_at.is.null,delivery_locked_at.lt.${staleCutoff}`)
    .select('id');

  if (error) {
    console.error('[broadcast-resume] claim failed:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Release the delivery lock. Best-effort; a stale lock self-expires. */
export async function releaseBroadcastDelivery(
  db: SupabaseClient,
  broadcastId: string
): Promise<void> {
  const { error } = await db
    .from('broadcasts')
    .update({ delivery_locked_at: null })
    .eq('id', broadcastId);
  if (error) {
    console.error('[broadcast-resume] release failed:', error.message);
  }
}

export interface ResumePlan {
  plan: BroadcastPlan;
  /** In-scope recipients left over after the per-request cap. */
  remaining: number;
  /**
   * In-scope rows that can never send because their contact has no
   * usable phone. Stamped 'failed' by {@link planBroadcastResume} so
   * they stop blocking the broadcast's terminal status.
   */
  unsendable: number;
}

interface RecipientRow {
  id: string;
  template_params: unknown;
  contact: { phone?: string | null } | { phone?: string | null }[] | null;
}

/** Supabase renders an embedded to-one join as an object or a 1-array. */
function contactPhone(row: RecipientRow): string | null {
  const c = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  return c?.phone ?? null;
}

/**
 * Build a {@link BroadcastPlan} for the recipients of an existing
 * broadcast that still need sending.
 *
 * Params come off the recipient rows (frozen at plan time by migration
 * 038) rather than being re-resolved from contact data, so a resume
 * sends what the original pass would have sent even if the contact has
 * been edited since.
 *
 * Throws {@link BroadcastError}; the route maps it.
 */
export async function planBroadcastResume(
  db: SupabaseClient,
  accountId: string,
  broadcastId: string,
  scope: ResumeScope
): Promise<ResumePlan> {
  const { data: broadcast, error: bcError } = await db
    .from('broadcasts')
    .select('id, template_name, template_language')
    .eq('id', broadcastId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (bcError || !broadcast) {
    throw new BroadcastError('not_found', 'Broadcast not found', 404);
  }

  const statuses = scopeStatuses(scope);
  const { data: rawRows, error: recError } = await db
    .from('broadcast_recipients')
    .select('id, template_params, contact:contacts(phone)')
    .eq('broadcast_id', broadcastId)
    .in('status', statuses)
    // Oldest first, so repeated capped passes chew through the backlog
    // in a stable order instead of re-picking the same slice.
    .order('created_at', { ascending: true });

  if (recError) {
    console.error('[broadcast-resume] recipient load failed:', recError.message);
    throw new BroadcastError('internal', 'Failed to load recipients', 500);
  }

  const rows = (rawRows ?? []) as RecipientRow[];

  // A recipient whose contact has no usable phone can never send. Stamp
  // it failed now: leaving it 'pending' would keep the broadcast in
  // 'sending' forever, which is the very symptom being fixed.
  const sendable: RecipientRow[] = [];
  const unsendable: string[] = [];
  for (const row of rows) {
    const sanitized = sanitizePhoneForMeta(contactPhone(row) ?? '');
    if (isValidE164(sanitized)) sendable.push(row);
    else unsendable.push(row.id);
  }
  if (unsendable.length > 0) {
    await db
      .from('broadcast_recipients')
      .update({
        status: 'failed',
        error_message: 'No valid phone number on contact',
      })
      .in('id', unsendable);
  }

  const slice = sendable.slice(0, RESUME_MAX_PER_REQUEST);
  const remaining = sendable.length - slice.length;

  if (slice.length === 0) {
    throw new BroadcastError(
      'nothing_to_resume',
      scope === 'failed'
        ? 'This broadcast has no failed recipients to retry'
        : 'This broadcast has no recipients left to send',
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

  const resolvedTemplate = await resolveTemplateRow(
    db,
    accountId,
    broadcast.template_name,
    broadcast.template_language
  );
  if (resolvedTemplate.malformed) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before resuming.',
      500
    );
  }

  const plan: BroadcastPlan = {
    broadcastId,
    templateName: broadcast.template_name,
    templateLanguage: resolvedTemplate.language,
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    templateRow: resolvedTemplate.row,
    planned: slice.map((row) => ({
      recipientRowId: row.id,
      phone: sanitizePhoneForMeta(contactPhone(row) ?? ''),
      params: Array.isArray(row.template_params)
        ? row.template_params.filter((p): p is string => typeof p === 'string')
        : [],
    })),
    rejected: 0,
  };

  return { plan, remaining, unsendable: unsendable.length };
}

/**
 * Put the broadcast back into `sending` for the duration of the pass,
 * so the detail page reads as in-flight rather than as a finished
 * campaign that is quietly still working.
 */
export async function markBroadcastSending(
  db: SupabaseClient,
  broadcastId: string
): Promise<void> {
  await db
    .from('broadcasts')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', broadcastId);
}
