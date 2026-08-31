"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react'
import type { ComponentType } from 'react'

import { useTranslations } from 'next-intl'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string
  href: string
  icon: ComponentType<{ className?: string }>
}

const ACTIONS: Action[] = [
  { labelKey: 'newContact', href: '/contacts', icon: UserPlus },
  { labelKey: 'newDeal', href: '/pipelines', icon: Briefcase },
  { labelKey: 'newBroadcast', href: '/broadcasts/new', icon: Radio },
  { labelKey: 'newAutomation', href: '/automations/new', icon: Zap },
]

// Quiet toolbar row — small bordered buttons, monochrome icons.
// No tinted icon chips; accent stays reserved for interaction
// (docs/DESIGN.md §2).
export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions')

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted/60"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            {t(a.labelKey as string)}
          </Link>
        )
      })}
    </div>
  )
}
