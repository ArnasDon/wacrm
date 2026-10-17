"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldAlert, BrainCircuit, Megaphone, Calculator } from 'lucide-react'
import type { ComponentType } from 'react'

import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'

// Quick-action shortcuts. Each navigates to the page that owns the relevant flow.
interface Action {
  labelKey: string
  icon: ComponentType<{ className?: string }>
  tint: string
  href: string
  badge?: number
  badgeVariant?: 'danger' | 'primary'
}

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions')
  const { accountId } = useAuth()
  const [anomaliesCount, setAnomaliesCount] = useState<number>(0)
  const [unreadNotifications, setUnreadNotifications] = useState<number>(0)

  useEffect(() => {
    let active = true

    fetch('/api/sentinela/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && typeof data.totalAnomalies === 'number') {
          setAnomaliesCount(data.totalAnomalies)
        }
      })
      .catch(() => {})

    if (accountId) {
      const supabase = createClient()
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .is('read_at', null)
        .then(({ count }) => {
          if (active && typeof count === 'number') {
            setUnreadNotifications(count)
          }
        })
    }

    return () => {
      active = false
    }
  }, [accountId])

  const totalAlerts = anomaliesCount + unreadNotifications

  const actions: Action[] = [
    {
      labelKey: 'sentinela',
      href: '/sentinela',
      icon: ShieldAlert,
      tint: anomaliesCount > 0 ? 'text-red-400' : 'text-emerald-400',
      badge: totalAlerts > 0 ? totalAlerts : undefined,
      badgeVariant: anomaliesCount > 0 ? 'danger' : 'primary',
    },
    { labelKey: 'aiCenter', href: '/agents', icon: BrainCircuit, tint: 'text-blue-400' },
    { labelKey: 'newBroadcast', href: '/campaigns/new', icon: Megaphone, tint: 'text-amber-400' },
    { labelKey: 'calculadora', href: '/calculadora', icon: Calculator, tint: 'text-primary' },
  ]

  const className =
    'group relative flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/60'

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.map((a) => {
        const Icon = a.icon
        return (
          <Link key={a.labelKey} href={a.href} className={className}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="flex-1 truncate text-sm font-medium text-foreground">
              {t(a.labelKey as string)}
            </span>
            {typeof a.badge === 'number' && a.badge > 0 && (
              <span
                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  a.badgeVariant === 'danger'
                    ? 'bg-red-500 text-white'
                    : 'bg-primary text-primary-foreground'
                }`}
              >
                {a.badge > 99 ? '99+' : a.badge}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
