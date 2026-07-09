import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'Mensaje nuevo',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'Primer mensaje del contacto',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Coincidencia de palabra clave',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'Contacto nuevo',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversación asignada',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Etiqueta agregada',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Basado en horario',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  },
  interactive_reply: {
    label: 'Respuesta de botón / lista',
    pillClass: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
    }
  )
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'nunca'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'justo ahora'
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)}m`
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)}h`
  if (diffSec < 2_592_000) return `hace ${Math.floor(diffSec / 86400)}d`
  return new Date(iso).toLocaleDateString('es-MX')
}
