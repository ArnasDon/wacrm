import type { Conversation, Message, MessageReaction } from '@/types';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { RecordNotFoundError } from './errors';
export const conversationSelect = `SELECT to_jsonb(c) || jsonb_build_object('contact', CASE WHEN ct.id IS NULL THEN NULL ELSE to_jsonb(ct) || jsonb_build_object('tags',COALESCE((
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM public.contact_tags links JOIN public.tags t ON t.id=links.tag_id AND t.account_id=c.account_id WHERE links.contact_id=ct.id
), '[]'::jsonb)) END) AS conversation FROM public.conversations c LEFT JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=c.account_id`;
export async function listConversations(db: SqlConnection, accountId: string) {
  return (
    await queryRows<{ conversation: Conversation }>(
      db,
      `${conversationSelect} WHERE c.account_id=$1 ORDER BY c.last_message_at DESC NULLS LAST,c.id`,
      [accountId]
    )
  ).map((row) => row.conversation);
}
export async function getConversation(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  const [row] = await queryRows<{ conversation: Conversation }>(
    db,
    `${conversationSelect} WHERE c.account_id=$1 AND c.id=$2`,
    [accountId, id]
  );
  return row?.conversation ?? null;
}
export async function listMessages(
  db: SqlConnection,
  accountId: string,
  conversationId: string
) {
  return (
    await queryRows<{ message: Message }>(
      db,
      `SELECT to_jsonb(m) AS message FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE c.account_id=$1 AND c.id=$2 ORDER BY m.created_at,m.id`,
      [accountId, conversationId]
    )
  ).map((row) => row.message);
}
export async function pollMessages(
  db: SqlConnection,
  accountId: string,
  conversationId: string | null
) {
  return (
    await queryRows<{ message: Message }>(
      db,
      `SELECT to_jsonb(m) AS message FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE c.account_id=$1 AND (m.conversation_id=$2 OR m.created_at>=now()-interval '5 minutes') ORDER BY m.created_at,m.id`,
      [accountId, conversationId]
    )
  ).map((row) => row.message);
}
export async function listReactions(
  db: SqlConnection,
  accountId: string,
  conversationId: string
) {
  return (
    await queryRows<{ reaction: MessageReaction }>(
      db,
      `SELECT to_jsonb(r) AS reaction FROM public.message_reactions r JOIN public.conversations c ON c.id=r.conversation_id
    WHERE c.account_id=$1 AND c.id=$2 ORDER BY r.id`,
      [accountId, conversationId]
    )
  ).map((row) => row.reaction);
}
export async function updateConversation(
  db: SqlConnection,
  accountId: string,
  id: string,
  input: Partial<
    Pick<Conversation, 'status' | 'assigned_agent_id' | 'unread_count'>
  >
) {
  const valid = await getConversation(db, accountId, id);
  if (!valid) throw new RecordNotFoundError('Conversation not found.');
  if (
    input.assigned_agent_id &&
    !(
      await queryRows(
        db,
        "SELECT id FROM public.profiles WHERE account_id=$1 AND user_id=$2 AND account_role IN ('owner','admin','agent')",
        [accountId, input.assigned_agent_id]
      )
    ).length
  )
    throw new RecordNotFoundError('Assignee not found.');
  const keys = (
    ['status', 'assigned_agent_id', 'unread_count'] as const
  ).filter((key) => Object.hasOwn(input, key));
  if (keys.length)
    await db.query(
      `UPDATE public.conversations SET ${keys.map((key, i) => `${key}=$${i + 3}`).join(',')},updated_at=now() WHERE account_id=$1 AND id=$2`,
      [accountId, id, ...keys.map((key) => input[key] ?? null)]
    );
  return getConversation(db, accountId, id);
}
