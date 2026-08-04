import type { useTranslations } from 'next-intl'
import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

const PILL_CLASS: Record<AutomationTriggerType, string> = {
  new_message_received: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  first_inbound_message: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  keyword_match: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  new_contact_created: 'border-primary/30 bg-primary/10 text-primary',
  conversation_assigned: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  tag_added: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  time_based: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  interactive_reply: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
}

const UNKNOWN_PILL_CLASS = 'border-slate-500/30 bg-slate-500/10 text-muted-foreground'

/**
 * Trigger badge metadata for the automations list. Reuses the same
 * translated labels as the builder's trigger picker
 * (Automations.builder.triggers.*.label) rather than maintaining a
 * second hardcoded label set — pass a `t` scoped to
 * `Automations.builder`.
 */
export function triggerMeta(
  type: AutomationTriggerType | string,
  t: ReturnType<typeof useTranslations>,
): TriggerMeta {
  const known = type in PILL_CLASS
  return {
    label: known ? t(`triggers.${type}.label`) : type,
    pillClass: known ? PILL_CLASS[type as AutomationTriggerType] : UNKNOWN_PILL_CLASS,
  }
}

/** Pass a `t` scoped to `Automations.common`. */
export function formatRelative(
  iso: string | null | undefined,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!iso) return t('relative.never')
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return t('relative.never')
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return t('relative.justNow')
  if (diffSec < 3600) return t('relative.minutesAgo', { count: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('relative.hoursAgo', { count: Math.floor(diffSec / 3600) })
  if (diffSec < 2_592_000) return t('relative.daysAgo', { count: Math.floor(diffSec / 86400) })
  return new Date(iso).toLocaleDateString()
}
