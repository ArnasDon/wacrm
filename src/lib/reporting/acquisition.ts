// ============================================================
// Adquisición — la única consulta de /reports.
//
// Sustituye a `loadCampaigns`, `loadChannels` y `loadAds`, que eran el MISMO
// informe con distinto GROUP BY: tres pestañas que obligaban al usuario a
// saber qué es un click_id para elegir dónde mirar. Aquí el corte es un
// desplegable.
//
// Todo sale de `contacts.attribution`, que desde el bloque 1 se rellena de
// verdad al crear el lead. El resultado se cruza con `deals` para responder la
// única pregunta que mueve presupuesto: cuánto ingreso deja cada origen POR
// LEAD. Ordenar por volumen premia al canal barato que trae basura.
//
// Tenencia: `supabaseAdmin()` salta RLS por diseño, así que cada consulta
// lleva `.eq('account_id', …)` sin excepción.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';

import type { DateRange } from './queries';
import { FINAL_LOST_STAGE } from '@/lib/pipelines/default-stages';

/** Los siete cortes del mismo `contacts.attribution`. */
export const GROUP_BY_OPTIONS = [
  { key: 'channel', label: 'Canal' },
  { key: 'campaign', label: 'Campaña' },
  { key: 'source', label: 'Origen' },
  { key: 'medium', label: 'Medio' },
  { key: 'content', label: 'Anuncio' },
  { key: 'landing', label: 'Landing' },
  { key: 'click_id', label: 'Click ID' },
] as const;

export type GroupBy = (typeof GROUP_BY_OPTIONS)[number]['key'];

export interface AcquisitionRow {
  /** Valor del corte elegido. */
  group: string;
  leads: number;
  won: number;
  /** Suma de las tres ramas terminales. */
  lost: number;
  /** Desglose: quien dijo que no vs quien nunca contestó. */
  lostBreakdown: { declined: number; unreachable: number };
  open: number;
  revenue: number;
  /** Ingreso ÷ leads. La columna que decide el presupuesto. */
  perLead: number;
  /** Detalle de la atribución del grupo, para la fila desplegada. */
  detail: {
    utm: Record<string, string[]>;
    clickIds: Record<string, number>;
    landings: string[];
  };
}

export interface AcquisitionTotals {
  /** `page_view` del rango. Ver loadPageViews para qué cuenta y qué no. */
  visits: number;
  leads: number;
  /** Leads cuyo trato llegó a «Contactado» o más allá. */
  contacted: number;
  won: number;
  lost: number;
  revenue: number;
}

/** Un peldaño del embudo, ya con sus porcentajes calculados. */
export interface FunnelStep {
  key: 'visits' | 'leads' | 'contacted' | 'won';
  label: string;
  count: number;
  /** % sobre el peldaño anterior — la caída. `null` en el primero. */
  fromPrev: number | null;
  /** % sobre el primer peldaño. */
  fromTop: number;
}

export interface AcquisitionReport {
  rows: AcquisitionRow[];
  totals: AcquisitionTotals;
  /** Mismas cifras del periodo inmediatamente anterior, de igual duración. */
  previous: AcquisitionTotals;
  /** Visitas → Leads → Contactados → Ganados. */
  funnel: FunnelStep[];
}

type AttributionJson = {
  utm?: Record<string, string | undefined>;
  click_ids?: Record<string, string | undefined>;
  channel?: string;
  medium?: string;
  landing_slug?: string;
} | null;

const UNSET = '(sin dato)';

/** Extrae el valor del corte de un contacto. */
function groupValue(attr: AttributionJson, by: GroupBy): string {
  if (!attr) return UNSET;
  switch (by) {
    case 'channel':
      return attr.channel || UNSET;
    case 'campaign':
      return attr.utm?.campaign || UNSET;
    case 'source':
      return attr.utm?.source || UNSET;
    case 'medium':
      return attr.utm?.medium || attr.medium || UNSET;
    case 'content':
      return attr.utm?.content || UNSET;
    case 'landing':
      return attr.landing_slug || UNSET;
    case 'click_id': {
      const hit = Object.entries(attr.click_ids ?? {}).find(([, v]) => v);
      return hit ? `${hit[0]}:${hit[1]}` : UNSET;
    }
  }
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** El periodo inmediatamente anterior, de la misma duración. */
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const span = Math.max(to - from, 0);
  return {
    from: new Date(from - span).toISOString(),
    to: new Date(from).toISOString(),
  };
}

interface ContactRow {
  id: string;
  attribution: AttributionJson;
}

/** Contactos creados en el rango, con su atribución. */
async function loadContacts(
  accountId: string,
  range: DateRange
): Promise<ContactRow[]> {
  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('id, attribution')
    .eq('account_id', accountId)
    .gte('created_at', range.from)
    .lte('created_at', range.to);
  return (data ?? []) as ContactRow[];
}

interface DealRow {
  contact_id: string | null;
  status: string;
  value: unknown;
  stage: { name: string; position: number | null } | null;
}

/**
 * Posición de «Contactado» en DEFAULT_STAGES: 0 Lead creado, 1 Contacto
 * intentado, 2 Contactado. Se mide por posición y no por nombre porque las
 * etapas son editables y renombrarlas es lo primero que hace todo el mundo;
 * el ORDEN, en cambio, se conserva casi siempre.
 *
 * La distinción con la posición 1 es la que da sentido al peldaño: «Contacto
 * intentado» es que le escribimos, «Contactado» es que respondió. Un embudo
 * que cuenta intentos como contactos esconde justo el escalón que hay que
 * arreglar.
 */
const CONTACTED_POSITION = 2;

/** ¿Este lead llegó a hablar con alguien? */
function wasContacted(deals: DealRow[]): boolean {
  return deals.some(
    (d) =>
      d.status === 'won' || (d.stage?.position ?? 0) >= CONTACTED_POSITION
  );
}

/**
 * `page_view` del rango.
 *
 * Cuenta filas, no visitantes únicos: `visitor_id` acaba de empezar a viajar
 * en el evento (god.ts) y las filas anteriores no lo llevan, así que un
 * DISTINCT hoy daría una cifra que va creciendo sola según se renueva el
 * histórico — peor que una definición simple y estable. Cuando haya
 * suficiente historia con visitor_id, esto pasa a ser un RPC con DISTINCT:
 * traerse las filas al proceso para contarlas no escala.
 *
 * `head: true` no descarga ninguna fila; solo pide el recuento.
 */
async function loadPageViews(
  accountId: string,
  range: DateRange
): Promise<number> {
  const { count } = await supabaseAdmin()
    .from('tracking_events')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('event_type', 'page_view')
    .gte('created_at', range.from)
    .lte('created_at', range.to);
  return count ?? 0;
}

/**
 * Tratos de esos contactos. Se pide la etapa embebida para poder separar
 * *Desistió* de *No contestó* / *Largo plazo*: no es lo mismo un lead que dijo
 * que no que uno que nunca contestó — el segundo puede ser un problema de tu
 * tiempo de respuesta, no del canal.
 */
async function loadDealsForContacts(
  accountId: string,
  contactIds: string[]
): Promise<DealRow[]> {
  if (contactIds.length === 0) return [];
  const out: DealRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const { data } = await supabaseAdmin()
      .from('deals')
      .select('contact_id, status, value, stage:pipeline_stages(name, position)')
      .eq('account_id', accountId)
      .in('contact_id', contactIds.slice(i, i + CHUNK));
    out.push(...((data ?? []) as unknown as DealRow[]));
  }
  return out;
}

function emptyRow(group: string): AcquisitionRow {
  return {
    group,
    leads: 0,
    won: 0,
    lost: 0,
    lostBreakdown: { declined: 0, unreachable: 0 },
    open: 0,
    revenue: 0,
    perLead: 0,
    detail: { utm: {}, clickIds: {}, landings: [] },
  };
}

function addDetail(row: AcquisitionRow, attr: AttributionJson): void {
  if (!attr) return;
  for (const [k, v] of Object.entries(attr.utm ?? {})) {
    if (!v) continue;
    const list = (row.detail.utm[k] ??= []);
    if (!list.includes(v)) list.push(v);
  }
  for (const [k, v] of Object.entries(attr.click_ids ?? {})) {
    if (!v) continue;
    row.detail.clickIds[k] = (row.detail.clickIds[k] ?? 0) + 1;
  }
  if (attr.landing_slug && !row.detail.landings.includes(attr.landing_slug)) {
    row.detail.landings.push(attr.landing_slug);
  }
}

/** Cifras agregadas de un rango — la cabecera y su comparativa. */
async function totalsFor(
  accountId: string,
  range: DateRange
): Promise<AcquisitionTotals> {
  const [contacts, visits] = await Promise.all([
    loadContacts(accountId, range),
    loadPageViews(accountId, range),
  ]);
  const deals = await loadDealsForContacts(
    accountId,
    contacts.map((c) => c.id)
  );

  const dealsByContact = new Map<string, DealRow[]>();
  for (const d of deals) {
    if (!d.contact_id) continue;
    dealsByContact.set(d.contact_id, [
      ...(dealsByContact.get(d.contact_id) ?? []),
      d,
    ]);
  }

  let won = 0;
  let lost = 0;
  let revenue = 0;
  for (const d of deals) {
    if (d.status === 'won') {
      won += 1;
      revenue += toNumber(d.value);
    } else if (d.status === 'lost') {
      lost += 1;
    }
  }

  // Por contacto y no por trato: un lead con tres tratos es un contactado,
  // no tres.
  let contacted = 0;
  for (const c of contacts) {
    if (wasContacted(dealsByContact.get(c.id) ?? [])) contacted += 1;
  }

  return { visits, leads: contacts.length, contacted, won, lost, revenue };
}

/** Redondea a un decimal; 0 cuando el denominador es 0 (y no NaN). */
function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Los cuatro peldaños, con la caída entre cada par.
 *
 * Las visitas solo entran si hay alguna: una cuenta que aún no ha desplegado
 * la landing tiene 0 `page_view`, y arrancar el embudo en cero convierte
 * todos los porcentajes siguientes en 0 % y hace parecer que no se convierte
 * nada. En ese caso el embudo empieza en Leads, que es la verdad disponible.
 */
function buildFunnel(t: AcquisitionTotals): FunnelStep[] {
  const raw: { key: FunnelStep['key']; label: string; count: number }[] = [
    { key: 'visits', label: 'Visitas', count: t.visits },
    { key: 'leads', label: 'Leads', count: t.leads },
    { key: 'contacted', label: 'Contactados', count: t.contacted },
    { key: 'won', label: 'Ganados', count: t.won },
  ];
  const steps = t.visits > 0 ? raw : raw.slice(1);
  const top = steps[0]?.count ?? 0;

  return steps.map((s, i) => ({
    ...s,
    fromPrev: i === 0 ? null : pct(s.count, steps[i - 1].count),
    fromTop: pct(s.count, top),
  }));
}

/**
 * El informe completo: filas agrupadas por el corte elegido, más las cifras
 * del rango y las del periodo anterior para la comparativa.
 */
export async function loadAcquisition(
  accountId: string,
  range: DateRange,
  groupBy: GroupBy
): Promise<AcquisitionReport> {
  const [contacts, visits] = await Promise.all([
    loadContacts(accountId, range),
    loadPageViews(accountId, range),
  ]);
  const deals = await loadDealsForContacts(
    accountId,
    contacts.map((c) => c.id)
  );

  const dealsByContact = new Map<string, DealRow[]>();
  for (const d of deals) {
    if (!d.contact_id) continue;
    const list = dealsByContact.get(d.contact_id) ?? [];
    list.push(d);
    dealsByContact.set(d.contact_id, list);
  }

  const byGroup = new Map<string, AcquisitionRow>();
  const totals: AcquisitionTotals = {
    visits,
    leads: 0,
    contacted: 0,
    won: 0,
    lost: 0,
    revenue: 0,
  };

  for (const contact of contacts) {
    const key = groupValue(contact.attribution, groupBy);
    const row = byGroup.get(key) ?? emptyRow(key);
    row.leads += 1;
    totals.leads += 1;
    addDetail(row, contact.attribution);

    const contactDeals = dealsByContact.get(contact.id) ?? [];
    if (wasContacted(contactDeals)) totals.contacted += 1;
    // Un contacto cuenta una sola vez en cada columna de resultado: si tiene
    // un trato ganado es ganado, aunque arrastre otros abiertos.
    const hasWon = contactDeals.some((d) => d.status === 'won');
    const lostDeals = contactDeals.filter((d) => d.status === 'lost');

    if (hasWon) {
      row.won += 1;
      totals.won += 1;
    } else if (lostDeals.length > 0) {
      row.lost += 1;
      totals.lost += 1;
      const declined = lostDeals.some((d) => d.stage?.name === FINAL_LOST_STAGE);
      if (declined) row.lostBreakdown.declined += 1;
      else row.lostBreakdown.unreachable += 1;
    } else if (contactDeals.length > 0) {
      row.open += 1;
    }

    for (const d of contactDeals) {
      if (d.status === 'won') {
        row.revenue += toNumber(d.value);
        totals.revenue += toNumber(d.value);
      }
    }

    byGroup.set(key, row);
  }

  const rows = [...byGroup.values()].map((r) => ({
    ...r,
    perLead: r.leads > 0 ? Math.round((r.revenue / r.leads) * 100) / 100 : 0,
  }));

  // Por ingreso por lead, de mayor a menor: es la columna que decide dónde
  // subir el presupuesto, no el volumen.
  rows.sort((a, b) => b.perLead - a.perLead || b.leads - a.leads);

  const previous = await totalsFor(accountId, previousRange(range));

  return { rows, totals, previous, funnel: buildFunnel(totals) };
}
