import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { findContactByPhone } from './contacts';
import {
  hasUsableIdentity,
  identityDisplayName,
  type WaIdentity,
} from '@/lib/whatsapp/wa-identity';

/** Called only by the signature-verified Meta worker, with the receiving configuration's account. */
export async function resolveInboundThread(
  db: SqlConnection,
  accountId: string,
  userId: string,
  identity: WaIdentity
) {
  if (!hasUsableIdentity(identity)) throw new Error('Missing sender identity');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `inbound-identity:${accountId}`,
  ]);
  const lookup = async () => {
    const [bsuid] = identity.waUserId
      ? await queryRows<{ id: string }>(
          db,
          'SELECT id FROM public.contacts WHERE account_id=$1 AND wa_user_id=$2',
          [accountId, identity.waUserId]
        )
      : [];
    return (
      bsuid ??
      (identity.phone
        ? await findContactByPhone(db, accountId, identity.phone)
        : null)
    );
  };
  let contact = await lookup();
  let contactCreated = false;
  if (!contact) {
    const [created] = await queryRows<{ id: string }>(
      db,
      `INSERT INTO public.contacts(account_id,user_id,phone,name,wa_user_id,wa_parent_user_id,wa_username) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
      [
        accountId,
        userId,
        identity.phone,
        identityDisplayName(identity),
        identity.waUserId,
        identity.waParentUserId,
        identity.waUsername,
      ]
    );
    contact = created ?? (await lookup());
    contactCreated = !!created;
  }
  if (!contact) throw new Error('Unable to resolve inbound contact');
  // Fill withheld identity fields when Meta reveals them; preserve a known phone.
  await db.query(
    `UPDATE public.contacts SET name=COALESCE(NULLIF($3,''),name),phone=CASE WHEN phone='' AND NOT EXISTS(SELECT 1 FROM public.contacts other WHERE other.account_id=$1 AND other.id<>$2 AND other.phone_normalized=regexp_replace($4::text, '\D', '', 'g') AND other.phone_normalized<>'') THEN $4 ELSE phone END,wa_user_id=COALESCE($5,wa_user_id),wa_parent_user_id=COALESCE($6,wa_parent_user_id),wa_username=COALESCE($7,wa_username) WHERE account_id=$1 AND id=$2`,
    [
      accountId,
      contact.id,
      identity.name || identity.waUsername || '',
      identity.phone,
      identity.waUserId,
      identity.waParentUserId,
      identity.waUsername,
    ]
  );
  await db.query(
    'SELECT id FROM public.contacts WHERE account_id=$1 AND id=$2 FOR UPDATE',
    [accountId, contact.id]
  );
  let [conversation] = await queryRows<{ id: string }>(
    db,
    'SELECT id FROM public.conversations WHERE account_id=$1 AND contact_id=$2 ORDER BY created_at,id LIMIT 1',
    [accountId, contact.id]
  );
  const conversationCreated = !conversation;
  if (!conversation)
    [conversation] = await queryRows<{ id: string }>(
      db,
      'INSERT INTO public.conversations(account_id,user_id,contact_id) VALUES($1,$2,$3) RETURNING id',
      [accountId, userId, contact.id]
    );
  return {
    contactId: contact.id,
    conversationId: conversation.id,
    contactCreated,
    conversationCreated,
  };
}
export interface InboundMessageInput {
  metaId: string;
  timestamp: string;
  contentType: string;
  text: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  interactiveReplyId: string | null;
  replyMetaId: string | null;
}
export async function insertInboundMessage(
  db: SqlConnection,
  accountId: string,
  conversationId: string,
  input: InboundMessageInput
) {
  const [conversation] = await queryRows<{ contact_id: string }>(
    db,
    'SELECT contact_id FROM public.conversations WHERE account_id=$1 AND id=$2 FOR UPDATE',
    [accountId, conversationId]
  );
  if (!conversation) throw new Error('Inbound conversation not found');
  const [prior] = await queryRows<{ found: boolean }>(
    db,
    "SELECT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=$1 AND sender_type='customer') AS found",
    [conversationId]
  );
  const [inserted] = await queryRows<{ id: string }>(
    db,
    `INSERT INTO public.messages(conversation_id,sender_type,content_type,content_text,media_url,media_type,message_id,status,created_at,reply_to_message_id,interactive_reply_id)
 VALUES($1,'customer',$2,$3,$4,$5,$6,'delivered',$7,(SELECT id FROM public.messages WHERE conversation_id=$1 AND message_id=$8 LIMIT 1),$9)
 ON CONFLICT(conversation_id,message_id) DO NOTHING RETURNING id`,
    [
      conversationId,
      input.contentType,
      input.text,
      input.mediaUrl,
      input.mediaType,
      input.metaId,
      input.timestamp,
      input.replyMetaId,
      input.interactiveReplyId,
    ]
  );
  if (!inserted) return null;
  await db.query(
    `UPDATE public.conversations SET unread_count=COALESCE(unread_count,0)+1,last_message_text=$3,last_message_at=now(),status=CASE WHEN status='closed' THEN 'open' ELSE status END WHERE account_id=$1 AND id=$2`,
    [accountId, conversationId, input.text || `[${input.contentType}]`]
  );
  await db.query(
    `UPDATE public.broadcast_recipients SET status='replied',replied_at=now() WHERE id=(SELECT r.id FROM public.broadcast_recipients r JOIN public.broadcasts b ON b.id=r.broadcast_id WHERE b.account_id=$1 AND r.contact_id=$2 AND r.status IN ('sent','delivered','read') ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AND status IN ('sent','delivered','read')`,
    [accountId, conversation.contact_id]
  );
  return { id: inserted.id, firstInbound: !prior.found };
}
export async function saveInboundReaction(
  db: SqlConnection,
  accountId: string,
  conversationId: string,
  contactId: string,
  metaId: string,
  emoji: string
) {
  const [target] = await queryRows<{ id: string }>(
    db,
    'SELECT m.id FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND c.id=$2 AND c.contact_id=$3 AND m.message_id=$4 LIMIT 1',
    [accountId, conversationId, contactId, metaId]
  );
  if (!target) return;
  if (!emoji)
    await db.query(
      "DELETE FROM public.message_reactions WHERE message_id=$1 AND actor_type='customer' AND actor_id=$2",
      [target.id, contactId]
    );
  else
    await db.query(
      "INSERT INTO public.message_reactions(message_id,conversation_id,actor_type,actor_id,emoji) VALUES($1,$2,'customer',$3,$4) ON CONFLICT(message_id,actor_type,actor_id) DO UPDATE SET emoji=EXCLUDED.emoji",
      [target.id, conversationId, contactId, emoji]
    );
}
export interface InboundStatus {
  id: string;
  status: string;
  timestamp: string;
  errors?: { code: number; title: string; error_data?: { details?: string } }[];
}
const ladder = ['sending', 'pending', 'sent', 'delivered', 'read', 'replied'];
function canAdvance(current: string, incoming: string) {
  if (incoming === 'failed')
    return ['sending', 'pending', 'sent'].includes(current);
  return (
    current !== 'failed' &&
    ladder.includes(incoming) &&
    ladder.indexOf(incoming) > ladder.indexOf(current)
  );
}
export async function updateInboundStatus(
  db: SqlConnection,
  accountId: string,
  input: InboundStatus
) {
  if (!['sent', 'delivered', 'read', 'failed'].includes(input.status))
    return [];
  const failure = input.status === 'failed' ? input.errors?.[0] : undefined;
  const messages = await queryRows<{
    id: string;
    conversation_id: string;
    status: string;
  }>(
    db,
    'SELECT m.id,m.conversation_id,m.status FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND m.message_id=$2 FOR UPDATE OF m',
    [accountId, input.id]
  );
  const changed = [];
  for (const row of messages)
    if (canAdvance(row.status, input.status)) {
      await db.query(
        'UPDATE public.messages SET status=$2,error_code=COALESCE($3,error_code),error_title=COALESCE($4,error_title),error_details=COALESCE($5,error_details) WHERE id=$1',
        [
          row.id,
          input.status,
          failure?.code ?? null,
          failure?.title ?? null,
          failure?.error_data?.details ?? null,
        ]
      );
      changed.push({ conversationId: row.conversation_id });
    }
  const recipients = await queryRows<{ id: string; status: string }>(
    db,
    'SELECT r.id,r.status FROM public.broadcast_recipients r JOIN public.broadcasts b ON b.id=r.broadcast_id WHERE b.account_id=$1 AND r.whatsapp_message_id=$2 FOR UPDATE OF r',
    [accountId, input.id]
  );
  const timestamp = new Date(Number(input.timestamp) * 1000).toISOString();
  for (const row of recipients)
    if (canAdvance(row.status, input.status)) {
      await db.query(
        `UPDATE public.broadcast_recipients SET status=$2,sent_at=CASE WHEN $2='sent' THEN $3::timestamptz ELSE sent_at END,delivered_at=CASE WHEN $2='delivered' THEN $3::timestamptz ELSE delivered_at END,read_at=CASE WHEN $2='read' THEN $3::timestamptz ELSE read_at END,error_message=COALESCE($4,error_message) WHERE id=$1`,
        [
          row.id,
          input.status,
          timestamp,
          failure
            ? `[${failure.code}] ${failure.title}${failure.error_data?.details ? `: ${failure.error_data.details}` : ''}`
            : null,
        ]
      );
    }
  return changed;
}
export async function readInboundMediaToken(
  db: SqlConnection,
  accountId: string,
  mediaId: string
): Promise<string | null> {
  const [row] = await queryRows<{ access_token: string }>(
    db,
    `SELECT w.access_token FROM public.whatsapp_config w WHERE w.account_id=$1 AND EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND m.media_url=$2)`,
    [accountId, `/api/whatsapp/media/${mediaId}`]
  );
  return row?.access_token ?? null;
}
