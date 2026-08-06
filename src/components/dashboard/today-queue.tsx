"use client"

// ============================================================
// TodayQueue — Cola de Hoy (DAD §7.4, la vista principal).
// Tres secciones: 🔥 Menos de 30 días (urgencia=2) · ⏳ Esperando
// docs (documentos != 2) · 💤 Nurturing (el resto).
// Card = DealCard compartida con el pipeline (Opción A): la misma
// tarjeta, monto + fecha esperada, badges won/lost, clic → editar
// deal. La cola le inyecta: chips 🔥⏳👻 (con tooltip), la
// automatización de mails enviada, botón Llamar + WhatsApp (misma
// jerarquía) y Contestó/No contestó (desktop y móvil).
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, Flame, Hourglass, Moon, MessageSquare, Send, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import type {
  TodayQueueData,
  TodayQueueDeal,
  TodayQueueSectionKey,
} from '@/lib/dashboard/types'
import { Button } from '@/components/ui/button'
import { DealCard } from '@/components/pipelines/deal-card'

const SECTION_META: Record<
  TodayQueueSectionKey,
  { icon: typeof Flame; labelKey: string }
> = {
  hot: { icon: Flame, labelKey: 'hot' },
  docs: { icon: Hourglass, labelKey: 'docs' },
  nurture: { icon: Moon, labelKey: 'nurture' },
}

// Chips de la tarjeta (DAD §7.4: 🔥⏳👻). 👻 = sin respuesta del cliente.
// El tooltip describe cada chip en texto (accesibilidad + claridad).
function chipsFor(deal: TodayQueueDeal, t: ReturnType<typeof useTranslations>) {
  const chips: { label: string; title: string; className: string }[] = []
  if ((deal.tags?.urgencia ?? 0) === 2)
    chips.push({
      label: '🔥',
      title: t('chipHot'),
      className: 'bg-orange-500/15 text-orange-400',
    })
  if ((deal.tags?.documentos ?? 0) !== 2)
    chips.push({
      label: '⏳',
      title: t('chipDocs'),
      className: 'bg-amber-500/15 text-amber-400',
    })
  if ((deal.tags?.respuesta ?? 0) < 1)
    chips.push({
      label: '👻',
      title: t('chipGhost'),
      className: 'bg-slate-500/15 text-slate-400',
    })
  return chips
}

interface TodayQueueProps {
  data: TodayQueueData | null
  loading: boolean
  /** Abre el editor de deals (DealSheet) desde la card — mismo flujo
   *  que el pipeline. Recibe el deal tal como lo trae la cola. */
  onEditDeal?: (deal: TodayQueueDeal) => void
}

export function TodayQueue({ data, loading, onEditDeal }: TodayQueueProps) {
  const t = useTranslations('Dashboard.todayQueue')
  const [callingId, setCallingId] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)

  const handleCall = async (deal: TodayQueueDeal) => {
    const contactId = Array.isArray(deal.contact)
      ? deal.contact[0]?.id
      : deal.contact?.id
    if (!contactId || callingId) return
    setCallingId(deal.id)
    try {
      const res = await fetch('/api/telnyx/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok)
        throw new Error(
          (json as { error?: string }).error ?? 'call failed',
        )
    } catch {
      toast.error(t('callFailed'))
    } finally {
      setCallingId(null)
    }
  }

  // Contestó → respuesta=2 (igual que el trigger de call answered);
  // No contestó → respuesta=0. vía set_deal_tags (DAD §7.2).
  const handleMark = async (
    deal: TodayQueueDeal,
    answered: boolean,
  ) => {
    if (markingId) return
    setMarkingId(deal.id)
    const supabase = createClient()
    const { error } = await supabase.rpc('set_deal_tags', {
      p_deal_id: deal.id,
      p_tags: { respuesta: answered ? 2 : 0 },
      p_reason: answered ? 'call answered (cola)' : 'call no answer (cola)',
    })
    if (error) toast.error(t('markFailed'))
    else toast.success(answered ? t('markedAnswered') : t('markedNoAnswer'))
    setMarkingId(null)
  }

  if (loading) return <QueueSkeleton />

  if (!data || data.total === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/70 p-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {data.sections.map((section) => {
        const meta = SECTION_META[section.key]
        const Icon = meta.icon
        return (
          <div key={section.key} className="flex min-h-0 flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Icon className="h-4 w-4 text-muted-foreground" />
              {t(meta.labelKey)}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {section.deals.length}
              </span>
            </h2>
            <div className="flex flex-col gap-2">
              {section.deals.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                  {t('none')}
                </p>
              ) : (
                section.deals.map((deal) => (
                  <QueueCard
                    key={deal.id}
                    deal={deal}
                    calling={callingId === deal.id}
                    marking={markingId === deal.id}
                    onCall={() => void handleCall(deal)}
                    onMark={(answered) => void handleMark(deal, answered)}
                    onEditDeal={onEditDeal}
                    labels={{
                      call: t('call'),
                      whatsapp: t('whatsapp'),
                      answered: t('answered'),
                      noAnswer: t('noAnswer'),
                      value: t('value'),
                      autoSent: t('autoSent'),
                      noAutomation: t('noAutomation'),
                    }}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function QueueCard({
  deal,
  calling,
  marking,
  onCall,
  onMark,
  onEditDeal,
  labels,
}: {
  deal: TodayQueueDeal
  calling: boolean
  marking: boolean
  onCall: () => void
  onMark: (answered: boolean) => void
  onEditDeal?: (deal: TodayQueueDeal) => void
  labels: {
    call: string
    whatsapp: string
    answered: string
    noAnswer: string
    value: string
    autoSent: string
    noAutomation: string
  }
}) {
  const t = useTranslations('Dashboard.todayQueue')
  const router = useRouter()
  const contact = Array.isArray(deal.contact) ? deal.contact[0] : deal.contact
  const chips = chipsFor(deal, t)
  const phone = contact?.phone ?? ''
  const convId =
    (Array.isArray(deal.conversation) ? deal.conversation[0]?.id : deal.conversation?.id) ??
    null
  const inboxHref = convId ? `/inbox?c=${convId}` : '/inbox'
  const hasWhatsApp = !!phone

  // Mapeo a la forma que DealCard espera (Deal) — la card es la misma
  // del pipeline (Opción A): monto, fecha, badges, clic → editar.
  const cardDeal = {
    ...deal,
    user_id: '',
    pipeline_id: deal.pipeline_id ?? '',
    stage_id: deal.stage_id ?? '',
    contact_id: contact?.id ?? null,
    contact: contact ?? null,
    conversation_id: convId ?? undefined,
    value: deal.value ?? 0,
    currency: deal.currency ?? undefined,
    assignee: deal.assignee ?? undefined,
    created_at: '',
  }

  return (
    <DealCard
      deal={cardDeal as Parameters<typeof DealCard>[0]['deal']}
      stage={null}
      onEdit={(d) => onEditDeal?.(deal)}
      isOverlay={false}
      rightBadges={
        chips.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {chips.map((c) => (
              <span
                key={c.label}
                title={c.title}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm ${c.className}`}
              >
                {c.label}
              </span>
            ))}
          </span>
        )
      }
      footer={
        <div className="mt-2 space-y-1.5">
          {/* Automatización de mails enviada (punto 5): secuencia o
              mail+llamada. Reemplaza el "esperando docs" estático. */}
          <p
            className="flex items-center gap-1.5 truncate rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-600 dark:text-emerald-400"
            title={labels.autoSent}
          >
            <Send className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {labels.autoSent}: {deal.lastAutomation?.name ?? labels.noAutomation}
            </span>
          </p>

          {/* Acciones: Llamar + WhatsApp misma jerarquía (punto 6) */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={calling || marking}
              onClick={(e) => {
                e.stopPropagation()
                onCall()
              }}
            >
              <Phone className="h-3.5 w-3.5" />
              {labels.call}
            </Button>
            {hasWhatsApp ? (
              <Button
                type="button"
                size="sm"
                className="w-full border-emerald-500/40 bg-emerald-500/10 text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
                onClick={(e) => {
                  e.stopPropagation()
                  router.push(inboxHref)
                }}
              >
                <MessageSquare className="size-3.5" />
                {labels.whatsapp}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                disabled
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {labels.whatsapp}
              </Button>
            )}
          </div>

          {/* Contestó / No contestó — visible en desktop y móvil (punto 1) */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20"
              disabled={marking}
              onClick={(e) => {
                e.stopPropagation()
                onMark(true)
              }}
            >
              {labels.answered}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              disabled={marking}
              onClick={(e) => {
                e.stopPropagation()
                onMark(false)
              }}
            >
              {labels.noAnswer}
            </Button>
          </div>
        </div>
      }
    />
  )
}

function QueueSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {[0, 1, 2].map((col) => (
        <div key={col} className="flex flex-col gap-3">
          <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-36 animate-pulse rounded-xl border border-border/50 bg-muted/70"
            />
          ))}
        </div>
      ))}
    </div>
  )
}
