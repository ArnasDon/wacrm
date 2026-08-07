import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

// ============================================================
// calendar_configs repository — the ONLY module allowed to call
// `supabase.from('calendar_configs')`. Every function here takes
// `accountId` as its first explicit argument and filters on it, even
// though RLS already scopes reads for authenticated callers — the
// service-role client used by the webhook/tool-executor path has no
// `auth.uid()` and bypasses RLS entirely, so the account filter here is
// the *only* thing standing between one workspace's calendar and
// another's. Never remove it, and never let a caller pass a row from
// one account into a function scoped to another.
//
// This is Fase 2 groundwork for decoupling: nothing outside this file
// (and its Google Calendar / tool-handler consumers) should know the
// table is called `calendar_configs`, that `refresh_token` is
// AES-256-GCM-encrypted, or what the RLS policies look like. When the
// eter-agent domain eventually moves to its own service, only this
// file's internals change — the interface below stays.
// ============================================================

export interface CalendarConfig {
  id: string
  accountId: string
  provider: 'google'
  /** Decrypted Google OAuth refresh token — never log or persist this. */
  refreshToken: string
  calendarId: string
  timezone: string
  businessHours: BusinessHours
  defaultDurationMin: number
  bufferMin: number
  minLeadTimeMin: number
  isActive: boolean
}

/** `{ mon: [["09:00","13:00"], ["14:00","19:00"]], ... }` — empty/missing
 *  key means closed that weekday. See migration 037 for the full contract. */
export type BusinessHours = Partial<Record<Weekday, [string, string][]>>
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface UpsertCalendarConfigInput {
  provider?: 'google'
  /** Plaintext refresh token — this function encrypts it before writing. */
  refreshToken: string
  calendarId: string
  timezone: string
  businessHours?: BusinessHours
  defaultDurationMin?: number
  bufferMin?: number
  minLeadTimeMin?: number
  isActive?: boolean
  createdBy?: string | null
}

interface CalendarConfigRow {
  id: string
  account_id: string
  provider: 'google'
  refresh_token: string
  calendar_id: string
  timezone: string
  business_hours: BusinessHours
  default_duration_min: number
  buffer_min: number
  min_lead_time_min: number
  is_active: boolean
}

const COLUMNS =
  'id, account_id, provider, refresh_token, calendar_id, timezone, business_hours, default_duration_min, buffer_min, min_lead_time_min, is_active'

function toDomain(row: CalendarConfigRow): CalendarConfig {
  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider,
    refreshToken: decrypt(row.refresh_token),
    calendarId: row.calendar_id,
    timezone: row.timezone,
    businessHours: row.business_hours ?? {},
    defaultDurationMin: row.default_duration_min,
    bufferMin: row.buffer_min,
    minLeadTimeMin: row.min_lead_time_min,
    isActive: row.is_active,
  }
}

/**
 * Load the account's calendar connection, decrypted and ready to use.
 * Returns `null` when there's no row. Unlike `loadAiConfig`, this does
 * NOT gate on `is_active` — callers that need "is booking actually
 * live" should check `.isActive` themselves (mirrors how the AI
 * Playground needs an inactive config to still be loadable).
 */
export async function getCalendarConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<CalendarConfig | null> {
  const { data, error } = await db
    .from('calendar_configs')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as CalendarConfigRow)
}

/**
 * Create or replace the account's calendar connection. `account_id` is
 * UNIQUE on the table (one calendar per workspace), so this is a real
 * upsert keyed on that column — a second call always overwrites the
 * first rather than erroring.
 */
export async function upsertCalendarConfig(
  db: SupabaseClient,
  accountId: string,
  input: UpsertCalendarConfigInput,
): Promise<CalendarConfig> {
  const row = {
    account_id: accountId,
    provider: input.provider ?? 'google',
    refresh_token: encrypt(input.refreshToken),
    calendar_id: input.calendarId,
    timezone: input.timezone,
    business_hours: input.businessHours ?? {},
    default_duration_min: input.defaultDurationMin ?? 30,
    buffer_min: input.bufferMin ?? 0,
    min_lead_time_min: input.minLeadTimeMin ?? 60,
    is_active: input.isActive ?? false,
    created_by: input.createdBy ?? null,
  }
  const { data, error } = await db
    .from('calendar_configs')
    .upsert(row, { onConflict: 'account_id' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return toDomain(data as CalendarConfigRow)
}

/** Flip the master switch without touching the connection itself. */
export async function setCalendarConfigActive(
  db: SupabaseClient,
  accountId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await db
    .from('calendar_configs')
    .update({ is_active: isActive })
    .eq('account_id', accountId)
  if (error) throw error
}

/** Persist a refreshed OAuth refresh token (Google rotates these rarely,
 *  but the client must be able to store a new one when it does). */
export async function updateCalendarConfigRefreshToken(
  db: SupabaseClient,
  accountId: string,
  plaintextRefreshToken: string,
): Promise<void> {
  const { error } = await db
    .from('calendar_configs')
    .update({ refresh_token: encrypt(plaintextRefreshToken) })
    .eq('account_id', accountId)
  if (error) throw error
}

export async function deleteCalendarConfig(db: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await db.from('calendar_configs').delete().eq('account_id', accountId)
  if (error) throw error
}
