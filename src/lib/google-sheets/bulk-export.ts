import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Phase 2 — on-demand "export this table to Sheets now". Reads the
// account's current rows for one entity (RLS-scoped client from the
// route) and returns { tab, header, rows } for `clearAndWrite`.
//
// Deliberately a fixed column set per entity (not user-configurable
// yet) and capped — a report, not a backup.
// ============================================================

export const EXPORTABLE_ENTITIES = ['contacts', 'deals', 'quotes', 'products'] as const
export type ExportEntity = (typeof EXPORTABLE_ENTITIES)[number]

export const MAX_EXPORT_ROWS = 5000

export interface ExportResult {
  tab: string
  header: string[]
  rows: (string | number | null)[][]
  rowCount: number
  truncated: boolean
}

export function isExportEntity(v: unknown): v is ExportEntity {
  return typeof v === 'string' && (EXPORTABLE_ENTITIES as readonly string[]).includes(v)
}

export async function exportEntity(
  db: SupabaseClient,
  accountId: string,
  entity: ExportEntity,
): Promise<ExportResult> {
  switch (entity) {
    case 'contacts':
      return exportContacts(db, accountId)
    case 'deals':
      return exportDeals(db, accountId)
    case 'quotes':
      return exportQuotes(db, accountId)
    case 'products':
      return exportProducts(db, accountId)
  }
}

function pack(
  tab: string,
  header: string[],
  data: (string | number | null)[][],
): ExportResult {
  const truncated = data.length > MAX_EXPORT_ROWS
  const rows = truncated ? data.slice(0, MAX_EXPORT_ROWS) : data
  return { tab, header, rows: [header, ...rows], rowCount: rows.length, truncated }
}

async function exportContacts(db: SupabaseClient, accountId: string): Promise<ExportResult> {
  const { data } = await db
    .from('contacts')
    .select('name, phone, email, company, lead_temperature, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(MAX_EXPORT_ROWS + 1)
  const rows = ((data ?? []) as Record<string, unknown>[]).map((c) => [
    (c.name as string) ?? '',
    (c.phone as string) ?? '',
    (c.email as string) ?? '',
    (c.company as string) ?? '',
    (c.lead_temperature as string) ?? '',
    (c.created_at as string) ?? '',
  ])
  return pack('Export Contactos', ['Nombre', 'Teléfono', 'Correo', 'Empresa', 'Temperatura', 'Creado'], rows)
}

async function exportDeals(db: SupabaseClient, accountId: string): Promise<ExportResult> {
  const { data } = await db
    .from('deals')
    .select('title, value, currency, status, won_at, created_at, contacts(name, phone), pipeline_stages(name)')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(MAX_EXPORT_ROWS + 1)
  const rows = ((data ?? []) as Record<string, unknown>[]).map((d) => {
    const contact = (d.contacts ?? {}) as { name?: string; phone?: string }
    const stage = (d.pipeline_stages ?? {}) as { name?: string }
    return [
      (d.title as string) ?? '',
      typeof d.value === 'number' ? d.value : Number(d.value ?? 0),
      (d.currency as string) ?? '',
      stage.name ?? '',
      (d.status as string) ?? '',
      (d.won_at as string) ?? '',
      contact.name ?? '',
      contact.phone ?? '',
      (d.created_at as string) ?? '',
    ]
  })
  return pack(
    'Export Negociaciones',
    ['Negociación', 'Monto', 'Moneda', 'Etapa', 'Estado', 'Ganada el', 'Cliente', 'Teléfono', 'Creado'],
    rows,
  )
}

async function exportQuotes(db: SupabaseClient, accountId: string): Promise<ExportResult> {
  const { data } = await db
    .from('quotes')
    .select('subtotal, total, currency, status, customer_nit, customer_email, created_at, contacts(name, phone)')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(MAX_EXPORT_ROWS + 1)
  const rows = ((data ?? []) as Record<string, unknown>[]).map((q) => {
    const contact = (q.contacts ?? {}) as { name?: string; phone?: string }
    return [
      contact.name ?? '',
      contact.phone ?? '',
      (q.customer_nit as string) ?? '',
      typeof q.subtotal === 'number' ? q.subtotal : Number(q.subtotal ?? 0),
      typeof q.total === 'number' ? q.total : Number(q.total ?? 0),
      (q.currency as string) ?? '',
      (q.status as string) ?? '',
      (q.created_at as string) ?? '',
    ]
  })
  return pack(
    'Export Cotizaciones',
    ['Cliente', 'Teléfono', 'NIT', 'Subtotal', 'Total', 'Moneda', 'Estado', 'Creado'],
    rows,
  )
}

async function exportProducts(db: SupabaseClient, accountId: string): Promise<ExportResult> {
  const { data } = await db
    .from('products')
    .select('name, description, price, installation_cost, is_active, created_at')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
    .limit(MAX_EXPORT_ROWS + 1)
  const rows = ((data ?? []) as Record<string, unknown>[]).map((p) => [
    (p.name as string) ?? '',
    (p.description as string) ?? '',
    typeof p.price === 'number' ? p.price : Number(p.price ?? 0),
    typeof p.installation_cost === 'number' ? p.installation_cost : Number(p.installation_cost ?? 0),
    p.is_active ? 'Sí' : 'No',
    (p.created_at as string) ?? '',
  ])
  return pack(
    'Export Productos',
    ['Nombre', 'Descripción', 'Precio', 'Costo instalación', 'Activo', 'Creado'],
    rows,
  )
}
