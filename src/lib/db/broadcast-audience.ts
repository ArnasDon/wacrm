import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { RequestError, requireUUID } from '@/lib/api/local-route';
import type { AudienceConfig } from '@/lib/broadcast-audience';
import type { Contact } from '@/types';
import { findOrCreateApiContact } from './public-api';
export function parseAudience(value: unknown): AudienceConfig {
  if (!value || typeof value !== 'object')
    throw new RequestError('Audience is required.');
  const raw = value as AudienceConfig;
  if (!['all', 'tags', 'custom_field', 'csv'].includes(raw.type))
    throw new RequestError('Invalid audience.');
  for (const ids of [raw.tagIds, raw.excludeTagIds])
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length > 100)
        throw new RequestError('Invalid tag filters.');
      ids.forEach(requireUUID);
    }
  if (raw.customField) {
    requireUUID(raw.customField.fieldId);
    if (
      !['is', 'is_not', 'contains'].includes(raw.customField.operator) ||
      typeof raw.customField.value !== 'string'
    )
      throw new RequestError('Invalid custom field filter.');
  }
  if (
    raw.type === 'csv' &&
    (!Array.isArray(raw.csvContacts) || raw.csvContacts.length > 1000)
  )
    throw new RequestError('CSV audience is limited to 1000 rows.');
  return raw;
}
export async function resolveBroadcastAudience(
  db: SqlConnection,
  accountId: string,
  audience: AudienceConfig,
  userId?: string
): Promise<Contact[]> {
  if (audience.type === 'csv') {
    if (!userId) return [];
    const ids = new Set<string>();
    for (const row of audience.csvContacts ?? []) {
      if (!row || typeof row.phone !== 'string')
        throw new RequestError('Invalid CSV row.');
      const contact = await findOrCreateApiContact(db, accountId, userId, {
        phone: row.phone,
        name: row.name,
      });
      ids.add(contact.id);
    }
    return queryRows<Contact>(
      db,
      `SELECT c.* FROM public.contacts c WHERE c.account_id=$1 AND c.id=ANY($2::uuid[]) AND NOT EXISTS(SELECT 1 FROM public.contact_tags ct WHERE ct.contact_id=c.id AND ct.tag_id=ANY($3::uuid[]))`,
      [accountId, [...ids], audience.excludeTagIds ?? []]
    );
  }
  const filter = audience.customField;
  const pattern = '%' + (filter?.value ?? '').replace(/[\\%_]/g, '\\$&') + '%';
  return queryRows<Contact>(
    db,
    `SELECT c.* FROM public.contacts c WHERE c.account_id=$1
  AND ($2='all' OR ($2='tags' AND EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id AND t.account_id=c.account_id WHERE ct.contact_id=c.id AND ct.tag_id=ANY($3::uuid[])))
   OR ($2='custom_field' AND EXISTS(SELECT 1 FROM public.contact_custom_values cv JOIN public.custom_fields f ON f.id=cv.custom_field_id AND f.account_id=c.account_id WHERE cv.contact_id=c.id AND cv.custom_field_id=$4 AND CASE $5 WHEN 'is' THEN cv.value=$6 WHEN 'is_not' THEN cv.value<>$6 WHEN 'contains' THEN cv.value ILIKE $7 ELSE false END)))
  AND NOT EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id AND t.account_id=c.account_id WHERE ct.contact_id=c.id AND ct.tag_id=ANY($8::uuid[])) ORDER BY c.created_at,c.id LIMIT 1001`,
    [
      accountId,
      audience.type,
      audience.tagIds ?? [],
      filter?.fieldId ?? null,
      filter?.operator ?? null,
      filter?.value ?? null,
      pattern,
      audience.excludeTagIds ?? [],
    ]
  );
}
