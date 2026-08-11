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
 * Conversation id → user id of the conversation's persistently assigned
 * agent (`conversations.assigned_agent_id`), for every conversation the
 * caller's RLS allows. This is the CRM's one durable "who owns this
 * lead" field — set on whichever agent replies first (see
 * `sendMessageToConversation`) and only ever changed afterward by a
 * manual transfer via the existing "Atribuir" UI. Deliberately NOT
 * based on the most recent message's sender — that flips every time a
 * different teammate replies, which is exactly the bug this fixes.
 */
export async function fetchAssignedAgentMap(
  db: SupabaseClient,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("conversations")
    .select("id, assigned_agent_id")
    .not("assigned_agent_id", "is", null);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of (data ?? []) as {
    id: string;
    assigned_agent_id: string;
  }[]) {
    map.set(row.id, row.assigned_agent_id);
  }
  return map;
}

/**
 * The color for a given conversation, derived from the same
 * `assignedAgentMap` + `profiles` pair everywhere it's used — Inbox and
 * Pipeline must never compute this independently (they'd risk disagreeing
 * on the same lead's color).
 */
export function colorForConversation(
  conversationId: string | null | undefined,
  assignedAgentMap: Map<string, string>,
  profiles: Profile[],
): ResponderColor {
  if (!conversationId) return "gray";
  const agentId = assignedAgentMap.get(conversationId);
  if (!agentId) return "gray";
  const profile = profiles.find((p) => p.user_id === agentId);
  return resolveResponderColor(profile);
}
