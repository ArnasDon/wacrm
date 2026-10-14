import type { ParsedContactRow } from '@/lib/contacts/parse-contact-csv';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { hasMinRole } from '@/lib/auth/roles';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
import { createTag, listTags } from './tags';
import { setContactTag } from './contacts';

export async function importContacts(
  db: SqlConnection,
  userId: string,
  rows: ParsedContactRow[]
) {
  if (rows.length > 200)
    throw new Error('Import at most 200 rows per request.');
  const ctx = await resolveAccount(db, userId);
  const result = {
    imported: 0,
    skipped: 0,
    invalidPhone: 0,
    failed: 0,
    tagsAssigned: 0,
    failedDetails: [] as { phone: string; name?: string; reason: string }[],
    skippedNames: [] as string[],
  };
  let tags = new Map(
    (await listTags(db, ctx.accountId)).map((tag) => [
      tag.name.trim().toLowerCase(),
      tag.id,
    ])
  );
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) {
      result.invalidPhone++;
      continue;
    }
    const previousTags = new Map(tags);
    await db.query('SAVEPOINT import_row');
    try {
      const [contact] = await queryRows<{ id: string }>(
        db,
        `INSERT INTO public.contacts(user_id,account_id,phone,name,email,company)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [
          userId,
          ctx.accountId,
          phone,
          row.name || null,
          row.email || null,
          row.company || null,
        ]
      );
      if (!contact) {
        result.skipped++;
        await db.query('RELEASE SAVEPOINT import_row');
        continue;
      }
      let assigned = 0;
      for (const name of new Set(
        row.tagNames.map((value) => value.trim()).filter(Boolean)
      )) {
        const key = name.toLowerCase();
        let tagId = tags.get(key);
        if (!tagId && hasMinRole(ctx.role, 'admin')) {
          tagId = (await createTag(db, userId, name, '#3b82f6')).id;
          tags.set(key, tagId);
        }
        if (!tagId) {
          if (!result.skippedNames.includes(name))
            result.skippedNames.push(name);
          continue;
        }
        if (await setContactTag(db, ctx.accountId, contact.id, tagId, true))
          assigned++;
      }
      await db.query('RELEASE SAVEPOINT import_row');
      result.imported++;
      result.tagsAssigned += assigned;
    } catch {
      await db.query('ROLLBACK TO SAVEPOINT import_row');
      await db.query('RELEASE SAVEPOINT import_row');
      tags = previousTags;
      result.failed++;
      result.failedDetails.push({
        phone: row.phone,
        name: row.name,
        reason: 'Unable to import this contact.',
      });
    }
  }
  return result;
}
