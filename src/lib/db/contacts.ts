import type { Contact, Tag } from '@/types';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';
import type { SqlConnection } from './transaction';
import { resolveAccount } from './context-core';
import { queryRows } from './rows';
import { RecordNotFoundError } from './errors';

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}
export interface ContactListOptions {
  search?: string;
  tagIds?: string[];
  offset?: number;
  limit?: number;
}

export async function listContacts(
  db: SqlConnection,
  accountId: string,
  options: ContactListOptions = {}
) {
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 25)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const search = options.search?.trim().slice(0, 200) ?? '';
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const tags = options.tagIds ?? [];
  const where = `c.account_id=$1 AND ($2='' OR c.name ILIKE $3 OR c.phone ILIKE $3 OR c.email ILIKE $3 OR c.company ILIKE $3)
    AND (cardinality($4::uuid[])=0 OR EXISTS (SELECT 1 FROM public.contact_tags ct WHERE ct.contact_id=c.id AND ct.tag_id=ANY($4::uuid[])))`;
  const [count] = await queryRows<{ total: number }>(
    db,
    `SELECT count(*)::int AS total FROM public.contacts c WHERE ${where}`,
    [accountId, search, pattern, tags]
  );
  const rows = await queryRows<{ contact: Contact }>(
    db,
    `SELECT to_jsonb(c) || jsonb_build_object('tags', COALESCE((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
    WHERE ct.contact_id=c.id AND t.account_id=c.account_id), '[]'::jsonb)) AS contact
    FROM public.contacts c WHERE ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT $5 OFFSET $6`,
    [accountId, search, pattern, tags, limit, offset]
  );
  return { contacts: rows.map((row) => row.contact), total: count.total };
}

export async function getContact(
  db: SqlConnection,
  accountId: string,
  id: string
): Promise<Contact | null> {
  const [row] = await queryRows<{ contact: Contact }>(
    db,
    'SELECT to_jsonb(c) AS contact FROM public.contacts c WHERE account_id=$1 AND id=$2',
    [accountId, id]
  );
  return row?.contact ?? null;
}

export async function findContactByPhone(
  db: SqlConnection,
  accountId: string,
  phone: string
): Promise<Contact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const rows = await queryRows<{ contact: Contact }>(
    db,
    'SELECT to_jsonb(c) AS contact FROM public.contacts c WHERE account_id=$1 AND phone_normalized LIKE $2 LIMIT 20',
    [accountId, `%${normalized.slice(-8)}`]
  );
  return (
    rows
      .map((row) => row.contact)
      .find((contact) => phonesMatch(contact.phone, phone)) ?? null
  );
}

function validatePhone(phone: string) {
  if (typeof phone !== 'string' || !normalizePhone(phone) || phone.length > 100)
    throw new Error('A valid phone number is required.');
}

export async function createContact(
  db: SqlConnection,
  userId: string,
  input: ContactInput
): Promise<Contact> {
  validatePhone(input.phone);
  const ctx = await resolveAccount(db, userId);
  const [row] = await queryRows<{ contact: Contact }>(
    db,
    `WITH inserted AS (
    INSERT INTO public.contacts(user_id,account_id,phone,name,email,company) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  ) SELECT to_jsonb(inserted) AS contact FROM inserted`,
    [
      userId,
      ctx.accountId,
      input.phone.trim(),
      input.name ?? null,
      input.email ?? null,
      input.company ?? null,
    ]
  );
  return row.contact;
}

export async function updateContact(
  db: SqlConnection,
  accountId: string,
  id: string,
  input: Partial<ContactInput>
): Promise<Contact | null> {
  const columns = ['phone', 'name', 'email', 'company'] as const;
  const fields = columns.filter((key) => Object.hasOwn(input, key));
  if (!fields.length) return getContact(db, accountId, id);
  if (fields.includes('phone')) validatePhone(input.phone!);
  const values: unknown[] = [
    accountId,
    id,
    ...fields.map((key) => input[key] ?? null),
  ];
  const updates = fields.map((key, index) => `${key}=$${index + 3}`).join(',');
  const [row] = await queryRows<{ contact: Contact }>(
    db,
    `WITH updated AS (
    UPDATE public.contacts SET ${updates} WHERE account_id=$1 AND id=$2 RETURNING *
  ) SELECT to_jsonb(updated) AS contact FROM updated`,
    values
  );
  return row?.contact ?? null;
}

export async function deleteContacts(
  db: SqlConnection,
  accountId: string,
  ids: string[]
): Promise<number> {
  if (ids.length > 200)
    throw new Error('Delete at most 200 contacts at a time.');
  return (
    await queryRows(
      db,
      'DELETE FROM public.contacts WHERE account_id=$1 AND id=ANY($2::uuid[]) RETURNING id',
      [accountId, ids]
    )
  ).length;
}

export async function listContactTags(
  db: SqlConnection,
  accountId: string,
  contactId: string
): Promise<Tag[]> {
  return queryRows(
    db,
    `SELECT t.* FROM public.tags t JOIN public.contact_tags ct ON ct.tag_id=t.id
    JOIN public.contacts c ON c.id=ct.contact_id WHERE c.id=$1 AND c.account_id=$2 AND t.account_id=$2 ORDER BY t.name`,
    [contactId, accountId]
  );
}

/** Both ownership checks are in the mutation, protecting against forged pairs. */
export async function setContactTag(
  db: SqlConnection,
  accountId: string,
  contactId: string,
  tagId: string,
  add: boolean
): Promise<boolean> {
  const valid = await queryRows(
    db,
    'SELECT c.id FROM public.contacts c JOIN public.tags t ON t.account_id=c.account_id WHERE c.account_id=$1 AND c.id=$2 AND t.id=$3',
    [accountId, contactId, tagId]
  );
  if (!valid.length) throw new RecordNotFoundError('Contact or tag not found.');
  if (add)
    return (
      (
        await queryRows(
          db,
          `INSERT INTO public.contact_tags(contact_id,tag_id) VALUES ($1,$2) ON CONFLICT (contact_id,tag_id) DO NOTHING RETURNING id`,
          [contactId, tagId]
        )
      ).length > 0
    );
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.contact_tags WHERE contact_id=$1 AND tag_id=$2 RETURNING id',
        [contactId, tagId]
      )
    ).length > 0
  );
}
