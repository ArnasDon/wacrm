"use client"

import { useState } from 'react'
import Link from 'next/link'
import { UserPlus, Layers, Radio, Calculator } from 'lucide-react'
import type { ComponentType } from 'react'
import { SegmentsManagerDialog } from '@/components/segments/segments-manager-dialog'

import { useTranslations } from 'next-intl'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow, except Segments, which opens its own
// management dialog right here — there's no dedicated page for it.
interface Action {
  labelKey: string
  icon: ComponentType<{ className?: string }>
  tint: string
  href?: string
  onClick?: () => void
}

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions')
  const [segmentsOpen, setSegmentsOpen] = useState(false)

  const actions: Action[] = [
    { labelKey: 'newContact', href: '/contacts', icon: UserPlus, tint: 'text-primary' },
    {
      labelKey: 'segments',
      icon: Layers,
      tint: 'text-blue-400',
      onClick: () => setSegmentsOpen(true),
    },
    { labelKey: 'newBroadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-amber-400' },
    { labelKey: 'calculadora', href: '/calculadora', icon: Calculator, tint: 'text-primary' },
  ]

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actions.map((a) => {
          const Icon = a.icon
          const content = (
            <>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-muted ${a.tint}`}>
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium text-foreground">{t(a.labelKey as string)}</span>
            </>
          )
          const className =
            'group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/60'

          return a.href ? (
            <Link key={a.labelKey} href={a.href} className={className}>
              {content}
            </Link>
          ) : (
            <button key={a.labelKey} type="button" onClick={a.onClick} className={className}>
              {content}
            </button>
          )
        })}
      </div>

      <SegmentsManagerDialog open={segmentsOpen} onOpenChange={setSegmentsOpen} />
    </>
  )
}
