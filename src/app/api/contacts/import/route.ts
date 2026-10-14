import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import { importContacts } from '@/lib/db/contact-import';
import type { ParsedContactRow } from '@/lib/contacts/parse-contact-csv';

export function POST(request: Request) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const { rows } = await readObject(request);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200)
      throw new RequestError('Supply between 1 and 200 contacts.');
    const validated: ParsedContactRow[] = rows.map((row) => {
      if (
        !row ||
        typeof row !== 'object' ||
        typeof row.phone !== 'string' ||
        row.phone.length > 100
      )
        throw new RequestError('Invalid contact phone.');
      for (const key of ['name', 'email', 'company']) {
        if (
          row[key] !== undefined &&
          (typeof row[key] !== 'string' || row[key].length > 500)
        )
          throw new RequestError('Invalid contact field.');
      }
      if (
        !Array.isArray(row.tagNames) ||
        row.tagNames.length > 50 ||
        row.tagNames.some(
          (name: unknown) => typeof name !== 'string' || name.length > 40
        )
      )
        throw new RequestError('Invalid contact tags.');
      return {
        phone: row.phone,
        name: row.name,
        email: row.email,
        company: row.company,
        tagNames: row.tagNames,
      };
    });
    return importContacts(db, ctx.userId, validated);
  });
}
