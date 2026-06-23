import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'Nova Mensagem Recebida',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'Primeira Mensagem do Contato',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Correspondência de Palavra-chave',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'Novo Contato Criado',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversa Atribuída',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Tag Adicionada',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Baseado em Tempo',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    }
  )
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'nunca'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'agora mesmo'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m atrás`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h atrás`
  if (diffSec < 2_592_000) return `${Math.floor(diffSec / 86400)}d atrás`
  return new Date(iso).toLocaleDateString('pt-BR')
}
