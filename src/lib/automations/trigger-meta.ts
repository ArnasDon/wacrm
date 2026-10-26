import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

/**
 * The user-visible trigger name lives in the message catalogue
 * (`Automations.builder.triggers.<id>.label`); this module only carries
 * the styling so it stays free of React and of locale.
 */
export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  },
  interactive_reply: {
    pillClass: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
  },
}

export function isKnownTrigger(t: string): t is AutomationTriggerType {
  return Object.prototype.hasOwnProperty.call(TRIGGER_META, t)
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
    }
  )
}

export type RelativeTimeKey = 'never' | 'justNow' | 'minutesAgo' | 'hoursAgo' | 'daysAgo'

/**
 * Translator for the `Automations.relative` namespace. Typed loosely so
 * next-intl's `useTranslations("Automations.relative")` result can be
 * passed straight in without this module importing React or next-intl.
 */
export type RelativeTimeTranslator = (key: RelativeTimeKey, values?: { n: number }) => string

export function formatRelative(
  iso: string | null | undefined,
  t: RelativeTimeTranslator,
): string {
  if (!iso) return t('never')
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return t('never')
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return t('justNow')
  if (diffSec < 3600) return t('minutesAgo', { n: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('hoursAgo', { n: Math.floor(diffSec / 3600) })
  if (diffSec < 2_592_000) return t('daysAgo', { n: Math.floor(diffSec / 86400) })
  return new Date(iso).toLocaleDateString()
}
