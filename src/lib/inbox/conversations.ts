import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/**
 * Conversation ids whose message history contains `query` — powers the
 * Inbox search box's "search inside the conversation" mode, alongside
 * the client-side name/phone/last-message match already done in
 * conversation-list.tsx (this only adds full-history coverage; the
 * fields it doesn't cover already work today). RLS on `messages`
 * (migration 017) already scopes every row to the caller's account via
 * its conversation's account_id, so no explicit account filter is
 * needed here. `content_text` is the single column used for both plain
 * text and media captions (see message-composer.tsx), so this covers
 * both without extra branching — a NULL content_text (media with no
 * caption) simply never matches. Capped at 500 rows as a sanity limit
 * on a very common search term; the caller also debounces so this
 * isn't fired on every keystroke.
 */
export async function searchConversationIdsByMessageText(
  db: SupabaseClient,
  query: string,
): Promise<Set<string>> {
  const trimmed = query.trim();
  if (!trimmed) return new Set();
  const { data, error } = await db
    .from("messages")
    .select("conversation_id")
    .ilike("content_text", `%${trimmed}%`)
    .limit(500);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.conversation_id as string));
}

/**
 * Ids of conversations that are "unanswered" — the same rule the
 * dashboard's "Leads Não Respondidos" card counts via
 * `count_unanswered_conversations` (migration 042/047): not closed,
 * and the most recent message came from the customer. Backed by
 * `list_unanswered_conversation_ids`, the SETOF sibling that RPC now
 * delegates to, so the Inbox drill-through and the dashboard count
 * can never disagree.
 */
export async function loadUnansweredConversationIds(
  db: SupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await db.rpc("list_unanswered_conversation_ids");
  if (error) throw error;
  return new Set((data ?? []) as string[]);
}

/**
 * Manual unread marker — shared by the thread header's "Marcar como não
 * lida" action and the conversation list's swipe/right-click actions, so
 * both write through the exact same DB call (migration N/A, column
 * pre-existing). Sets `unread_count` back to 1; MessageThread's own reset
 * effect clears it again once the conversation is actually reopened.
 */
export async function markConversationUnread(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { error } = await db
    .from("conversations")
    .update({ unread_count: 1 })
    .eq("id", conversationId);
  if (error) throw error;
}

/**
 * Manual "mark as read" — the conversation list's three-dot menu action.
 * Same DB write MessageThread's own reset effect already performs when a
 * conversation is opened (`unread_count: 0`), just exposed so it can be
 * triggered without opening the thread. Also the "already viewed" signal
 * `list_unanswered_conversation_ids` now checks (migration 061), so this
 * doubles as "remove from Leads Não Respondidos" with no separate call.
 */
export async function markConversationRead(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { error } = await db
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId);
  if (error) throw error;
}

/**
 * Toggles the manual "pin to top" flag (migration 060) — shared by the
 * conversation list's swipe and right-click context menu actions.
 */
export async function toggleConversationPinned(
  db: SupabaseClient,
  conversationId: string,
  pinned: boolean,
): Promise<void> {
  const { error } = await db
    .from("conversations")
    .update({ pinned })
    .eq("id", conversationId);
  if (error) throw error;
}
