import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageReaction } from "@/types";
import { isUniqueViolation } from "@/lib/contacts/dedupe";

export interface ReactionGroup {
  emoji: string;
  count: number;
  byBusiness: boolean;
}

export function businessReactionOn(
  reactions: readonly MessageReaction[] | undefined,
  messageId: string,
): MessageReaction | undefined {
  return reactions?.find(
    (r) => r.message_id === messageId && r.actor_type === "agent",
  );
}

export function groupReactions(
  reactions: readonly MessageReaction[],
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const byBusiness = r.actor_type === "agent";
    const existing = groups.get(r.emoji);
    if (existing) {
      existing.count += 1;
      existing.byBusiness = existing.byBusiness || byBusiness;
    } else {
      groups.set(r.emoji, { emoji: r.emoji, count: 1, byBusiness });
    }
  }
  return [...groups.values()];
}

export function withBusinessReaction(
  reactions: readonly MessageReaction[],
  change: {
    messageId: string;
    conversationId: string;
    userId: string;
    emoji: string;
    now: Date;
  },
): MessageReaction[] {
  const current = businessReactionOn(reactions, change.messageId);
  const others = reactions.filter(
    (r) => !(r.message_id === change.messageId && r.actor_type === "agent"),
  );
  if (change.emoji === "") return others;

  const replacement: MessageReaction =
    current && current.actor_id === change.userId
      ? { ...current, emoji: change.emoji }
      : {
          id: `temp-${change.now.getTime()}`,
          message_id: change.messageId,
          conversation_id: change.conversationId,
          actor_type: "agent",
          actor_id: change.userId,
          emoji: change.emoji,
          created_at: change.now.toISOString(),
        };
  return [...others, replacement];
}

export async function removeBusinessReaction(
  db: SupabaseClient,
  messageId: string,
): Promise<{ message: string } | null> {
  const { error } = await db
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("actor_type", "agent");
  return error;
}

export async function setBusinessReaction(
  db: SupabaseClient,
  target: { messageId: string; conversationId: string },
  userId: string,
  emoji: string,
): Promise<{ message: string } | null> {
  const maxAttempts = 2;
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error: clearError } = await db
      .from("message_reactions")
      .delete()
      .eq("message_id", target.messageId)
      .eq("actor_type", "agent")
      .neq("actor_id", userId);
    if (clearError) return clearError;

    const { error } = await db.from("message_reactions").upsert(
      {
        message_id: target.messageId,
        conversation_id: target.conversationId,
        actor_type: "agent",
        actor_id: userId,
        emoji,
      },
      { onConflict: "message_id,actor_type,actor_id" },
    );
    if (!error || !isUniqueViolation(error)) return error;
    lastError = error;
  }
  return lastError;
}
