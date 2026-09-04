'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Mail, Users2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

const tabs = [
  { href: '/email', labelKey: 'campaigns', icon: Send, exact: true },
  { href: '/email/lists', labelKey: 'lists', icon: Mail, exact: false },
  {
    href: '/email/subscribers',
    labelKey: 'subscribers',
    icon: Users2,
    exact: false,
  },
];

/**
 * Sub-navigation for the Email section. Mirrors the settings rail
 * pattern — a horizontal strip rather than a second sidebar, because
 * Email has three destinations, not twelve.
 */
export function EmailNav() {
  const pathname = usePathname();
  const t = useTranslations('Email.nav');

  return (
    <nav className="border-border flex gap-1 border-b">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            )}
          >
            <Icon className="h-4 w-4" />
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
