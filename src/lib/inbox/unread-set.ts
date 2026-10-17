export type UnreadChange =
  | { eventType: "DELETE"; old: { id?: string } }
  | { eventType: "INSERT" | "UPDATE"; new: { id: string; unread_count?: number | null } };

export function applyUnreadChange(unreadIds: Set<string>, change: UnreadChange): void {
  if (change.eventType === "DELETE") {
    if (change.old.id) unreadIds.delete(change.old.id);
    return;
  }
  if ((change.new.unread_count ?? 0) > 0) unreadIds.add(change.new.id);
  else unreadIds.delete(change.new.id);
}
