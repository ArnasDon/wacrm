import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessHours } from './calendar-config.repo'

// ============================================================
// Bloco 3-A — commercial-mode scheduling config, read out of
// `ai_configs` (migration 046). Kept in its own tiny repo module rather
// than folded into `src/lib/ai/config.ts` (`loadAiConfig`) because
// that loader also decrypts the BYO provider API key and requires
// `is_active` — tool handlers here only need the scheduling columns,
// with no reason to touch the encrypted key or the active-switch gate.
//
// None of these columns are secret: calendar ids and scheduling rules
// aren't credentials (the actual Google auth is the service account in
// service-account.ts, sourced from the environment, never from this
// table) — so this repo does no encryption, unlike calendar-config.repo
// (OAuth refresh tokens) or config.ts (provider API keys).
// ============================================================

export interface CommercialCalendarConfig {
  /** Calendar the meeting event is created ON. Never the personal
   *  calendar — see `busyCalendarIds` for what's merely CHECKED. */
  calendarId: string | null
  /** Every calendar checked for conflicts before a slot is offered or
   *  booked. A slot must be free in ALL of these. Always includes
   *  `calendarId` even if the account's stored list omits it — a
   *  meeting must never double-book the very calendar it's created on. */
  busyCalendarIds: string[]
  meetingDurationMin: number
  timezone: string
  businessHours: BusinessHours
  minLeadTimeMin: number
  bufferMin: number
  maxBusinessDaysAhead: number
}

interface Row {
  commercial_calendar_id: string | null
  commercial_busy_calendar_ids: string[] | null
  commercial_meeting_duration_min: number
  commercial_timezone: string
  commercial_business_hours: BusinessHours
  commercial_min_lead_time_min: number
  commercial_buffer_min: number
  commercial_max_business_days_ahead: number
}

const COLUMNS =
  'commercial_calendar_id, commercial_busy_calendar_ids, commercial_meeting_duration_min, commercial_timezone, commercial_business_hours, commercial_min_lead_time_min, commercial_buffer_min, commercial_max_business_days_ahead'

/**
 * Load the account's commercial-mode scheduling config. Returns `null`
 * only when the account has no `ai_configs` row at all (Bloco 3-A can't
 * be active without one — `isCommercialConversation` already gates on
 * `ai_configs` existing via `loadAiConfig`, so this is mostly
 * defensive). A row that exists but has `commercial_calendar_id = null`
 * still returns a config — callers use that null to fall back to the
 * `commercial_booking_url` link flow instead of booking directly.
 */
export async function getCommercialCalendarConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<CommercialCalendarConfig | null> {
  const { data, error } = await db
    .from('ai_configs')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as Row
  const calendarId = row.commercial_calendar_id?.trim() || null
  const storedBusyIds = (row.commercial_busy_calendar_ids ?? []).filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  )
  const busyCalendarIds = calendarId
    ? Array.from(new Set([...storedBusyIds, calendarId]))
    : Array.from(new Set(storedBusyIds))

  return {
    calendarId,
    busyCalendarIds,
    meetingDurationMin: row.commercial_meeting_duration_min,
    timezone: row.commercial_timezone,
    businessHours: row.commercial_business_hours ?? {},
    minLeadTimeMin: row.commercial_min_lead_time_min,
    bufferMin: row.commercial_buffer_min,
    maxBusinessDaysAhead: row.commercial_max_business_days_ahead,
  }
}
