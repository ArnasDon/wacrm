'use client'

import { useTranslations } from 'next-intl'
import { CalendarClock, MapPin, Users, Video, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { CalendarEvent } from '@/lib/google-calendar/types'
import { eventEdges } from '@/lib/calendar/grid'
import { formatEventRange } from './format'

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const RSVP_KEY: Record<string, string> = {
  accepted: 'rsvpAccepted',
  declined: 'rsvpDeclined',
  tentative: 'rsvpTentative',
  needsAction: 'rsvpPending',
}

export function EventDetailsDialog({
  event,
  onClose,
}: {
  event: CalendarEvent | null
  onClose: () => void
}) {
  const t = useTranslations('Calendar')

  return (
    <Dialog open={Boolean(event)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        {event ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground pr-6">{event.summary}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-1 text-sm">
              <div className="flex items-start gap-3">
                <CalendarClock className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="text-foreground capitalize">
                    {dayFmt.format(eventEdges(event).start)}
                  </div>
                  <div className="text-muted-foreground">
                    {formatEventRange(event, t('allDay'))}
                  </div>
                </div>
              </div>

              {event.location ? (
                <div className="flex items-start gap-3">
                  <MapPin className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-foreground">{event.location}</span>
                </div>
              ) : null}

              {event.meetLink ? (
                <div className="flex items-start gap-3">
                  <Video className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                  <a
                    href={event.meetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {t('joinMeet')}
                  </a>
                </div>
              ) : null}

              {event.attendees.length > 0 ? (
                <div className="flex items-start gap-3">
                  <Users className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                  <ul className="space-y-1">
                    {event.attendees.map((a) => (
                      <li key={a.email} className="text-foreground">
                        {a.displayName || a.email}
                        {a.responseStatus && RSVP_KEY[a.responseStatus] ? (
                          <span className="text-muted-foreground">
                            {' '}
                            · {t(RSVP_KEY[a.responseStatus])}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {event.description ? (
                <p className="text-muted-foreground border-border border-t pt-3 whitespace-pre-wrap">
                  {event.description}
                </p>
              ) : null}

              {event.htmlLink ? (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('openInGoogle')}
                </a>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
