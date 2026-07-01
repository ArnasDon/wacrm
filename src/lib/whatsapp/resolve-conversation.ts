// ============================================================
// Resolve (or create) the conversation for a phone number.
//
// The dashboard composer always has a `conversation_id` in hand. The
// public API doesn't — an external automation knows a *phone number*,
// not an internal UUID. This helper bridges that: given an E.164
// phone, it finds-or-creates the contact and its conversation so the
// shared `sendMessageToConversation` core can run unchanged.
//
// It deliberately reuses the exact find-or-create logic the inbound
// webhook uses (the `findExistingContact` dedupe helper, the
// one-conversation-per-(account, contact) convention, the
// account_id-tenancy / user_id-audit split) so a contact created via
// the API is indistinguishable from one created by an inbound message.
//
// Audit user: created rows need a NOT NULL `user_id`. As with the
// webhook (where there's no logged-in human either), we attribute
// them to the WhatsApp config owner — a stable account-level default.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
  /** Provider the conversation is (or was already) associated with. */
  provider: string;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 *
 * `provider` selects which WhatsApp connection a brand-new conversation
 * is stamped with (see migration 029 — an account can hold a Meta row,
 * a Uazapi row, or both). Omit it to use the account's default
 * provider (`whatsapp_config.is_default`). Ignored when the contact
 * already has a conversation — that conversation keeps whichever
 * provider opened it.
 */
export async function resolveConversationByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  name?: string | null,
  provider?: 'meta' | 'uazapi'
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Resolve which config to use — an explicit `provider` must exist as
  // a connected row; otherwise fall back to the account's default, and
  // finally to whichever single row exists (pre-multi-provider accounts).
  let resolvedProvider: string;
  if (provider) {
    const { data: config } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', provider)
      .maybeSingle();
    if (!config) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        `WhatsApp (${provider}) is not configured for this account.`,
        400
      );
    }
    resolvedProvider = provider;
  } else {
    const { data: configs } = await db
      .from('whatsapp_config')
      .select('provider, is_default')
      .eq('account_id', accountId);
    if (!configs || configs.length === 0) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
        400
      );
    }
    resolvedProvider =
      configs.find((c) => c.is_default)?.provider ?? configs[0].provider;
  }

  // Audit user for created rows = the single account-wide default used
  // by every public-API write (see resolveAuditUserId), so a contact
  // created here is attributed identically to one created via
  // POST /api/v1/contacts. resolveAuditUserId throws ContactError only
  // if the owner can't be resolved — remap it to the send error family
  // the callers already handle.
  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserId(db, accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  // ---- contact -------------------------------------------------
  let contactId: string;
  let contactCreated = false;

  const existing = await findExistingContact(db, accountId, sanitized);
  if (existing) {
    contactId = existing.id;
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  } else {
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: sanitized,
        name: name || sanitized,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      // Lost a race against a concurrent inbound/API create — the
      // unique index (migration 022) rejected the duplicate. Re-resolve.
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(db, accountId, sanitized);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError(
            'db_error',
            'Failed to create contact',
            500
          );
        }
      } else {
        console.error(
          '[resolve-conversation] contact create error:',
          createErr
        );
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    } else {
      contactId = created.id;
      contactCreated = true;
    }
  }

  // ---- conversation -------------------------------------------
  // One conversation per (account, contact) — same convention as the
  // webhook.
  const { data: conv } = await db
    .from('conversations')
    .select('id, provider')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (conv?.id) {
    // Keep whichever provider actually opened this conversation — the
    // caller's requested `provider` only applies to brand-new threads.
    return {
      conversationId: conv.id,
      contactId,
      contactCreated,
      provider: conv.provider || 'meta',
    };
  }

  const { data: newConv, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      provider: resolvedProvider,
    })
    .select('id')
    .single();

  if (convErr || !newConv) {
    console.error('[resolve-conversation] conversation create error:', convErr);
    throw new SendMessageError(
      'db_error',
      'Failed to create conversation',
      500
    );
  }

  return {
    conversationId: newConv.id,
    contactId,
    contactCreated,
    provider: resolvedProvider,
  };
}
