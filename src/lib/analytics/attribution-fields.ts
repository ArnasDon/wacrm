// ============================================================
// Proyección de la atribución a campos personalizados.
//
// POR QUÉ SE ESCRIBE EN DOS SITIOS (única duplicación autorizada):
//
//   · `contacts.attribution` (jsonb) es el registro CANÓNICO. Los informes
//     agregan sobre él sin joins, y es lo que lee lib/reporting/queries.ts.
//
//   · Los campos personalizados son la PROYECCIÓN para humanos: ver la ficha,
//     filtrar la lista de contactos, segmentar una audiencia de campaña
//     (step2-select-audience.tsx) y condicionar automatizaciones.
//
// Misma información, dos formas, porque los dos subsistemas del CRM necesitan
// formas distintas: uno agrega, el otro filtra por valor. Se escriben en la
// misma función, en el mismo momento, una sola vez — nunca se re-sincronizan
// después, porque la atribución es de primer contacto y no cambia.
//
// Esto no construye nada nuevo: wacrm ya sabe mostrar, filtrar, segmentar y
// automatizar campos personalizados. Metiendo aquí la atribución, todo eso
// sale gratis.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Attribution } from './attribution';

/**
 * Los ocho campos que proyectan la atribución, en el orden en que se siembran.
 *
 * `key` es interno (nunca se muestra); `field_name` es lo que ve el usuario en
 * la ficha, en el filtro de contactos y en el selector de audiencia.
 */
export const ATTRIBUTION_FIELDS = [
  { key: 'channel', field_name: 'Canal' },
  { key: 'campaign', field_name: 'Campaña' },
  { key: 'source', field_name: 'Origen' },
  { key: 'medium', field_name: 'Medio' },
  { key: 'content', field_name: 'Anuncio' },
  { key: 'term', field_name: 'Término' },
  { key: 'landing', field_name: 'Landing' },
  { key: 'click_id', field_name: 'Click ID' },
] as const;

export type AttributionFieldKey = (typeof ATTRIBUTION_FIELDS)[number]['key'];

/**
 * La atribución tal y como llega por la red.
 *
 * `trackEventSchema` valida un objeto más laxo que la interfaz `Attribution`
 * —`utm`, `click_ids` y `landing_slug` son opcionales ahí— porque un beacon
 * puede llegar sin ninguno de ellos. Este alias hace explícita esa realidad en
 * lugar de forzar un cast en la frontera.
 */
export type AttributionLike = Partial<Attribution>;

/**
 * Extrae el valor de cada campo desde la atribución. Devuelve solo los que
 * tienen contenido: un contacto directo no debe acabar con seis campos vacíos
 * en su ficha.
 *
 * El click id se guarda como `tipo:valor` (p. ej. `gclid:Cj0KC…`) porque el
 * tipo ES la información — dice de qué red vino — y así una sola fila cubre
 * los nueve identificadores posibles sin nueve campos personalizados.
 */
export function attributionFieldValues(
  attr: AttributionLike
): Partial<Record<AttributionFieldKey, string>> {
  const out: Partial<Record<AttributionFieldKey, string>> = {};

  if (attr.channel) out.channel = attr.channel;
  if (attr.utm?.campaign) out.campaign = attr.utm.campaign;
  if (attr.utm?.source) out.source = attr.utm.source;
  // El medio del UTM manda sobre el inferido: si el anunciante lo declaró,
  // es más fiable que lo que dedujimos del referrer.
  const medium = attr.utm?.medium ?? attr.medium;
  if (medium) out.medium = medium;
  if (attr.utm?.content) out.content = attr.utm.content;
  if (attr.utm?.term) out.term = attr.utm.term;
  if (attr.landing_slug) out.landing = attr.landing_slug;

  const clickEntry = Object.entries(attr.click_ids ?? {}).find(
    ([, v]) => typeof v === 'string' && v.trim() !== ''
  );
  if (clickEntry) out.click_id = `${clickEntry[0]}:${clickEntry[1]}`;

  return out;
}

/**
 * Siembra los campos que falten y devuelve `key → custom_field_id`.
 *
 * Idempotente: `custom_fields` no tiene índice único sobre
 * (account_id, field_name) —verificado en supabase/migrations/— así que no se
 * puede usar `onConflict`. Se leen los existentes y solo se insertan los que
 * faltan.
 *
 * `custom_fields` exige `user_id` Y `account_id`, los dos NOT NULL: el
 * `user_id` viene de la migración 001 y el `account_id` lo añadió la 017
 * (:178 y :278). El lookup se acota por `account_id`, que es la tenencia real
 * — es lo mismo que hace engine.ts:688 antes de escribir un valor.
 */
export async function ensureAttributionFields(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string
): Promise<Map<AttributionFieldKey, string>> {
  const wanted = ATTRIBUTION_FIELDS.map((f) => f.field_name);

  const { data: existing, error } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', accountId)
    .in('field_name', wanted);

  if (error) throw error;

  const byName = new Map<string, string>();
  for (const row of existing ?? []) {
    byName.set(row.field_name as string, row.id as string);
  }

  const missing = ATTRIBUTION_FIELDS.filter((f) => !byName.has(f.field_name));
  if (missing.length > 0) {
    const { data: created, error: insErr } = await db
      .from('custom_fields')
      .insert(
        missing.map((f) => ({
          account_id: accountId,
          user_id: auditUserId,
          field_name: f.field_name,
          field_type: 'text',
        }))
      )
      .select('id, field_name');

    if (insErr) throw insErr;
    for (const row of created ?? []) {
      byName.set(row.field_name as string, row.id as string);
    }
  }

  const out = new Map<AttributionFieldKey, string>();
  for (const f of ATTRIBUTION_FIELDS) {
    const id = byName.get(f.field_name);
    if (id) out.set(f.key, id);
  }
  return out;
}

/**
 * Escribe los valores de atribución del contacto como campos personalizados.
 *
 * Best-effort a propósito: si esto falla, el contacto ya está creado y su
 * `contacts.attribution` —el registro canónico— ya se guardó. Perder la
 * proyección degrada el filtrado, no el dato. Nunca debe tumbar la creación
 * de un lead.
 */
export async function projectAttributionToCustomFields(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  attr: AttributionLike
): Promise<void> {
  const values = attributionFieldValues(attr);
  const keys = Object.keys(values) as AttributionFieldKey[];
  if (keys.length === 0) return;

  const fieldIds = await ensureAttributionFields(db, accountId, auditUserId);

  const rows = keys
    .map((k) => ({ custom_field_id: fieldIds.get(k), value: values[k] }))
    .filter((r): r is { custom_field_id: string; value: string } =>
      Boolean(r.custom_field_id && r.value)
    )
    .map((r) => ({ contact_id: contactId, ...r }));

  if (rows.length === 0) return;

  // UNIQUE(contact_id, custom_field_id) de la migración 001 — mismo patrón
  // que engine.ts:701, para que un reintento sobrescriba en vez de duplicar.
  const { error } = await db
    .from('contact_custom_values')
    .upsert(rows, { onConflict: 'contact_id,custom_field_id' });

  if (error) throw error;
}
