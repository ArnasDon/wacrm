import type { SupabaseClient } from '@supabase/supabase-js';

import {
  findPhoneCountry,
  phoneCountryLikePattern,
  phoneMatchesCountry,
} from '@/lib/contacts/phone-country';
import { fetchAllInChunks, fetchAllPages } from '@/lib/supabase/paged-query';
import type { Contact } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';

export interface CsvAudienceRow {
  phone: string;
  name?: string;
}

export interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: CsvAudienceRow[];
  excludeTagIds?: string[];
  countryCode?: string;
}

async function withContext<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${label}: ${message}`);
  }
}

export function fetchTaggedContactIds(
  db: SupabaseClient,
  tagIds: readonly string[],
): Promise<Set<string>> {
  return withContext('contact tags', async () => {
    const rows = await fetchAllInChunks<{ contact_id: string }, string>(
      tagIds,
      (slice, from, to) =>
        db
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', slice)
          .order('id')
          .range(from, to),
    );
    return new Set(rows.map((row) => row.contact_id));
  });
}

export function fetchCustomFieldContactIds(
  db: SupabaseClient,
  filter: CustomFieldFilter,
): Promise<Set<string>> {
  return withContext('custom field matches', async () => {
    const { fieldId, operator, value } = filter;
    const rows = await fetchAllPages<{ contact_id: string }>((from, to) => {
      let query = db
        .from('contact_custom_values')
        .select('contact_id')
        .eq('custom_field_id', fieldId);
      if (operator === 'is') query = query.eq('value', value);
      else if (operator === 'is_not') query = query.neq('value', value);
      else query = query.ilike('value', `%${value}%`);
      return query.order('id').range(from, to);
    });
    return new Set(rows.map((row) => row.contact_id));
  });
}

export function fetchContactsByIds(
  db: SupabaseClient,
  ids: readonly string[],
): Promise<Contact[]> {
  return withContext('contacts', () =>
    fetchAllInChunks<Contact, string>(ids, (slice, from, to) =>
      db.from('contacts').select('*').in('id', slice).order('id').range(from, to),
    ),
  );
}

export function fetchAllContacts(
  db: SupabaseClient,
  phonePattern: string | null = null,
): Promise<Contact[]> {
  return withContext('contacts', () =>
    fetchAllPages<Contact>((from, to) => {
      const query = db.from('contacts').select('*');
      const filtered = phonePattern
        ? query.like('phone_normalized', phonePattern)
        : query;
      return filtered.order('id').range(from, to);
    }),
  );
}

export function fetchCountryContactIds(
  db: SupabaseClient,
  phonePattern: string,
): Promise<Set<string>> {
  return withContext('contacts by country', async () => {
    const rows = await fetchAllPages<{ id: string }>((from, to) =>
      db
        .from('contacts')
        .select('id')
        .like('phone_normalized', phonePattern)
        .order('id')
        .range(from, to),
    );
    return new Set(rows.map((row) => row.id));
  });
}

function hasUnknownCountry(audience: AudienceConfig): boolean {
  return Boolean(audience.countryCode) && !findPhoneCountry(audience.countryCode);
}

function csvRowsInCountry(audience: AudienceConfig): CsvAudienceRow[] {
  const rows = audience.csvContacts ?? [];
  const { countryCode } = audience;
  if (!countryCode) return rows;
  return rows.filter((row) => phoneMatchesCountry(row.phone, countryCode));
}

async function fetchCountryFilter(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<Set<string> | null> {
  const pattern = phoneCountryLikePattern(audience.countryCode);
  return pattern ? fetchCountryContactIds(db, pattern) : null;
}

async function fetchExcludedIds(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<Set<string>> {
  if (!audience.excludeTagIds || audience.excludeTagIds.length === 0) {
    return new Set();
  }
  return fetchTaggedContactIds(db, audience.excludeTagIds);
}

function hasCustomFieldFilter(
  audience: AudienceConfig,
): audience is AudienceConfig & { customField: CustomFieldFilter } {
  return Boolean(audience.customField?.fieldId);
}

async function fetchAudienceContactIds(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<Set<string> | null> {
  if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
    return fetchTaggedContactIds(db, audience.tagIds);
  }
  if (audience.type === 'custom_field' && hasCustomFieldFilter(audience)) {
    return fetchCustomFieldContactIds(db, audience.customField);
  }
  return null;
}

export async function resolveAudienceContacts(
  db: SupabaseClient,
  audience: AudienceConfig,
  resolveCsv: (rows: CsvAudienceRow[]) => Promise<Contact[]>,
): Promise<Contact[]> {
  if (hasUnknownCountry(audience)) return [];
  const excluded = await fetchExcludedIds(db, audience);
  const keep = (contact: Contact) => !excluded.has(contact.id);

  if (audience.type === 'all') {
    const pattern = phoneCountryLikePattern(audience.countryCode);
    return (await fetchAllContacts(db, pattern)).filter(keep);
  }
  if (audience.type === 'csv') {
    const rows = csvRowsInCountry(audience);
    if (rows.length === 0) return [];
    return (await resolveCsv(rows)).filter(keep);
  }

  const ids = await fetchAudienceContactIds(db, audience);
  if (!ids) return [];
  const inCountry = await fetchCountryFilter(db, audience);
  const wanted = [...ids].filter(
    (id) => !excluded.has(id) && (!inCountry || inCountry.has(id)),
  );
  if (wanted.length === 0) return [];
  return fetchContactsByIds(db, wanted);
}

export async function countAudience(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<number | null> {
  if (hasUnknownCountry(audience)) return 0;

  if (audience.type === 'csv') {
    return audience.csvContacts && audience.csvContacts.length > 0
      ? csvRowsInCountry(audience).length
      : null;
  }

  if (audience.type === 'all' && phoneCountryLikePattern(audience.countryCode)) {
    const inCountry = await fetchCountryFilter(db, audience);
    const excluded = await fetchExcludedIds(db, audience);
    let size = 0;
    for (const id of inCountry ?? []) if (!excluded.has(id)) size++;
    return size;
  }

  if (audience.type === 'all') {
    const { count, error } = await db
      .from('contacts')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Failed to count contacts: ${error.message}`);
    const total = count ?? 0;
    const excluded = await fetchExcludedIds(db, audience);
    return Math.max(0, total - excluded.size);
  }

  if (audience.type === 'custom_field' && !audience.customField?.value) {
    return null;
  }

  const ids = await fetchAudienceContactIds(db, audience);
  if (!ids) return null;
  const excluded = await fetchExcludedIds(db, audience);
  const inCountry = await fetchCountryFilter(db, audience);
  let size = 0;
  for (const id of ids) {
    if (!excluded.has(id) && (!inCountry || inCountry.has(id))) size++;
  }
  return size;
}
