import type { SupabaseClient } from '@supabase/supabase-js'

import type { ConditionStepConfig } from '@/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Default condition subject when older saves omitted it (builder UI assumed tag_presence). */
export function conditionSubject(cfg: ConditionStepConfig): string {
  const s = typeof cfg.subject === 'string' ? cfg.subject.trim() : ''
  return s || 'tag_presence'
}

/**
 * Operand for tag_presence: primary `operand`, with legacy fallbacks where
 * users pasted a tag id or name into `value` instead.
 */
export function tagPresenceOperandRaw(cfg: ConditionStepConfig): string {
  const op = typeof cfg.operand === 'string' ? cfg.operand.trim() : ''
  if (op) return op
  const val = typeof cfg.value === 'string' ? cfg.value.trim() : ''
  return val
}

export function normalizeTagUuid(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const lower = t.toLowerCase()
  return UUID_RE.test(lower) ? lower : null
}

/**
 * Resolve operand to a tags.id for this account — accepts UUID or tag name
 * (case-insensitive exact match).
 */
export async function resolveTagIdForAccount(
  db: SupabaseClient,
  accountId: string,
  rawOperand: string,
): Promise<string | null> {
  const trimmed = rawOperand.trim()
  if (!trimmed) return null

  const asUuid = normalizeTagUuid(trimmed)
  if (asUuid) {
    const { data, error } = await db
      .from('tags')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', asUuid)
      .maybeSingle()
    if (error) {
      console.error('[automations] tag_presence tag lookup failed:', error)
      return null
    }
    return data?.id ? String(data.id).toLowerCase() : null
  }

  const { data, error } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', trimmed)
    .maybeSingle()
  if (error) {
    console.error('[automations] tag_presence tag name lookup failed:', error)
    return null
  }
  return data?.id ? String(data.id).toLowerCase() : null
}

export async function contactHasTag(
  db: SupabaseClient,
  contactId: string,
  tagId: string,
): Promise<{ present: boolean; count: number }> {
  const { count, error } = await db
    .from('contact_tags')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', contactId)
    .eq('tag_id', tagId)

  if (error) {
    console.error('[automations] tag_presence contact_tags query failed:', error)
    return { present: false, count: 0 }
  }
  const n = count ?? 0
  return { present: n > 0, count: n }
}
