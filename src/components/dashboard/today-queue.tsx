"use client"

// ============================================================
// TodayQueue — Cola de Hoy (DAD §7.4, la vista principal).
// Tres secciones: 🔥 Menos de 30 días (urgencia=2) · ⏳ Esperando
// docs (documentos != 2) · 💤 Nurturing (el resto).
// Card = producto: nombre + chips, email/teléfono (tap → dialer /
// WhatsApp), info (última interacción con last_message_at +
// last_message_text, tiempo desde último contacto, siguiente acción,
// valor estimado). Nada de score numérico.
// Botón Llamar → POST /api/telnyx/call (mismo patrón que
// contact-sidebar.tsx:125). Móvil: Contestó / No contestó (un tap,
// registran el resultado de la llamada en el score vía set_deal_tags).
// ============================================================

import { useState } from 'react'
import { Phone, MessageSquare, Flame, Hourglass, Moon } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { formatRelative } from '@/lib/automations/trigger-meta'
import type {
  TodayQueueData,
  TodayQueueDeal,
  TodayQueueSectionKey,
} from '@/lib/dashboard/types'
import { Button } from '@/components/ui/button'

const SECTION_META: Record<
  TodayQueueSectionKey,
  { icon: typeof Flame; labelKey: string }
> = {
  hot: { icon: Flame, labelKey: 'hot' },
  docs: { icon: Hourglass, labelKey: 'docs' },
  nurture: { icon: Moon, labelKey: 'nurture' },
}

// Chips de la tarjeta (DAD §7.4: 🔥⏳👻). 👻 = sin respuesta del cliente.
function chipsFor(deal: TodayQueueDeal) {
  const chips: { label: string; className: string }[] = []
  if ((deal.tags?.urgencia ?? 0) === 2)
    chips.push({ label: '🔥', className: 'bg-orange-500/15 text-orange-400' })
  if ((deal.tags?.documentos ?? 0) !== 2)
    chips.push({ label: '⏳', className: 'bg-amber-500/15 text-amber-400' })
  if ((deal.tags?.respuesta ?? 0) < 1)
    chips.push({ label: '👻', className: 'bg-slate-500/15 text-slate-400' })
  return chips
}

function lastInteraction(deal: TodayQueueDeal) {
  const conv = deal.conversation
  if (!conv?.last_message_at) return null
  const text = conv.last_message_text
  return {
    at: formatRelative(conv.last_message_at ?? undefined),
    text: text ? (text.length > 70 ? `${text.slice(0, 70)}…` : text) : null,
  }
}

interface TodayQueueProps {
  data: TodayQueueData | null
  loading: boolean
}

export function TodayQueue({ data, loading }: TodayQueueProps) {
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
                    labels={{
                      call: t('call'),
                      answered: t('answered'),
                      noAnswer: t('noAnswer'),
                      lastTouch: t('lastTouch'),
                      value: t('value'),
                      sendMessage: t('sendMessage'),
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
  labels,
}: {
  deal: TodayQueueDeal
  calling: boolean
  marking: boolean
  onCall: () => void
  onMark: (answered: boolean) => void
  labels: {
    call: string
    answered: string
    noAnswer: string
    lastTouch: string
    value: string
    sendMessage: string
  }
}) {
  const contact = Array.isArray(deal.contact) ? deal.contact[0] : deal.contact
  const chips = chipsFor(deal)
  const interaction = lastInteraction(deal)
  const phone = contact?.phone ?? ''
  const waLink = phone
    ? `https://wa.me/${phone.replace(/\D/g, '')}`
    : undefined
  const telLink = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined

  return (
    <div className="rounded-xl border border-border/50 bg-muted/70 p-3 shadow-sm">
      {/* Fila 1: nombre + chips */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {deal.title}
        </h3>
        {chips.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {chips.map((c) => (
              <span
                key={c.label}
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${c.className}`}
              >
                {c.label}
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Fila 2: email + teléfono (tap → dialer / WhatsApp) */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {contact?.email && (
          <a
            href={`mailto:${contact.email}`}
            className="truncate hover:text-foreground"
          >
            {contact.email}
          </a>
        )}
        {telLink && (
          <a href={telLink} className="hover:text-foreground">
            {phone}
          </a>
        )}
        {!contact?.email && !telLink && <span>—</span>}
      </div>

      {/* Info: última interacción + siguiente acción + valor */}
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {interaction ? (
          <p className="truncate">
            <span className="text-foreground/70">{labels.lastTouch}: </span>
            {interaction.text ?? interaction.at}
          </p>
        ) : (
          <p className="italic">{labels.lastTouch}: —</p>
        )}
        <p className="flex items-center justify-between">
          <span>{labels.value}: {formatCurrency(deal.value ?? 0, deal.currency ?? undefined)}</span>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <MessageSquare className="h-3 w-3" />
              {labels.sendMessage}
            </a>
          )}
        </p>
      </div>

      {/* Siguiente acción: botón Llamar grande (bloquea el WhatsApp de
          seguimiento hasta que la llamada termine). */}
      <Button
        type="button"
        size="sm"
        className="mt-2 w-full"
        disabled={calling || marking}
        onClick={onCall}
      >
        <Phone className="h-3.5 w-3.5" />
        {labels.call}
      </Button>

      {/* Móvil: Contestó / No contestó (un tap). */}
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 lg:hidden">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20"
          disabled={marking}
          onClick={() => onMark(true)}
        >
          {labels.answered}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
          disabled={marking}
          onClick={() => onMark(false)}
        >
          {labels.noAnswer}
        </Button>
      </div>
    </div>
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
              className="h-28 animate-pulse rounded-xl border border-border/50 bg-muted/70"
            />
          ))}
        </div>
      ))}
    </div>
  )
}
