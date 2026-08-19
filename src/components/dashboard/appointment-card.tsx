'use client'

import { memo } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Appointment, AppointmentType } from '@/types'

// Left-border accent per appointment type — a quiet extra signal on
// the card, not one of the 3 required text lines (client/time/property).
const TYPE_BORDER_CLASSES: Record<AppointmentType, string> = {
  call: 'border-l-blue-500',
  visit: 'border-l-violet-500',
  meeting: 'border-l-emerald-500',
  proposal: 'border-l-amber-500',
  follow_up: 'border-l-orange-500',
  other: 'border-l-slate-400',
}

interface AppointmentCardProps {
  appointment: Appointment
  /** Called with the card's own bounding box (captured synchronously at
   *  click time) so the detail popup can grow out of this exact card —
   *  see useFlipTransition. */
  onSelect: (appointment: Appointment, originRect: DOMRect) => void
  onToggleComplete: (appointment: Appointment) => void
}

/** Memoized — same reasoning as PipelineBoard's DealCard: opening the
 *  detail popup only ever changes AgendaWeek's `detailAppointment`/
 *  `detailOriginRect` state, unrelated to any card's own `appointment`
 *  prop, so re-rendering every sibling card (up to 6 columns' worth)
 *  on that update is pure waste competing with the popup's own opening
 *  animation for the first frame. */
export const AppointmentCard = memo(function AppointmentCard({
  appointment: a,
  onSelect,
  onToggleComplete,
}: AppointmentCardProps) {
  const t = useTranslations('Dashboard.agenda')
  // 3rd line is conditional on type: Visita/Proposta are about a
  // specific listing, so the property name stays. Every other type
  // (Ligação, Reunião, Follow-up, Outro) shows the appointment's
  // Título instead — a property name is often empty or irrelevant for
  // those (e.g. "elaborar aditivo contratual"), and every appointment
  // always has a título (required field), unlike Descrição.
  const showsProperty = a.type === 'visit' || a.type === 'proposal'
  const thirdLineText = showsProperty ? a.property?.name || t('noPropertyShort') : a.title
  // Native `title` attribute as a plain hover fallback (works with
  // just the mouse, no JS) alongside the dedicated info icon below,
  // which also works on tap.
  const thirdLineTitleAttr = showsProperty ? (a.property?.name ?? undefined) : a.title
  const isCompleted = a.status === 'completed'

  function handleActivate(originRect: DOMRect) {
    onSelect(a, originRect)
  }

  return (
    // A `<div role="button">`, not a native `<button>`: the info icon
    // below is itself a real `<button>` (TooltipTrigger), and nesting
    // button-in-button is invalid HTML — the browser closes the outer
    // one the instant it hits the inner one, breaking the card's
    // layout. onKeyDown mirrors the Enter/Space activation a real
    // button gets for free.
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => handleActivate(e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleActivate(e.currentTarget.getBoundingClientRect())
        }
      }}
      className={`relative w-full cursor-pointer rounded-md border border-l-2 border-border bg-card p-2.5 pr-7 text-left transition-colors hover:border-primary/40 ${
        isCompleted ? 'border-l-[#00E5FF] opacity-[0.45]' : TYPE_BORDER_CLASSES[a.type]
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          // Keep the card's own onClick (open detail sheet) from also
          // firing on a checkbox click — see the card's role="button"
          // comment above for why this can't be a native nested
          // <button>-in-<button> either way; this is the checkbox
          // itself, not nested inside another button.
          e.stopPropagation()
          onToggleComplete(a)
        }}
        aria-label={t('toggleCompleteLabel')}
        aria-pressed={isCompleted}
        className={`absolute right-3 top-3 flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-[1.5px] transition-colors ${
          isCompleted
            ? 'border-[#00E5FF] bg-[#00E5FF]'
            : 'border-[#334155] bg-transparent hover:border-[#64748B]'
        }`}
      >
        {isCompleted && <Check className="h-3 w-3 text-black" strokeWidth={2} />}
      </button>
      <p className={`truncate text-sm font-semibold text-foreground ${isCompleted ? 'line-through' : ''}`}>
        {a.contact?.name || a.contact?.phone || a.client_name || t('noContactShort')}
      </p>
      <p className="mt-0.5 text-xs tabular-nums text-foreground/80">
        {a.scheduled_time ? a.scheduled_time.slice(0, 5) : t('allDay')}
      </p>
      <div className="mt-0.5 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={thirdLineTitleAttr}>
          {thirdLineText}
        </p>
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-label={t('appointmentDetailsLabel')}
            // Stops the click from also bubbling up to the card's own
            // onClick (which would open the full detail sheet on top
            // of the tooltip) — this is meant to be a quick peek, not
            // a navigation.
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-muted-foreground/60 hover:text-foreground"
          >
            <Info className="size-3" />
          </TooltipTrigger>
          <TooltipContent className="block max-w-56">
            {/* TooltipContent's own base class is `inline-flex
                items-center` (built for a short one-line label) —
                wrapping in a single flex-col child isolates our
                multi-paragraph content from that row layout so
                título/descrição/observações stack instead of sitting
                side by side. */}
            <div className="flex flex-col gap-1 text-left">
              <p className="font-medium">{a.title}</p>
              {a.description ? <p className="text-background/80">{a.description}</p> : null}
              {a.notes ? <p className="text-background/80">{a.notes}</p> : null}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
})
