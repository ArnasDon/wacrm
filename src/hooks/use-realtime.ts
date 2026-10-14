'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import type { Message, Conversation } from '@/types';
import { startPolling } from '@/lib/api/polling';
import { snapshotEvents, type SnapshotEvent } from '@/lib/inbox/poll-events';
import { useAuth } from './use-auth';
interface UseRealtimeOptions {
  channelName: string;
  conversationId?: string;
  onMessageEvent?: (event: SnapshotEvent<Message>) => void;
  onConversationEvent?: (event: SnapshotEvent<Conversation>) => void;
  enabled?: boolean;
  pollWhenHidden?: boolean;
}
export function useRealtime({
  channelName,
  conversationId,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
  pollWhenHidden = false,
}: UseRealtimeOptions) {
  const { accountId, user } = useAuth();
  const key =
    channelName + ':' + accountId + ':' + user?.id + ':' + conversationId;
  const [connection, setConnection] = useState<{
    key: string;
    connected: boolean;
  } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const messageRef = useRef(onMessageEvent);
  const conversationRef = useRef(onConversationEvent);
  useEffect(() => {
    messageRef.current = onMessageEvent;
    conversationRef.current = onConversationEvent;
  });
  useEffect(() => {
    if (!enabled || !accountId) return;
    let previousMessages: Message[] | null = null;
    let previousConversations: Conversation[] | null = null;
    const query = conversationId
      ? '?conversationId=' + encodeURIComponent(conversationId)
      : '';
    const polling = startPolling(
      async (signal) => {
        const response = await fetch('/api/inbox/poll' + query, {
          cache: 'no-store',
          signal,
        });
        if (!response.ok) throw new Error('Inbox refresh failed.');
        return (await response.json()) as {
          messages: Message[];
          conversations: Conversation[];
        };
      },
      (data) => {
        for (const event of snapshotEvents(previousMessages, data.messages))
          messageRef.current?.(event);
        for (const event of snapshotEvents(
          previousConversations,
          data.conversations,
          true
        ))
          conversationRef.current?.(event);
        previousMessages = data.messages;
        previousConversations = data.conversations;
        setConnection({ key, connected: true });
      },
      () => setConnection({ key, connected: false }),
      conversationId ? 3000 : 10000,
      () => pollWhenHidden || !document.hidden
    );
    stopRef.current = polling.stop;
    const refresh = () => polling.refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      polling.stop();
      stopRef.current = null;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, accountId, conversationId, key, pollWhenHidden]);
  const unsubscribe = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setConnection(null);
  }, []);
  return {
    isConnected: enabled && connection?.key === key && connection.connected,
    unsubscribe,
  };
}
