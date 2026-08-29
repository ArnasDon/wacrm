import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BusinessProfileRow,
  BusinessProfileInput,
  BusinessHours,
  BusinessLink,
  BusinessFaqItem,
  DepartmentRow,
  DepartmentInput,
  ContactRow,
  ContactInput,
} from './types'

// ============================================================
// Business Profile — CRUD service (AI optimization project, FASE 6).
//
// Every function takes `accountId` as a plain argument from the
// caller (the authenticated route, never the LLM — see
// business-profile/handoff-intent.ts's module doc for why that matters)
// and filters every query by it explicitly, mirroring the exact
// discipline already used throughout src/lib/ai/data-sources/service.ts
// and src/lib/ai/catalog/integrations.ts. RLS (migration 050) is
// defense in depth for direct dashboard access; these functions are
// what the service-role client (agent reads) and the RLS-scoped SSR
// client (Settings routes) both go through.
// ============================================================

const PROFILE_COLUMNS =
  'id, account_id, business_name, description, phone, whatsapp, email, website, address, city, state, country, google_maps_url, business_hours, delivery_enabled, delivery_description, delivery_coverage_areas, payment_methods, warranty_policy, return_policy, financing_policy, delivery_policy, links, faq, created_at, updated_at'

interface ProfileDbRow {
  id: string
  account_id: string
  business_name: string | null
  description: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  google_maps_url: string | null
  business_hours: BusinessHours | null
  delivery_enabled: boolean
  delivery_description: string | null
  delivery_coverage_areas: string[] | null
  payment_methods: string[] | null
  warranty_policy: string | null
  return_policy: string | null
  financing_policy: string | null
  delivery_policy: string | null
  links: BusinessLink[] | null
  faq: BusinessFaqItem[] | null
  created_at: string
  updated_at: string
}

function toProfile(row: ProfileDbRow): BusinessProfileRow {
  return {
    id: row.id,
    accountId: row.account_id,
    businessName: row.business_name,
    description: row.description,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    website: row.website,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    googleMapsUrl: row.google_maps_url,
    businessHours: row.business_hours ?? {},
    deliveryEnabled: row.delivery_enabled,
    deliveryDescription: row.delivery_description,
    deliveryCoverageAreas: row.delivery_coverage_areas ?? [],
    paymentMethods: row.payment_methods ?? [],
    warrantyPolicy: row.warranty_policy,
    returnPolicy: row.return_policy,
    financingPolicy: row.financing_policy,
    deliveryPolicy: row.delivery_policy,
    links: row.links ?? [],
    faq: row.faq ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** The account's business profile, or null when none has been
 *  configured yet — a perfectly normal, common state, never an error. */
export async function getBusinessProfile(
  db: SupabaseClient,
  accountId: string,
): Promise<BusinessProfileRow | null> {
  const { data, error } = await db
    .from('account_business_profiles')
    .select(PROFILE_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data ? toProfile(data as ProfileDbRow) : null
}

function inputToRow(input: BusinessProfileInput): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (input.businessName !== undefined) row.business_name = input.businessName
  if (input.description !== undefined) row.description = input.description
  if (input.phone !== undefined) row.phone = input.phone
  if (input.whatsapp !== undefined) row.whatsapp = input.whatsapp
  if (input.email !== undefined) row.email = input.email
  if (input.website !== undefined) row.website = input.website
  if (input.address !== undefined) row.address = input.address
  if (input.city !== undefined) row.city = input.city
  if (input.state !== undefined) row.state = input.state
  if (input.country !== undefined) row.country = input.country
  if (input.googleMapsUrl !== undefined) row.google_maps_url = input.googleMapsUrl
  if (input.businessHours !== undefined) row.business_hours = input.businessHours
  if (input.deliveryEnabled !== undefined) row.delivery_enabled = input.deliveryEnabled
  if (input.deliveryDescription !== undefined) row.delivery_description = input.deliveryDescription
  if (input.deliveryCoverageAreas !== undefined) row.delivery_coverage_areas = input.deliveryCoverageAreas
  if (input.paymentMethods !== undefined) row.payment_methods = input.paymentMethods
  if (input.warrantyPolicy !== undefined) row.warranty_policy = input.warrantyPolicy
  if (input.returnPolicy !== undefined) row.return_policy = input.returnPolicy
  if (input.financingPolicy !== undefined) row.financing_policy = input.financingPolicy
  if (input.deliveryPolicy !== undefined) row.delivery_policy = input.deliveryPolicy
  if (input.links !== undefined) row.links = input.links
  if (input.faq !== undefined) row.faq = input.faq
  return row
}

/** Create-or-update the account's ONE business profile row (upsert on
 *  the `account_id` unique constraint — migration 050). Only fields
 *  actually present in `input` are written, so a partial save from the
 *  Settings UI (e.g. just the hours tab) never blanks out the rest. */
export async function upsertBusinessProfile(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: BusinessProfileInput,
): Promise<BusinessProfileRow> {
  const existing = await db
    .from('account_business_profiles')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (existing.error) throw existing.error

  const row = inputToRow(input)

  if (existing.data) {
    const { data, error } = await db
      .from('account_business_profiles')
      .update(row)
      .eq('account_id', accountId)
      .select(PROFILE_COLUMNS)
      .single()
    if (error) throw error
    return toProfile(data as ProfileDbRow)
  }

  const { data, error } = await db
    .from('account_business_profiles')
    .insert({ ...row, account_id: accountId, created_by: userId })
    .select(PROFILE_COLUMNS)
    .single()
  if (error) throw error
  return toProfile(data as ProfileDbRow)
}

// ------------------------------------------------------------
// Departments
// ------------------------------------------------------------

const DEPARTMENT_COLUMNS = 'id, account_id, name, description, active, sort_order, created_at, updated_at'

interface DepartmentDbRow {
  id: string
  account_id: string
  name: string
  description: string | null
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

function toDepartment(row: DepartmentDbRow): DepartmentRow {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    description: row.description,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** All departments for the account, active and inactive — the Settings
 *  UI needs both (to let an admin re-enable one); agent-facing reads
 *  should filter to `active` themselves (see loadBusinessProfileForAgent
 *  below). Ordered the same way the admin arranged them. */
export async function listDepartments(db: SupabaseClient, accountId: string): Promise<DepartmentRow[]> {
  const { data, error } = await db
    .from('account_business_departments')
    .select(DEPARTMENT_COLUMNS)
    .eq('account_id', accountId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => toDepartment(r as DepartmentDbRow))
}

export async function createDepartment(
  db: SupabaseClient,
  accountId: string,
  input: DepartmentInput,
): Promise<DepartmentRow> {
  const { data, error } = await db
    .from('account_business_departments')
    .insert({
      account_id: accountId,
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      sort_order: input.sortOrder ?? 100,
    })
    .select(DEPARTMENT_COLUMNS)
    .single()
  if (error) throw error
  return toDepartment(data as DepartmentDbRow)
}

export async function updateDepartment(
  db: SupabaseClient,
  accountId: string,
  id: string,
  input: Partial<DepartmentInput>,
): Promise<DepartmentRow> {
  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.description !== undefined) row.description = input.description
  if (input.active !== undefined) row.active = input.active
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder

  const { data, error } = await db
    .from('account_business_departments')
    .update(row)
    .eq('id', id)
    .eq('account_id', accountId)
    .select(DEPARTMENT_COLUMNS)
    .single()
  if (error) throw error
  return toDepartment(data as DepartmentDbRow)
}

/** Deletes the department row only — contacts that belonged to it are
 *  NOT deleted (ON DELETE SET NULL, migration 050); they just become
 *  department-less, matching "un contacto puede existir sin
 *  departamento". */
export async function deleteDepartment(db: SupabaseClient, accountId: string, id: string): Promise<void> {
  const { error } = await db
    .from('account_business_departments')
    .delete()
    .eq('id', id)
    .eq('account_id', accountId)
  if (error) throw error
}

// ------------------------------------------------------------
// Contacts
// ------------------------------------------------------------

const CONTACT_COLUMNS =
  'id, account_id, department_id, name, role_title, phone, whatsapp, email, notes, active, sort_order, linked_user_id, created_at, updated_at'

interface ContactDbRow {
  id: string
  account_id: string
  department_id: string | null
  name: string
  role_title: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  notes: string | null
  active: boolean
  sort_order: number
  linked_user_id: string | null
  created_at: string
  updated_at: string
}

function toContact(row: ContactDbRow): ContactRow {
  return {
    id: row.id,
    accountId: row.account_id,
    departmentId: row.department_id,
    name: row.name,
    roleTitle: row.role_title,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    notes: row.notes,
    active: row.active,
    sortOrder: row.sort_order,
    linkedUserId: row.linked_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listContacts(db: SupabaseClient, accountId: string): Promise<ContactRow[]> {
  const { data, error } = await db
    .from('account_business_contacts')
    .select(CONTACT_COLUMNS)
    .eq('account_id', accountId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => toContact(r as ContactDbRow))
}

export async function createContact(
  db: SupabaseClient,
  accountId: string,
  input: ContactInput,
): Promise<ContactRow> {
  const { data, error } = await db
    .from('account_business_contacts')
    .insert({
      account_id: accountId,
      department_id: input.departmentId ?? null,
      name: input.name,
      role_title: input.roleTitle ?? null,
      phone: input.phone ?? null,
      whatsapp: input.whatsapp ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      active: input.active ?? true,
      sort_order: input.sortOrder ?? 100,
      linked_user_id: input.linkedUserId ?? null,
    })
    .select(CONTACT_COLUMNS)
    .single()
  if (error) throw error
  return toContact(data as ContactDbRow)
}

export async function updateContact(
  db: SupabaseClient,
  accountId: string,
  id: string,
  input: Partial<ContactInput>,
): Promise<ContactRow> {
  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.departmentId !== undefined) row.department_id = input.departmentId
  if (input.roleTitle !== undefined) row.role_title = input.roleTitle
  if (input.phone !== undefined) row.phone = input.phone
  if (input.whatsapp !== undefined) row.whatsapp = input.whatsapp
  if (input.email !== undefined) row.email = input.email
  if (input.notes !== undefined) row.notes = input.notes
  if (input.active !== undefined) row.active = input.active
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder
  if (input.linkedUserId !== undefined) row.linked_user_id = input.linkedUserId

  const { data, error } = await db
    .from('account_business_contacts')
    .update(row)
    .eq('id', id)
    .eq('account_id', accountId)
    .select(CONTACT_COLUMNS)
    .single()
  if (error) throw error
  return toContact(data as ContactDbRow)
}

export async function deleteContact(db: SupabaseClient, accountId: string, id: string): Promise<void> {
  const { error } = await db.from('account_business_contacts').delete().eq('id', id).eq('account_id', accountId)
  if (error) throw error
}

// ------------------------------------------------------------
// Agent-facing loader
// ------------------------------------------------------------

export interface BusinessProfileForAgent {
  profile: BusinessProfileRow | null
  /** Active departments only — an inactive one is exactly as absent to
   *  the agent as one that was never created. */
  departments: DepartmentRow[]
  /** Active contacts only, same reasoning. */
  contacts: ContactRow[]
}

/**
 * Everything the agent/handoff-intent matcher needs for one turn, in
 * one call — profile + active departments + active contacts fetched in
 * parallel. Callers (auto-reply.ts, draft/route.ts, playground/route.ts)
 * only invoke this when routing already decided the turn needs
 * Knowledge-type context (see routing.ts's FASE 5 `useKnowledge` gate,
 * unchanged by this feature), or when a handoff needs to resolve a
 * department/contact — never unconditionally.
 */
export async function loadBusinessProfileForAgent(
  db: SupabaseClient,
  accountId: string,
): Promise<BusinessProfileForAgent> {
  const [profile, departments, contacts] = await Promise.all([
    getBusinessProfile(db, accountId),
    listDepartments(db, accountId),
    listContacts(db, accountId),
  ])
  return {
    profile,
    departments: departments.filter((d) => d.active),
    contacts: contacts.filter((c) => c.active),
  }
}
