// ============================================================
// Resolve (or create) the conversation for an Instagram-Scoped ID
// (IGSID).
//
// Mirrors `@/lib/whatsapp/resolve-conversation`'s
// `resolveConversationByPhone` exactly, swapping the phone-based
// identity for an IGSID-based one:
//   - fail fast if the account has no Instagram connected,
//   - find-or-create the contact via the exact-match IGSID lookup
//     (findExistingInstagramContact — no fuzzy variants needed,
//     unlike phone numbers),
//   - find-or-create the single conversation for (account, contact),
//     tagged with channel: 'instagram' on create.
//
// Reuses `resolveAuditUserId` (WhatsApp-config-owner-first, falling
// back to the account owner) unchanged — for an Instagram-only
// account the WhatsApp lookup simply misses and the account-owner
// fallback kicks in, so no channel-specific audit logic is needed.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingInstagramContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { SendMessageError } from '@/lib/messaging/types';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { getIgUserProfile } from '@/lib/instagram/api';
import { decrypt } from '@/lib/whatsapp/encryption';

export interface ResolvedInstagramConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

/**
 * Find or create the contact + conversation for Instagram-Scoped ID
 * `igsid` within `accountId`. Throws `SendMessageError` (shared with
 * the WhatsApp send core, so callers handle one error family) on a
 * missing Instagram config or a DB failure.
 */
export async function resolveConversationByInstagramId(
  db: SupabaseClient,
  accountId: string,
  igsid: string,
  username?: string | null
): Promise<ResolvedInstagramConversation> {
  if (!igsid) {
    throw new SendMessageError('bad_request', "'igsid' is required", 400);
  }

  // Fail fast (and create nothing) when the account has no Instagram
  // connected — the same error the send would raise anyway.
  const { data: config } = await db
    .from('instagram_config')
    .select('id, access_token')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!config) {
    throw new SendMessageError(
      'instagram_not_configured',
      'Instagram not configured. Please set up your Instagram integration first.',
      400
    );
  }

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

  const existing = await findExistingInstagramContact(db, accountId, igsid);
  if (existing) {
    contactId = existing.id;
    if (username && username !== existing.instagram_username) {
      await db
        .from('contacts')
        .update({ instagram_username: username, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  } else {
    // Best-effort profile fetch so the contact has a human-readable
    // name instead of a bare IGSID. Never throws — getIgUserProfile
    // swallows its own errors and returns null.
    let resolvedUsername = username ?? null;
    let displayName: string | null = null;
    if (!resolvedUsername) {
      const profile = await getIgUserProfile({ igsid, accessToken: decrypt(config.access_token) });
      resolvedUsername = profile?.username ?? null;
      displayName = profile?.name ?? null;
    }

    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: null,
        instagram_id: igsid,
        instagram_username: resolvedUsername,
        name: displayName || resolvedUsername || igsid,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      // Lost a race against a concurrent inbound create — the unique
      // index (migration 039) rejected the duplicate. Re-resolve.
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingInstagramContact(db, accountId, igsid);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError('db_error', 'Failed to create contact', 500);
        }
      } else {
        console.error('[instagram/resolve-conversation] contact create error:', createErr);
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    } else {
      contactId = created.id;
      contactCreated = true;
    }
  }

  // ---- conversation -------------------------------------------
  const conversationId = await findOrCreateConversationRow(db, accountId, contactId, ownerUserId);

  return { conversationId, contactId, contactCreated };
}

/**
 * Find (oldest-first) or create the single conversation for
 * `(accountId, contactId)`, tagged `channel: 'instagram'` on create.
 * Handles the unique-index race the same way
 * `resolveConversationByPhone` does: on a 23505 from a concurrent
 * create, re-resolve the winning row rather than failing the send.
 */
async function findOrCreateConversationRow(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  ownerUserId: string
): Promise<string> {
  const { data: existing, error: findErr } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findErr) {
    console.error('[instagram/resolve-conversation] conversation lookup error:', findErr);
    throw new SendMessageError('db_error', 'Failed to resolve conversation', 500);
  }

  if (existing && existing.length > 0) {
    return existing[0].id;
  }

  const { data: newConv, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      channel: 'instagram',
    })
    .select('id')
    .single();

  if (convErr || !newConv) {
    if (isUniqueViolation(convErr)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return raced[0].id;
      }
    }
    console.error('[instagram/resolve-conversation] conversation create error:', convErr);
    throw new SendMessageError('db_error', 'Failed to create conversation', 500);
  }

  return newConv.id;
}
