'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AccountAccessAlert } from '@/components/layout/account-access-alert';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { BrowserNotificationsListener } from '@/components/notifications/browser-notifications-listener';
import { BottomNav } from '@/components/layout/bottom-nav';
import { TopAppBar } from '@/components/layout/top-app-bar';

const pageTitles: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/inbox': 'inbox',
  '/notifications': 'notifications',
  '/contacts': 'contacts',
  '/pipelines': 'pipelines',
  '/broadcasts': 'broadcasts',
  '/automations': 'automations',
  '/settings': 'settings',
  '/site-visits': 'visits',
  '/flows': 'flows',
  '/agents': 'aiAgents',
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path)
  );
  return match ? match[1] : 'dashboard';
}

function MobileHeader() {
  const t = useTranslations('Header');
  const pathname = usePathname();
  const titleKey = getPageTitleKey(pathname);
  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
  return <TopAppBar title={t(titleKey as any)} className="md:hidden" />;
}

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const t = useTranslations('DashboardShell');

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      {/* Desktop alerts for new customer messages (opt-in via Settings →
          Your profile). Headless — renders nothing. */}
      <BrowserNotificationsListener />
      
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      
      <div className="flex flex-1 flex-col overflow-hidden relative">
        <MobileHeader />
        <div className="hidden md:block">
          <Header onOpenSidebar={() => setSidebarOpen(true)} />
        </div>
        
        {/* Thinner horizontal padding on mobile so cards have room to breathe.
            Add bottom padding on mobile to account for the bottom nav. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-20 md:pb-6">
          {/* Above every page: writes are being rejected and here's why.
              Renders nothing unless the account/role failed to resolve. */}
          <AccountAccessAlert />
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
