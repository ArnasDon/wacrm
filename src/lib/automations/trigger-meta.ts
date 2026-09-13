import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'New Message',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'First Message from Contact',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Keyword Match',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'New Contact',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversation Assigned',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Tag Added',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Time-Based',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
  },
  interactive_reply: {
    label: 'Button / List Reply',
    pillClass: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
  },
  deal_stage_changed: {
    label: 'Deal Stage',
    pillClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  deal_status_changed: {
    label: 'Deal Won / Lost',
    pillClass: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  },
  date_field_offset: {
    label: 'Date Reminder',
    pillClass: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
  calendly_booking: {
    label: 'Calendly Booking',
    pillClass: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  webhook_received: {
    label: 'Webhook',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  asaas_cobranca_vencida: {
    label: 'Asaas — overdue',
    pillClass: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
  asaas_cobranca_vence_hoje: {
    label: 'Asaas — due today',
    pillClass: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  },
  manual: {
    label: 'Manual',
    pillClass: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
  },
}

/**
 * Gatilhos que existem no union e no banco mas NUNCA são despachados — não
 * há call site: `time_based` (nada além do cron o leria, e o cron só drena
 * esperas; substituído por `date_field_offset`) e `conversation_assigned`
 * (volta com a caixa de saída da Fase 2). O builder não os oferece
 * (`TRIGGER_OPTIONS`, com teste lendo o fonte) e a grade do funil não desenha
 * cartão de chegada para eles (Codex, PR #131): o cartão afirmaria "esta
 * regra leva o card para cá" sobre regra que não roda.
 *
 * ⚠️ `manual` NÃO entra aqui, e a distinção é a razão de ele existir: ele
 * também nunca é DESPACHADO, mas TEM call site — o botão "Executar automação"
 * do menu + da conversa, por `runAutomationById`. Ele roda; só não é um
 * evento que o motor observa. Pô-lo nesta lista esconderia da grade do funil
 * justamente a automação que o operador executa à mão para mover o card.
 */
export const GATILHOS_SEM_DISPARO: ReadonlySet<AutomationTriggerType> = new Set<AutomationTriggerType>([
  'time_based',
  'conversation_assigned',
])

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-muted-foreground',
    }
  )
}

/**
 * "há 5 minutos", na língua de quem está olhando.
 *
 * ⚠️ Usa `Intl.RelativeTimeFormat` em vez de montar a string à mão. As três
 * telas que chamam isto rodam num app em português, e o que aparecia no meio
 * da frase era `5m ago` — mesmo tipo de armadilha do `toLocaleDateString`
 * com locale fixo, que o CLAUDE.md já proíbe.
 *
 * O texto de "nunca" não sai do `Intl`: vem de fora, já traduzido. O padrão
 * em inglês existe só para o chamador cujo valor nunca é nulo (o histórico,
 * onde `created_at` é NOT NULL) — não é permissão para deixar em inglês numa
 * tela onde a data pode faltar.
 */
export function formatRelative(
  iso: string | null | undefined,
  nunca = 'never',
): string {
  if (!iso) return nunca
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return nunca
  const diffSec = Math.round((Date.now() - then) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (diffSec < 60) return rtf.format(-diffSec, 'second')
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), 'minute')
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), 'hour')
  if (diffSec < 2_592_000) return rtf.format(-Math.floor(diffSec / 86400), 'day')
  return new Date(iso).toLocaleDateString()
}
