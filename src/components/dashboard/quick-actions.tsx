'use client';

import Link from 'next/link';
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

import { useTranslations } from 'next-intl';
import { OPERATIONAL_ACTION_HREFS } from '@/lib/operational-navigation';

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tint: string;
}

const ACTIONS: Action[] = [
  {
    labelKey: 'newContact',
    href: OPERATIONAL_ACTION_HREFS.newContact,
    icon: UserPlus,
    tint: 'text-primary',
  },
  {
    labelKey: 'newDeal',
    href: OPERATIONAL_ACTION_HREFS.newDeal,
    icon: Briefcase,
    tint: 'text-chart-2',
  },
  {
    labelKey: 'newBroadcast',
    href: '/broadcasts/new',
    icon: Radio,
    tint: 'text-primary',
  },
  {
    labelKey: 'newAutomation',
    href: '/automations/new',
    icon: Zap,
    tint: 'text-chart-2',
  },
];

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions');

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="decizyon-card group border-border hover:border-primary/40 flex items-center gap-3 rounded-lg border bg-card/92 px-4 py-3 transition-all hover:-translate-y-0.5 hover:bg-card-2"
          >
            <div
              className={`bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg ${a.tint}`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-foreground text-sm font-medium">
              {t(a.labelKey as string)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
