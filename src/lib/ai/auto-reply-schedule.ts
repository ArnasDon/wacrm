import { hasFeature } from '@/lib/features/flags'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AutoReplySchedule {
  timeZone: string
  startHour: number
  endHour: number
}

/** A normal eligibility stop, not a provider or channel failure. */
export class OutsideAiAttentionHours extends Error {
  constructor() { super('AI automatic attention is outside the configured hours'); this.name = 'OutsideAiAttentionHours' }
}

export function parseAutoReplySchedule(raw: unknown): AutoReplySchedule | null {
  if (raw == null) return null
  if (typeof raw !== 'object') throw new Error('Invalid AI attention schedule')
  const { timeZone, startHour, endHour } = raw as AutoReplySchedule
  if (typeof timeZone !== 'string' || !Number.isInteger(startHour) || !Number.isInteger(endHour)
    || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24 || startHour === endHour) throw new Error('Invalid AI attention schedule')
  // Validate the IANA zone instead of silently falling back to the server clock.
  new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0))
  return { timeZone, startHour, endHour }
}

export function withinAiAttentionHours(schedule: AutoReplySchedule | null | undefined, now = new Date()): boolean {
  if (!schedule) return true
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timeZone, hour: '2-digit', hourCycle: 'h23',
  }).format(now))
  return schedule.startHour < schedule.endHour
    ? hour >= schedule.startHour && hour < schedule.endHour
    : hour >= schedule.startHour || hour < schedule.endHour
}

/** The existing per-account flag registry exposes this switch to admins. */
export function autoReplyScheduleForAccount(account: { feature_flags?: unknown; timezone?: string | null } | null | undefined): AutoReplySchedule | null {
  const daytime = hasFeature(account?.feature_flags, 'ai_attention_hours_8_20')
  const overnight = hasFeature(account?.feature_flags, 'ai_attention_hours_20_8')
  if (daytime && overnight) throw new Error('Conflicting AI attention schedules')
  if (!daytime && !overnight) return null
  return parseAutoReplySchedule({ timeZone: account?.timezone?.trim() || 'America/Guatemala', startHour: overnight ? 20 : 8, endHour: overnight ? 8 : 20 })
}

export async function loadAutoReplySchedule(db: SupabaseClient, accountId: string): Promise<AutoReplySchedule | null> {
  const { data, error } = await db.from('accounts').select('feature_flags, timezone').eq('id', accountId).maybeSingle()
  if (error) throw error
  return autoReplyScheduleForAccount(data)
}

/** Enforce again at the transport boundary: generation may cross 8 pm. */
export async function assertAiAttentionHours(db: SupabaseClient, accountId: string): Promise<void> {
  if (!withinAiAttentionHours(await loadAutoReplySchedule(db, accountId))) throw new OutsideAiAttentionHours()
}
