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

export class ConversationResolutionError extends Error {
  code?: string;
  status: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'ConversationResolutionError';
    this.code = code;
    this.status = status ?? (code === '42501' ? 403 : 500);
  }
}

export interface ConversationRecord {
  id: string;
  account_id: string;
  user_id: string;
  contact_id: string;
  status: 'open' | 'pending' | 'closed';
  assigned_agent_id: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count: number | null;
  ai_autoreply_disabled?: boolean;
  ai_reply_count?: number;
  bot_pause_reason?: string | null;
  bot_paused_at?: string | null;
  bot_resume_after?: string | null;
  bot_handoff_id?: string | null;
  bot_order_resumed_at?: string | null;
  last_agent_message_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ResolveOrCreateConversationParams {
  accountId: string;
  userId: string;
  contactId: string;
  status?: 'open' | 'pending' | 'closed';
  assignedAgentId?: string | null;
}

export interface ResolveOrCreateConversationResult {
  conversation: ConversationRecord;
  is_new: boolean;
}

/**
 * Single atomic entrypoint for getting or creating the unique conversation
 * thread for `(accountId, contactId)` via the Postgres RPC
 * `resolve_or_create_conversation`.
 */
export async function resolveOrCreateConversation(
  db: SupabaseClient,
  params: ResolveOrCreateConversationParams
): Promise<ResolveOrCreateConversationResult> {
  const { data, error } = await db.rpc('resolve_or_create_conversation', {
    p_account_id: params.accountId,
    p_user_id: params.userId,
    p_contact_id: params.contactId,
    p_status: params.status ?? 'open',
    p_assigned_agent_id: params.assignedAgentId ?? null,
  });

  if (error) {
    throw new ConversationResolutionError(
      error.message || 'Failed to resolve conversation',
      error.code
    );
  }

  const payload = (
    typeof data === 'string' ? JSON.parse(data) : data
  ) as Partial<ResolveOrCreateConversationResult> | null;

  if (!payload?.conversation?.id) {
    throw new ConversationResolutionError(
      'Invalid payload returned by resolve_or_create_conversation'
    );
  }

  return {
    conversation: payload.conversation,
    is_new: Boolean(payload.is_new),
  };
}

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 */
export async function resolveConversationByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  name?: string | null
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway.
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
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
  // One conversation per (account, contact) via atomic Postgres RPC.
  try {
    const { conversation } = await resolveOrCreateConversation(db, {
      accountId,
      userId: ownerUserId,
      contactId,
    });
    return { conversationId: conversation.id, contactId, contactCreated };
  } catch (convErr) {
    console.error('[resolve-conversation] conversation create error:', convErr);
    if (convErr instanceof ConversationResolutionError) {
      throw new SendMessageError(
        convErr.status === 403 ? 'forbidden' : 'db_error',
        convErr.status === 403 ? 'Forbidden' : 'Failed to create conversation',
        convErr.status
      );
    }
    throw new SendMessageError('db_error', 'Failed to create conversation', 500);
  }
}
