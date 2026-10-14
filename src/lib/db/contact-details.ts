import type { ContactCustomValue, ContactNote, CustomField } from '@/types';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
import { getContact } from './contacts';
import { RecordNotFoundError } from './errors';

export function listCustomFields(
  db: SqlConnection,
  accountId: string
): Promise<CustomField[]> {
  return queryRows(
    db,
    'SELECT * FROM public.custom_fields WHERE account_id=$1 ORDER BY field_name,id',
    [accountId]
  );
}
export async function createCustomField(
  db: SqlConnection,
  userId: string,
  name: string
): Promise<CustomField> {
  const ctx = await resolveAccount(db, userId);
  const [field] = await queryRows<CustomField>(
    db,
    "INSERT INTO public.custom_fields(user_id,account_id,field_name,field_type) VALUES ($1,$2,$3,'text') RETURNING *",
    [userId, ctx.accountId, name.trim()]
  );
  return field;
}
export async function renameCustomField(
  db: SqlConnection,
  accountId: string,
  id: string,
  name: string
): Promise<boolean> {
  return (
    (
      await queryRows(
        db,
        'UPDATE public.custom_fields SET field_name=$1 WHERE account_id=$2 AND id=$3 RETURNING id',
        [name.trim(), accountId, id]
      )
    ).length > 0
  );
}
export async function deleteCustomField(
  db: SqlConnection,
  accountId: string,
  id: string
): Promise<boolean> {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.custom_fields WHERE account_id=$1 AND id=$2 RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
export function getCustomValues(
  db: SqlConnection,
  accountId: string,
  contactId: string
): Promise<ContactCustomValue[]> {
  return queryRows(
    db,
    `SELECT v.* FROM public.contact_custom_values v JOIN public.contacts c ON c.id=v.contact_id
    JOIN public.custom_fields f ON f.id=v.custom_field_id WHERE c.account_id=$1 AND f.account_id=$1 AND c.id=$2`,
    [accountId, contactId]
  );
}
/** Call inside a scoped transaction: validate the full replacement before deleting. */
export async function setCustomValues(
  db: SqlConnection,
  accountId: string,
  contactId: string,
  input: Record<string, string>
): Promise<void> {
  if (!(await getContact(db, accountId, contactId)))
    throw new RecordNotFoundError('Contact not found.');
  const fields = Object.keys(input);
  if (fields.length > 100) throw new Error('Too many custom fields.');
  if (fields.length) {
    const owned = await queryRows(
      db,
      'SELECT id FROM public.custom_fields WHERE account_id=$1 AND id=ANY($2::uuid[])',
      [accountId, fields]
    );
    if (owned.length !== fields.length)
      throw new RecordNotFoundError('Custom field not found.');
  }
  await db.query(
    'DELETE FROM public.contact_custom_values WHERE contact_id=$1',
    [contactId]
  );
  const values = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value.trim() !== '')
  );
  await db.query(
    `INSERT INTO public.contact_custom_values(contact_id,custom_field_id,value)
    SELECT $1,e.key::uuid,e.value FROM jsonb_each_text($2::jsonb) e`,
    [contactId, JSON.stringify(values)]
  );
}
export function listNotes(
  db: SqlConnection,
  accountId: string,
  contactId: string
): Promise<ContactNote[]> {
  return queryRows(
    db,
    `SELECT n.* FROM public.contact_notes n JOIN public.contacts c ON c.id=n.contact_id
    WHERE n.account_id=$1 AND c.account_id=$1 AND c.id=$2 ORDER BY n.created_at DESC,n.id DESC`,
    [accountId, contactId]
  );
}
export async function addNote(
  db: SqlConnection,
  userId: string,
  contactId: string,
  text: string
): Promise<ContactNote> {
  const ctx = await resolveAccount(db, userId);
  if (!(await getContact(db, ctx.accountId, contactId)))
    throw new RecordNotFoundError('Contact not found.');
  const [note] = await queryRows<ContactNote>(
    db,
    'INSERT INTO public.contact_notes(user_id,account_id,contact_id,note_text) VALUES ($1,$2,$3,$4) RETURNING *',
    [userId, ctx.accountId, contactId, text.trim()]
  );
  return note;
}
export async function deleteNote(
  db: SqlConnection,
  accountId: string,
  contactId: string,
  id: string
): Promise<boolean> {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.contact_notes WHERE account_id=$1 AND contact_id=$2 AND id=$3 RETURNING id',
        [accountId, contactId, id]
      )
    ).length > 0
  );
}
