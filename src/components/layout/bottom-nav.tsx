'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Users, GitBranch, MapPin, MessageSquare, Menu, Zap, Workflow, Radio, Blocks, Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

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
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-background border-t border-border flex items-center justify-around h-16 z-40 pb-[env(safe-area-inset-bottom)]">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center min-w-[44px] min-h-[44px] gap-1 px-1 flex-1",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="size-5" />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <span className="text-[10px] font-medium truncate w-full text-center">{t(item.labelKey as any)}</span>
            </Link>
          );
        })}
        
        {/* More Button */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            render={
              <button className={cn(
                  "flex flex-col items-center justify-center min-w-[44px] min-h-[44px] gap-1 px-1 flex-1",
                  "text-muted-foreground hover:text-foreground"
                )}
              />
            }
          >
            <Menu className="size-5" />
            <span className="text-[10px] font-medium truncate w-full text-center">{t('more')}</span>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl px-2 h-[60vh] flex flex-col">
            <SheetHeader className="px-4 pb-2 text-left shrink-0">
              <SheetTitle>{t('more')}</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-4 p-4 pb-8 overflow-y-auto flex-1">
              {moreNavItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 hover:bg-muted/80">
                    <item.icon className="size-6" />
                  </div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <span className="text-[11px] text-center font-medium">{t(item.labelKey as any)}</span>
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}
