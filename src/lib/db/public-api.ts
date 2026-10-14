import type { ApiScope } from '@/lib/api-keys/scopes';
import { hasScope } from '@/lib/api-keys/scopes';
import {
  ApiError,
  badRequest,
  forbidden,
  unauthorized,
} from '@/lib/api/v1/respond';
import type { ApiContact, ContactInput } from '@/lib/api/v1/contacts';
import type { ListParams } from '@/lib/api/v1/pagination';
import type { Conversation, Message } from '@/types';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { findContactByPhone } from './contacts';
import { conversationSelect } from './inbox';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message-shared';

export interface ApiOperationIdentity {
  keyId: string;
  accountId: string;
}
/** Recheck revocation, expiry, scope, and account within each worker transaction. */
export async function authorizeApiOperation(
  db: SqlConnection,
  identity: ApiOperationIdentity,
  scope: ApiScope
) {
  const [row] = await queryRows<{ scopes: string[]; audit_user_id: string }>(
    db,
    `SELECT k.scopes,COALESCE(w.user_id,a.owner_user_id) AS audit_user_id
    FROM public.api_keys k JOIN public.accounts a ON a.id=k.account_id LEFT JOIN public.whatsapp_config w ON w.account_id=a.id
    WHERE k.id=$1 AND k.account_id=$2 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now())`,
    [identity.keyId, identity.accountId]
  );
  if (!row) throw unauthorized();
  if (!hasScope(row.scopes, scope))
    throw forbidden(`This API key is missing the '${scope}' scope`);
  return { auditUserId: row.audit_user_id };
}

const contactSelect = `SELECT jsonb_build_object('id',c.id,'phone',c.phone,'name',c.name,'email',c.email,'company',c.company,'avatar_url',c.avatar_url,'created_at',c.created_at,'updated_at',c.updated_at,
  'tags',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'color',t.color) ORDER BY t.name) FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id AND t.account_id=c.account_id WHERE ct.contact_id=c.id),'[]'::jsonb)) AS contact FROM public.contacts c`;
export async function getApiContact(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  const [row] = await queryRows<{ contact: ApiContact }>(
    db,
    `${contactSelect} WHERE c.account_id=$1 AND c.id=$2`,
    [accountId, id]
  );
  return row?.contact ?? null;
}
export async function listApiContacts(
  db: SqlConnection,
  accountId: string,
  options: ListParams & { search?: string; tag?: string | null }
) {
  const search = options.search?.trim().slice(0, 200) ?? '';
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await queryRows<{ contact: ApiContact }>(
    db,
    `${contactSelect} WHERE c.account_id=$1
    AND ($2='' OR c.name ILIKE $3 OR c.phone ILIKE $3)
    AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM public.contact_tags links JOIN public.tags t ON t.id=links.tag_id AND t.account_id=c.account_id WHERE links.contact_id=c.id AND t.id=$4))
    AND ($5::timestamptz IS NULL OR (c.created_at,c.id)<($5::timestamptz,$6::uuid))
    ORDER BY c.created_at DESC,c.id DESC LIMIT $7`,
    [
      accountId,
      search,
      pattern,
      options.tag ?? null,
      options.cursor?.createdAt ?? null,
      options.cursor?.id ?? null,
      Math.min(100, Math.max(1, options.limit)) + 1,
    ]
  );
  return rows.map((row) => row.contact);
}
export async function findOrCreateApiContact(
  db: SqlConnection,
  accountId: string,
  auditUserId: string,
  input: ContactInput
) {
  const phone = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(phone))
    throw badRequest(
      "'phone' must be a valid phone number in E.164 format (e.g. +14155550123)"
    );
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${accountId}:phone:${phone.slice(-8)}`,
  ]);
  const existing = await findContactByPhone(db, accountId, phone);
  if (existing) return { id: existing.id, created: false };
  const [created] = await queryRows<{ id: string }>(
    db,
    `INSERT INTO public.contacts(user_id,account_id,phone,name,email,company)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
    [
      auditUserId,
      accountId,
      phone,
      input.name ?? phone,
      input.email ?? null,
      input.company ?? null,
    ]
  );
  if (created) return { id: created.id, created: true };
  const raced = await findContactByPhone(db, accountId, phone);
  if (!raced) throw new ApiError('internal', 'Failed to create contact', 500);
  return { id: raced.id, created: false };
}
export async function replaceApiTags(
  db: SqlConnection,
  accountId: string,
  auditUserId: string,
  contactId: string,
  names: string[]
) {
  if (names.length > 100 || names.some((name) => name.length > 100))
    throw badRequest(
      'Provide at most 100 tags, with names up to 100 characters.'
    );
  if (
    !(
      await queryRows(
        db,
        'SELECT id FROM public.contacts WHERE account_id=$1 AND id=$2 FOR UPDATE',
        [accountId, contactId]
      )
    ).length
  )
    throw new ApiError('not_found', 'Contact not found', 404);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${accountId}:tags`,
  ]);
  const desired = new Set<string>();
  for (const name of names.map((name) => name.trim()).filter(Boolean)) {
    const [existing] = await queryRows<{ id: string }>(
      db,
      'SELECT id FROM public.tags WHERE account_id=$1 AND lower(name)=lower($2) ORDER BY id LIMIT 1',
      [accountId, name]
    );
    const tag =
      existing ??
      (
        await queryRows<{ id: string }>(
          db,
          'INSERT INTO public.tags(user_id,account_id,name) VALUES($1,$2,$3) RETURNING id',
          [auditUserId, accountId, name]
        )
      )[0];
    desired.add(tag.id);
  }
  await db.query(
    'DELETE FROM public.contact_tags WHERE contact_id=$1 AND NOT(tag_id=ANY($2::uuid[]))',
    [contactId, [...desired]]
  );
  const added: string[] = [];
  for (const tagId of desired) {
    if (
      (
        await queryRows(
          db,
          'INSERT INTO public.contact_tags(contact_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
          [contactId, tagId]
        )
      ).length
    )
      added.push(tagId);
  }
  return added;
}
export async function resolveApiConversation(
  db: SqlConnection,
  accountId: string,
  auditUserId: string,
  phone: string,
  name: string | null
) {
  if (
    !(
      await queryRows(
        db,
        'SELECT id FROM public.whatsapp_config WHERE account_id=$1',
        [accountId]
      )
    ).length
  )
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  const contact = await findOrCreateApiContact(db, accountId, auditUserId, {
    phone,
    name,
  });
  await db.query(
    'SELECT id FROM public.contacts WHERE id=$1 AND account_id=$2 FOR UPDATE',
    [contact.id, accountId]
  );
  if (name && !contact.created)
    await db.query(
      'UPDATE public.contacts SET name=$1,updated_at=now() WHERE id=$2 AND account_id=$3',
      [name, contact.id, accountId]
    );
  const [existing] = await queryRows<{ id: string }>(
    db,
    'SELECT id FROM public.conversations WHERE account_id=$1 AND contact_id=$2 ORDER BY created_at,id LIMIT 1',
    [accountId, contact.id]
  );
  const conversation =
    existing ??
    (
      await queryRows<{ id: string }>(
        db,
        'INSERT INTO public.conversations(user_id,account_id,contact_id) VALUES($1,$2,$3) RETURNING id',
        [auditUserId, accountId, contact.id]
      )
    )[0];
  return {
    conversationId: conversation.id,
    contactId: contact.id,
    contactCreated: contact.created,
  };
}
export async function listApiConversations(
  db: SqlConnection,
  accountId: string,
  options: ListParams & { status?: string | null; contactId?: string | null }
) {
  const rows = await queryRows<{ conversation: Conversation }>(
    db,
    `${conversationSelect} WHERE c.account_id=$1
    AND ($2::text IS NULL OR c.status=$2) AND ($3::uuid IS NULL OR c.contact_id=$3)
    AND ($4::timestamptz IS NULL OR (c.created_at,c.id)<($4::timestamptz,$5::uuid))
    ORDER BY c.created_at DESC,c.id DESC LIMIT $6`,
    [
      accountId,
      options.status ?? null,
      options.contactId ?? null,
      options.cursor?.createdAt ?? null,
      options.cursor?.id ?? null,
      Math.min(100, Math.max(1, options.limit)) + 1,
    ]
  );
  return rows.map((row) => row.conversation);
}
export async function listApiMessages(
  db: SqlConnection,
  accountId: string,
  conversationId: string,
  options: ListParams
) {
  if (
    !(
      await queryRows(
        db,
        'SELECT id FROM public.conversations WHERE account_id=$1 AND id=$2',
        [accountId, conversationId]
      )
    ).length
  )
    throw new ApiError('not_found', 'Conversation not found', 404);
  return (
    await queryRows<{ message: Message }>(
      db,
      `SELECT to_jsonb(m) AS message FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE c.account_id=$1 AND c.id=$2 AND ($3::timestamptz IS NULL OR (m.created_at,m.id)<($3::timestamptz,$4::uuid))
    ORDER BY m.created_at DESC,m.id DESC LIMIT $5`,
      [
        accountId,
        conversationId,
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        Math.min(100, Math.max(1, options.limit)) + 1,
      ]
    )
  ).map((row) => row.message);
}
