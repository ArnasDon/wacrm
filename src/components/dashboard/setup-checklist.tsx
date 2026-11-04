'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { setupSteps, type OverviewSetup } from '@/lib/dashboard/overview'
import { cn } from '@/lib/utils'

export function SetupChecklist({ setup }: { setup: OverviewSetup }) {
  const t = useTranslations('Dashboard.overview.setup')
  const steps = setupSteps(setup)
  const done = steps.filter((s) => s.done).length
  const nextId = steps.find((s) => !s.done)?.id

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('progress', { done, total: steps.length })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <div
            className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
            aria-label={t('progress', { done, total: steps.length })}
          >
            <div className="h-full rounded-full bg-status-good" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ol className="divide-y divide-border">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border',
                    s.done ? 'border-status-good bg-status-good text-white' : 'border-border',
                  )}
                >
                  {s.done ? <Check className="size-3.5" aria-hidden /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', s.done ? 'text-muted-foreground line-through' : 'text-foreground')}>
                    {t(`steps.${s.id}.title`)}
                    <span className="sr-only"> {s.done ? t('doneLabel') : t('todoLabel')}</span>
                  </p>
                  {!s.done ? <p className="text-xs text-muted-foreground">{t(`steps.${s.id}.description`)}</p> : null}
                </div>
                {!s.done ? (
                  <Link
                    href={s.href}
                    className={buttonVariants({ variant: s.id === nextId ? 'default' : 'outline', size: 'sm' })}
                  >
                    {t(`steps.${s.id}.action`)}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card className="justify-center">
        <CardContent className="py-8 text-center">
          <p className="text-sm font-semibold text-foreground">{t('previewTitle')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t('previewHint')}</p>
          <Link href="/inbox" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-4')}>
            {t('previewAction')}
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
