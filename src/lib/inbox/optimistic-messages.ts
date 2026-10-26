import type { Message } from "@/types";

export const TEMP_MESSAGE_PREFIX = "temp-";
export const RESYNC_MATCH_WINDOW_MS = 2 * 60_000;

let tempCounter = 0;

export function newTempMessageId(now: number = Date.now()): string {
  tempCounter += 1;
  return `${TEMP_MESSAGE_PREFIX}${now}-${tempCounter}`;
}

export function isTempMessage(message: Pick<Message, "id">): boolean {
  return message.id.startsWith(TEMP_MESSAGE_PREFIX);
}

function createdAtMs(message: Pick<Message, "created_at">): number {
  return new Date(message.created_at).getTime();
}

function isPendingTemp(message: Message): boolean {
  return isTempMessage(message) && message.status !== "failed";
}

function sameOutgoingContent(temp: Message, row: Message): boolean {
  return (
    row.sender_type === "agent" &&
    temp.sender_type === row.sender_type &&
    temp.conversation_id === row.conversation_id &&
    temp.content_type === row.content_type &&
    (temp.content_text ?? "") === (row.content_text ?? "")
  );
}

export function applyRealtimeInsert(prev: Message[], row: Message): Message[] {
  if (prev.some((m) => m.id === row.id)) return prev;
  const tempIndex = prev.findIndex(
    (m) => isPendingTemp(m) && sameOutgoingContent(m, row),
  );
  const withoutMatchedTemp =
    tempIndex >= 0 ? prev.filter((_, i) => i !== tempIndex) : prev;
  return [...withoutMatchedTemp, row];
}

export function confirmedSendUpdate(response: unknown): Partial<Message> {
  const messageId = (response as { message_id?: unknown } | null)?.message_id;
  return typeof messageId === "string" && messageId
    ? { status: "sent", id: messageId }
    : { status: "sent" };
}

export function applyMessageUpdate(
  prev: Message[],
  id: string,
  updates: Partial<Message>,
): Message[] {
  const nextId = updates.id;
  if (nextId && nextId !== id && prev.some((m) => m.id === nextId)) {
    return prev.filter((m) => m.id !== id);
  }
  return prev.map((m) => (m.id === id ? { ...m, ...updates } : m));
}

function unmatchedTemps(temps: Message[], fetched: Message[]): Message[] {
  const consumed = new Set<string>();
  return temps.filter((temp) => {
    if (temp.status === "failed") return true;
    const tempAt = createdAtMs(temp);
    const match = fetched.find(
      (row) =>
        !consumed.has(row.id) &&
        sameOutgoingContent(temp, row) &&
        createdAtMs(row) >= tempAt - RESYNC_MATCH_WINDOW_MS,
    );
    if (!match) return true;
    consumed.add(match.id);
    return false;
  });
}

export function mergeFetchedPage(
  prev: Message[],
  fetched: Message[],
  conversationId: string,
): Message[] {
  const local = prev.filter((m) => m.conversation_id === conversationId);
  const temps = local.filter(isTempMessage);
  const localReal = local.filter((m) => !isTempMessage(m));
  if (fetched.length === 0) {
    return [...localReal, ...unmatchedTemps(temps, fetched)];
  }

  const fetchedIds = new Set(fetched.map((m) => m.id));
  const oldestFetched = createdAtMs(fetched[0]);
  const newestFetched = createdAtMs(fetched[fetched.length - 1]);
  const overlapsLocal = localReal.some((m) => fetchedIds.has(m.id));

  const olderKept = overlapsLocal
    ? localReal.filter((m) => !fetchedIds.has(m.id) && createdAtMs(m) < oldestFetched)
    : [];
  const newerKept = localReal.filter(
    (m) => !fetchedIds.has(m.id) && createdAtMs(m) > newestFetched,
  );

  return [...olderKept, ...fetched, ...newerKept, ...unmatchedTemps(temps, fetched)];
}

export function prependOlderMessages(prev: Message[], older: Message[]): Message[] {
  const known = new Set(prev.map((m) => m.id));
  const fresh = older.filter((m) => !known.has(m.id));
  return fresh.length === 0 ? prev : [...fresh, ...prev];
}
