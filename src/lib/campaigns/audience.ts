// ============================================================
// Resolución de audiencia compartida (Broadcast WhatsApp + Email).
//
// Extraído de use-broadcast-sending.ts para que el wizard de email
// reutilice exactamente la misma lógica de selección de contactos:
// all / tags / custom_field / csv, con exclusión por tags.
//
// La función es pura respecto al cliente Supabase — recibe el cliente
// y el accountId como parámetros, para que cualquier caller (hook o
// página) la use sin duplicación.
// ============================================================

import type { Contact } from '@/types';
import type { AudienceConfig, CustomFieldFilter } from './types';

/**
 * Resuelve la lista de contactos que matchea una AudienceConfig.
 * - 'all': todos los contactos del account.
 * - 'tags': contactos que tienen al menos un tag de `tagIds`.
 * - 'custom_field': contactos cuyo custom field cumple el filtro.
 * - 'csv': upsert de contactos por teléfono y devuelve los reales.
 * - `excludeTagIds`: sustrae contactos que tengan cualquiera de esos tags.
 */
export async function resolveAudience(
  supabase: ReturnType<typeof import('@/lib/supabase/client').createClient>,
  accountId: string | null,
  audience: AudienceConfig,
): Promise<Contact[]> {
  let contacts: Contact[] = [];

  if (audience.type === 'all') {
    const { data, error } = await supabase.from('contacts').select('*');
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts = data ?? [];
  } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
    const { data: contactTags, error: tagError } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', audience.tagIds);

    if (tagError) throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

    if (contactTags && contactTags.length > 0) {
      const uniqueContactIds = [...new Set(contactTags.map((ct) => ct.contact_id))];
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .in('id', uniqueContactIds);
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    }
  } else if (audience.type === 'custom_field' && audience.customField) {
    contacts = await resolveCustomFieldAudience(supabase, audience.customField);
  } else if (audience.type === 'csv' && audience.csvContacts) {
    contacts = await upsertCsvContacts(supabase, accountId, audience.csvContacts);
  }

  // Apply exclude tags (works across all contact-derived audience types).
  if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
    const { data: excludeRows } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', audience.excludeTagIds);
    const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
    contacts = contacts.filter((c) => !excludedIds.has(c.id));
  }

  return contacts;
}

async function resolveCustomFieldAudience(
  supabase: ReturnType<typeof import('@/lib/supabase/client').createClient>,
  filter: CustomFieldFilter,
): Promise<Contact[]> {
  const { fieldId, operator, value } = filter;

  let query = supabase
    .from('contact_custom_values')
    .select('contact_id')
    .eq('custom_field_id', fieldId);

  if (operator === 'is') query = query.eq('value', value);
  else if (operator === 'is_not') query = query.neq('value', value);
  else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

  const { data: matches, error: matchErr } = await query;
  if (matchErr) throw new Error(`Custom-field filter failed: ${matchErr.message}`);

  const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
  if (contactIds.length === 0) return [];

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .in('id', contactIds);
  if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
  return data ?? [];
}

/**
 * CSV uploads llegan como phone/name crudos, no filas de DB. Antes de
 * insertar recipients (cuyo contact_id FK a contacts.id) hay que
 * resolver UUIDs reales: lookup por teléfono + insert de los faltantes.
 * Preserva el orden de entrada para que analytics matchee el CSV.
 */
async function upsertCsvContacts(
  supabase: ReturnType<typeof import('@/lib/supabase/client').createClient>,
  accountId: string | null,
  csvRows: { phone: string; name?: string }[],
): Promise<Contact[]> {
  if (csvRows.length === 0) return [];

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    throw new Error('You are not signed in.');
  }
  if (!accountId) {
    throw new Error('Your profile is not linked to an account.');
  }

  // De-duplicate by phone within the CSV (users can paste duplicates).
  const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
  for (const row of csvRows) {
    if (row.phone) uniqueByPhone.set(row.phone, row);
  }
  const phones = [...uniqueByPhone.keys()];

  const { data: existing, error: lookupErr } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', user.id)
    .in('phone', phones);
  if (lookupErr) {
    throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
  }

  const byPhone = new Map<string, Contact>();
  for (const c of (existing ?? []) as Contact[]) {
    if (c.phone) byPhone.set(c.phone, c);
  }

  const missing = phones
    .filter((p) => !byPhone.has(p))
    .map((phone) => ({
      user_id: user.id,
      account_id: accountId,
      phone,
      name: uniqueByPhone.get(phone)?.name ?? null,
    }));

  const INSERT_CHUNK = 200;
  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    const chunk = missing.slice(i, i + INSERT_CHUNK);
    const { data: inserted, error: insertErr } = await supabase
      .from('contacts')
      .insert(chunk)
      .select();
    if (insertErr) {
      throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
    }
    for (const c of (inserted ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }
  }

  return phones
    .map((p) => byPhone.get(p))
    .filter((c): c is Contact => Boolean(c));
}
