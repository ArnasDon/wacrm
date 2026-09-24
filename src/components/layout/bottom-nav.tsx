'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  GitBranch,
  MapPin,
  MessageSquare,
  Menu,
  Zap,
  Workflow,
  Radio,
  Blocks,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const mainNavItems = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/contacts', labelKey: 'contacts', icon: Users },
  { href: '/pipelines', labelKey: 'pipelines', icon: GitBranch },
  { href: '/site-visits', labelKey: 'visits', icon: MapPin },
  { href: '/inbox', labelKey: 'inbox', icon: MessageSquare },
];

const moreNavItems = [
  { href: '/automations', labelKey: 'automations', icon: Zap },
  { href: '/flows', labelKey: 'flows', icon: Workflow },
  { href: '/broadcasts', labelKey: 'broadcasts', icon: Radio },
  { href: '/agents', labelKey: 'aiAgents', icon: Blocks },
  { href: '/settings', labelKey: 'settings', icon: SettingsIcon },
];

export function BottomNav() {
  const t = useTranslations('Sidebar');
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav className="bg-background border-border fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t pb-[env(safe-area-inset-bottom)] md:hidden">
        {mainNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 px-1',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className="size-5" />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <span className="w-full truncate text-center text-[10px] font-medium">
                {t(item.labelKey as any)}
              </span>
            </Link>
          );
        })}

        {/* More Button */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            render={
              <button
                className={cn(
                  'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 px-1',
                  'text-muted-foreground hover:text-foreground'
                )}
              />
            }
          >
            <Menu className="size-5" />
            <span className="w-full truncate text-center text-[10px] font-medium">
              {t('more')}
            </span>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="flex h-[60vh] flex-col rounded-t-2xl px-2"
          >
            <SheetHeader className="shrink-0 px-4 pb-2 text-left">
              <SheetTitle>{t('more')}</SheetTitle>
            </SheetHeader>
            <div className="grid flex-1 grid-cols-3 gap-4 overflow-y-auto p-4 pb-8">
              {moreNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="text-muted-foreground hover:text-primary flex flex-col items-center gap-2"
                >
                  <div className="bg-muted/50 hover:bg-muted/80 flex h-14 w-14 items-center justify-center rounded-2xl">
                    <item.icon className="size-6" />
                  </div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <span className="text-center text-[11px] font-medium">
                    {t(item.labelKey as any)}
                  </span>
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}
