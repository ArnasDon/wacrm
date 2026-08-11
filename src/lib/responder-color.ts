import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/types";

/**
 * Color of the small "last internal responder" indicator bar shown on
 * Inbox and Pipeline cards. Only Ronaldo and Tatiana carry a defined
 * identity color today; any other/unrecognized profile — or a
 * conversation with no attributed internal reply yet — falls back to
 * gray. See {@link resolveResponderColor}.
 */
export type ResponderColor = "blue" | "pink" | "gray";

export const RESPONDER_COLOR_CLASS: Record<ResponderColor, string> = {
  blue: "bg-blue-500",
  pink: "bg-pink-500",
  gray: "bg-muted-foreground/40",
};

/**
 * Maps a profile to its responder-indicator color by name — there is no
 * per-user color field in `profiles`, and the two atendentes this
 * indicator distinguishes are identified by name ("Ronaldo Meira",
 * "Thatianna Oliveira") rather than a stable enum. Any other/future
 * teammate resolves to gray until a real per-user color exists.
 */
export function resolveResponderColor(
  profile: Profile | null | undefined,
): ResponderColor {
  const name = profile?.full_name?.toLowerCase() ?? "";
  if (name.includes("ronaldo")) return "blue";
  // "tati" is NOT a substring of "thatianna" (the "h" breaks the run —
  // t-h-a-t-i-...), so a bare `includes("tati")` silently misses her real
  // profile name and falls through to gray. Match both spellings.
  if (name.includes("tatiana") || name.includes("thatianna")) return "pink";
  return "gray";
}

/**
 * Conversation id → user id of the last internal (agent) message sender,
 * for every conversation the caller's RLS allows. Backed by a single SQL
 * function (`list_conversation_last_agent_senders`, migration 054) so the
 * Inbox and Pipeline never issue a per-row/per-card query for this.
 */
export async function fetchLastAgentSenderMap(
  db: SupabaseClient,
): Promise<Map<string, string>> {
  const { data, error } = await db.rpc("list_conversation_last_agent_senders");
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of (data ?? []) as {
    conversation_id: string;
    sender_id: string;
  }[]) {
    map.set(row.conversation_id, row.sender_id);
  }
  return map;
}

/**
 * The color for a given conversation, derived from the same
 * `lastAgentSenderMap` + `profiles` pair everywhere it's used — Inbox and
 * Pipeline must never compute this independently (they'd risk disagreeing
 * on the same lead's color).
 */
export function colorForConversation(
  conversationId: string | null | undefined,
  lastAgentSenderMap: Map<string, string>,
  profiles: Profile[],
): ResponderColor {
  if (!conversationId) return "gray";
  const senderId = lastAgentSenderMap.get(conversationId);
  if (!senderId) return "gray";
  const profile = profiles.find((p) => p.user_id === senderId);
  return resolveResponderColor(profile);
}
