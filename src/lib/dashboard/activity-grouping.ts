import type { ActivityItem } from './types';

export const INCOMING_MESSAGE_GROUP_WINDOW_MS = 15 * 60 * 1000;

export interface IncomingMessageActivity {
  id: string;
  conversationId: string;
  contactLabel: string;
  at: string;
}

interface IncomingMessageGroup {
  latest: IncomingMessageActivity;
  latestAtMs: number;
  count: number;
}

export function groupIncomingMessages(
  messages: IncomingMessageActivity[]
): ActivityItem[] {
  const sorted = [...messages].sort((a, b) => {
    const aMs = Date.parse(a.at);
    const bMs = Date.parse(b.at);
    if (Number.isNaN(aMs) || Number.isNaN(bMs)) {
      return a.at > b.at ? -1 : a.at < b.at ? 1 : 0;
    }
    return bMs - aMs;
  });

  const groups: IncomingMessageGroup[] = [];
  const activeGroupByConversation = new Map<string, IncomingMessageGroup>();

  for (const message of sorted) {
    const atMs = Date.parse(message.at);
    const activeGroup = activeGroupByConversation.get(message.conversationId);
    const belongsToActiveGroup =
      activeGroup &&
      !Number.isNaN(atMs) &&
      activeGroup.latestAtMs - atMs <= INCOMING_MESSAGE_GROUP_WINDOW_MS;

    if (belongsToActiveGroup) {
      activeGroup.count += 1;
      continue;
    }

    const group: IncomingMessageGroup = {
      latest: message,
      latestAtMs: atMs,
      count: 1,
    };
    groups.push(group);
    if (!Number.isNaN(atMs)) {
      activeGroupByConversation.set(message.conversationId, group);
    }
  }

  return groups.map(({ latest, count }) => ({
    id: `msg-${latest.id}`,
    kind: 'message',
    text:
      count === 1
        ? `New message from ${latest.contactLabel}`
        : `${count} new messages from ${latest.contactLabel}`,
    at: latest.at,
    href: `/inbox?c=${encodeURIComponent(latest.conversationId)}`,
  }));
}
