import type { Conversation, ConversationStatus } from "@/types";

export const INBOX_FILTERS = [
  "all",
  "unread",
  "waiting",
  "unassigned",
  "expiring",
  "open",
  "pending",
  "closed",
] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

const WINDOW_MS = 24 * 60 * 60 * 1000;
const EXPIRING_WITHIN_MS = 2 * 60 * 60 * 1000;

export function parseInboxFilter(raw: string | null | undefined): InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as InboxFilter)
    : "all";
}

export function isAwaitingReply(c: Conversation): boolean {
  if (c.status === "closed" || !c.last_inbound_at) return false;
  if (!c.last_reply_at) return true;
  return new Date(c.last_reply_at).getTime() < new Date(c.last_inbound_at).getTime();
}

export function isWindowClosing(c: Conversation, now: number): boolean {
  if (!isAwaitingReply(c) || !c.last_inbound_at) return false;
  const closesAt = new Date(c.last_inbound_at).getTime() + WINDOW_MS;
  return closesAt > now && closesAt - now <= EXPIRING_WITHIN_MS;
}

function byOldestInbound(a: Conversation, b: Conversation): number {
  return (a.last_inbound_at ?? "").localeCompare(b.last_inbound_at ?? "");
}

export function applyInboxFilter(
  conversations: Conversation[],
  filter: InboxFilter,
  now: number,
): Conversation[] {
  switch (filter) {
    case "all":
      return conversations;
    case "unread":
      return conversations.filter((c) => c.unread_count > 0);
    case "waiting":
      return conversations.filter(isAwaitingReply).sort(byOldestInbound);
    case "expiring":
      return conversations.filter((c) => isWindowClosing(c, now)).sort(byOldestInbound);
    case "unassigned":
      return conversations.filter((c) => c.status === "open" && !c.assigned_agent_id);
    default:
      return conversations.filter((c) => c.status === (filter as ConversationStatus));
  }
}
