import type { SqlConnection } from '@/lib/db/transaction';
import { queryRows } from '@/lib/db/rows';
import type { ChatMessage } from './types';
import { aiContextMessageLimit } from './defaults';

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot';
  content_text: string | null;
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Non-text messages (media,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SqlConnection,
  accountId: string,
  conversationId: string,
  limit: number = aiContextMessageLimit()
): Promise<ChatMessage[]> {
  const data = await queryRows<DbMessage>(
    db,
    "SELECT m.sender_type,m.content_text FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND m.conversation_id=$2 AND m.content_type='text' ORDER BY m.created_at DESC,m.id DESC LIMIT $3",
    [accountId, conversationId, Math.min(100, Math.max(1, limit))]
  );
  const rows = data.reverse();
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_text!.trim(),
    }));
}
