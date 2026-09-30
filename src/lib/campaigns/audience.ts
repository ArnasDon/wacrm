// ============================================================
// Campaign audiences — resolved server-side, the same way for the
// wizard's "audience health" preview and for launch.
//
// Sources:
//   all      every contact of the account
//   tags     contacts with any (or all) of the given tags
//   segment  contacts whose custom field matches (is / is not / contains)
//   rows     uploaded CSV or pasted numbers: rows + the phone column
// Any source can exclude contacts carrying some tags.
//
// Every recipient comes back with `data`: the values the template
// variables read (contact fields name / email / company / phone, custom
// fields as "cf:<field id>", or the CSV's columns). Phones are
// normalised to international digits and de-duplicated.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeCsvPhone } from './advanced';

export type AudienceSource = 'all' | 'tags' | 'segment' | 'rows';

export interface AudienceSpec {
  source: AudienceSource;
  tagIds?: string[];
  /** tags: contacts need any (default) or all of the tags. */
  tagMatch?: 'any' | 'all';
  segment?: {
    fieldId: string;
    operator: 'is' | 'is_not' | 'contains';
    value: string;
  };
  rows?: Record<string, string>[];
  phoneColumn?: string;
  nameColumn?: string | null;
  excludeTagIds?: string[];
}

export interface ResolvedRecipient {
  /** International digits, e.g. "919812345678". */
  phone: string;
  contactId: string | null;
  name: string | null;
  data: Record<string, string>;
}

export interface AudienceResult {
  recipients: ResolvedRecipient[];
  /** Candidates before cleaning. */
  total: number;
  invalid: number;
  duplicates: number;
  /** Removed by the exclude tags. */
  excluded: number;
}

/** Built-in contact fields a variable can read. */
export const CONTACT_FIELDS = ['name', 'phone', 'email', 'company'] as const;
export const customFieldKey = (id: string) => `cf:${id}`;

const PAGE = 1000;
const IN_CHUNK = 300;

async function pageAll<T>(
  run: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function inChunks<T>(
  ids: string[],
  fetch: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK)
    out.push(...(await fetch(ids.slice(i, i + IN_CHUNK))));
  return out;
}

interface ContactRow {
  id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
}
const CONTACT_COLS = 'id, phone, name, email, company';

/** Only tags that belong to this account (ids come from the browser). */
async function ownTagIds(
  db: SupabaseClient,
  accountId: string,
  ids: string[] = []
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .in('id', ids);
  return (data ?? []).map((t) => t.id as string);
}

async function contactIdsWithTags(
  db: SupabaseClient,
  tagIds: string[]
): Promise<Map<string, number>> {
  const rows = await inChunks(tagIds, async (chunk) =>
    pageAll<{ contact_id: string }>((from, to) =>
      db
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', chunk)
        .range(from, to)
    )
  );
  const hits = new Map<string, number>();
  for (const r of rows)
    hits.set(r.contact_id, (hits.get(r.contact_id) ?? 0) + 1);
  return hits;
}

async function loadContacts(
  db: SupabaseClient,
  accountId: string,
  spec: AudienceSpec
): Promise<ContactRow[]> {
  if (spec.source === 'all') {
    return pageAll<ContactRow>((from, to) =>
      db
        .from('contacts')
        .select(CONTACT_COLS)
        .eq('account_id', accountId)
        .order('created_at')
        .range(from, to)
    );
  }

  let ids: string[] = [];
  if (spec.source === 'tags') {
    const tagIds = await ownTagIds(db, accountId, spec.tagIds);
    if (tagIds.length === 0) return [];
    const hits = await contactIdsWithTags(db, tagIds);
    ids = [...hits.entries()]
      .filter(([, n]) => spec.tagMatch !== 'all' || n >= tagIds.length)
      .map(([id]) => id);
  } else if (spec.source === 'segment' && spec.segment) {
    const { fieldId, operator, value } = spec.segment;
    const { data: field } = await db
      .from('custom_fields')
      .select('id')
      .eq('id', fieldId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!field) return [];
    const matches = await pageAll<{ contact_id: string }>((from, to) => {
      let q = db
        .from('contact_custom_values')
        .select('contact_id')
        .eq('custom_field_id', fieldId);
      if (operator === 'is') q = q.eq('value', value);
      else if (operator === 'is_not') q = q.neq('value', value);
      else q = q.ilike('value', `%${value}%`);
      return q.range(from, to);
    });
    ids = [...new Set(matches.map((m) => m.contact_id))];
  }

  return inChunks(ids, async (chunk) => {
    const { data, error } = await db
      .from('contacts')
      .select(CONTACT_COLS)
      .eq('account_id', accountId)
      .in('id', chunk);
    if (error) throw new Error(error.message);
    return (data ?? []) as ContactRow[];
  });
}

export async function resolveAudience(
  db: SupabaseClient,
  accountId: string,
  spec: AudienceSpec,
  /** row keys the variables read — only these are carried per recipient */
  keep: string[] = []
): Promise<AudienceResult> {
  const seen = new Set<string>();
  const recipients: ResolvedRecipient[] = [];
  let invalid = 0;
  let duplicates = 0;
  let excluded = 0;

  const excludeIds = new Set(
    (
      await contactIdsWithTags(
        db,
        await ownTagIds(db, accountId, spec.excludeTagIds)
      )
    ).keys()
  );

  if (spec.source === 'rows') {
    const rows = spec.rows ?? [];
    const phoneCol = spec.phoneColumn ?? 'phone';
    for (const r of rows) {
      const phone = normalizeCsvPhone(String(r?.[phoneCol] ?? ''));
      if (!phone) {
        invalid++;
        continue;
      }
      if (seen.has(phone)) {
        duplicates++;
        continue;
      }
      seen.add(phone);
      const data: Record<string, string> = {};
      for (const k of keep) data[k] = String(r?.[k] ?? '');
      const name = spec.nameColumn
        ? String(r?.[spec.nameColumn] ?? '').trim() || null
        : null;
      recipients.push({ phone, contactId: null, name, data });
    }
    // Exclusion for uploaded numbers is matched against existing contacts.
    if (excludeIds.size && recipients.length) {
      const excludedPhones = new Set<string>();
      await inChunks([...excludeIds], async (chunk) => {
        const { data } = await db
          .from('contacts')
          .select('phone_normalized')
          .eq('account_id', accountId)
          .in('id', chunk);
        for (const c of data ?? [])
          excludedPhones.add(c.phone_normalized as string);
        return [];
      });
      const kept = recipients.filter((r) => !excludedPhones.has(r.phone));
      excluded = recipients.length - kept.length;
      return {
        recipients: kept,
        total: rows.length,
        invalid,
        duplicates,
        excluded,
      };
    }
    return { recipients, total: rows.length, invalid, duplicates, excluded };
  }

  const contacts = await loadContacts(db, accountId, spec);
  const cfIds = keep.filter((k) => k.startsWith('cf:')).map((k) => k.slice(3));
  const custom = new Map<string, Map<string, string>>();
  if (cfIds.length && contacts.length) {
    const rows = await inChunks(
      contacts.map((c) => c.id),
      async (chunk) => {
        const { data } = await db
          .from('contact_custom_values')
          .select('contact_id, custom_field_id, value')
          .in('contact_id', chunk)
          .in('custom_field_id', cfIds);
        return (data ?? []) as {
          contact_id: string;
          custom_field_id: string;
          value: string | null;
        }[];
      }
    );
    for (const r of rows) {
      const m = custom.get(r.contact_id) ?? new Map<string, string>();
      m.set(customFieldKey(r.custom_field_id), r.value ?? '');
      custom.set(r.contact_id, m);
    }
  }

  for (const c of contacts) {
    if (excludeIds.has(c.id)) {
      excluded++;
      continue;
    }
    const phone = normalizeCsvPhone(c.phone ?? '');
    if (!phone) {
      invalid++;
      continue;
    }
    if (seen.has(phone)) {
      duplicates++;
      continue;
    }
    seen.add(phone);
    const fields: Record<string, string> = {
      name: c.name ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      company: c.company ?? '',
    };
    const data: Record<string, string> = {};
    for (const k of keep)
      data[k] = k.startsWith('cf:')
        ? (custom.get(c.id)?.get(k) ?? '')
        : (fields[k] ?? '');
    recipients.push({ phone, contactId: c.id, name: c.name, data });
  }
  return { recipients, total: contacts.length, invalid, duplicates, excluded };
}
