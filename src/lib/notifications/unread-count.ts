import type { Notification } from "@/types";

export type UnreadCountChange = { kind: "delta"; delta: number } | { kind: "refetch" };

type NotificationChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<Notification>;
  old: Partial<Notification>;
};

const NO_CHANGE: UnreadCountChange = { kind: "delta", delta: 0 };

export function notificationsAccountFilter(accountId: string): string {
  return `account_id=eq.${accountId}`;
}

export function unreadCountChange(
  change: NotificationChange,
  accountId: string,
): UnreadCountChange {
  if (change.eventType === "DELETE") return { kind: "refetch" };
  if (change.new.account_id !== accountId) return NO_CHANGE;
  if (change.eventType === "INSERT") {
    return change.new.read_at ? NO_CHANGE : { kind: "delta", delta: 1 };
  }
  return change.new.read_at ? { kind: "delta", delta: -1 } : NO_CHANGE;
}
