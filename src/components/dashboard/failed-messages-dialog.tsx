'use client'

import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FailedMessage } from '@/lib/dashboard/overview'

export function FailedMessagesDialog({
  open,
  onOpenChange,
  messages,
  total,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  messages: FailedMessage[]
  total: number
}) {
  const t = useTranslations('Dashboard.overview.failedDialog')
  const format = useFormatter()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="-mx-1 max-h-[60vh] divide-y divide-border overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/inbox?c=${m.conversationId}`}
                  onClick={() => onOpenChange(false)}
                  className="block rounded-lg px-1 py-2.5 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground">
                      {m.contactName || m.contactPhone || t('unknownContact')}
                    </span>
                    <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={m.at}>
                      {format.dateTime(new Date(m.at), { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  <p className="mt-0.5 text-xs text-status-critical">
                    {m.errorTitle
                      ? m.errorCode
                        ? t('reasonWithCode', { reason: m.errorTitle, code: m.errorCode })
                        : m.errorTitle
                      : t('unknownReason')}
                  </p>
                  {m.preview ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.preview}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {total > messages.length ? (
          <p className="text-xs text-muted-foreground">{t('showingLatest', { shown: messages.length, total })}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
