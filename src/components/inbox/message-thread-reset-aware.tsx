"use client";

import { useMemo } from "react";
import type { ComponentProps } from "react";
import type { Conversation, Message } from "@/types";
import { MessageThread as BaseMessageThread } from "./message-thread";

type MessageThreadProps = ComponentProps<typeof BaseMessageThread>;
type ResetAwareConversation = Conversation & {
  ai_context_reset_at?: string | null;
};

function messagesAfterReset(messages: Message[], resetAt: string | null): Message[] {
  if (!resetAt) return messages;

  const resetTime = Date.parse(resetAt);
  if (!Number.isFinite(resetTime)) return messages;

  return messages.filter((message) => {
    const createdAt = Date.parse(message.created_at);
    return Number.isFinite(createdAt) && createdAt >= resetTime;
  });
}

/**
 * Inbox adapter that keeps the WhatsApp audit trail in the database while
 * presenting each AI context reset as a visually fresh conversation.
 *
 * The underlying MessageThread can keep fetching the complete message history;
 * this boundary removes messages older than `ai_context_reset_at` both from the
 * current parent state and from subsequent refetches. Realtime conversation
 * UPDATEs carry the reset timestamp, so pressing "Reiniciar conversa" clears
 * the visible thread as soon as that database update reaches the Inbox.
 */
export function MessageThread(props: MessageThreadProps) {
  const resetAt =
    (props.conversation as ResetAwareConversation | null)?.ai_context_reset_at ??
    null;

  const visibleMessages = useMemo(
    () => messagesAfterReset(props.messages, resetAt),
    [props.messages, resetAt],
  );

  const handleMessagesLoaded: MessageThreadProps["onMessagesLoaded"] = (
    messages,
  ) => {
    props.onMessagesLoaded(messagesAfterReset(messages, resetAt));
  };

  return (
    <BaseMessageThread
      {...props}
      messages={visibleMessages}
      onMessagesLoaded={handleMessagesLoaded}
    />
  );
}
