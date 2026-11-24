"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { bottomNavItems, navItems } from "@/components/layout/nav-items";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { BrowserNotificationsListener } from "@/components/notifications/browser-notifications-listener";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const t = useTranslations("DashboardShell");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="app-canvas flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative size-12">
            <div className="absolute inset-0 rounded-full border-[3px] border-foreground/10" />
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-highlight border-t-transparent" />
          </div>
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <ShellLayout>{children}</ShellLayout>;
}

// Rendered only once a user is signed in, so the badge subscriptions
// below start with a session (same timing as the old sidebar).
function ShellLayout({ children }: { children: React.ReactNode }) {
  // Navigation drawer state — only used below lg; the desktop top bar
  // carries navigation there.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  // Badge counts are subscribed once here (each hook owns a fixed-name
  // realtime channel) and handed to both the top bar and the drawer.
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  return (
    // Outer frame: on desktop the whole app floats as one rounded
    // canvas over a cool grey backdrop, like a device mock.
    <div className="h-screen overflow-hidden bg-frame lg:p-3">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      {/* Desktop alerts for new customer messages (opt-in via Settings →
          Your profile). Headless — renders nothing. */}
      <BrowserNotificationsListener />
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        totalUnread={totalUnread}
        unreadNotifications={unreadNotifications}
      />
      <div className="app-canvas relative flex h-full flex-col overflow-hidden lg:rounded-[2.25rem] lg:shadow-float lg:ring-1 lg:ring-white/40">
        <Header
          onOpenSidebar={() => setSidebarOpen(true)}
          totalUnread={totalUnread}
          unreadNotifications={unreadNotifications}
        />
        <main className="flex-1 overflow-y-auto px-4 pt-1 pb-4 sm:px-6 sm:pb-6 lg:px-8 lg:pb-8">
          {/* Above every page: writes are being rejected and here's why.
              Renders nothing unless the account/role failed to resolve. */}
          <AccountAccessAlert />
          <PageHeading />
          {children}
        </main>
      </div>
    </div>
  );
}

// Big, light-weight section title ("Contacts", "Broadcasts", …) shown
// on top-level list pages. The dashboard has its own greeting and the
// inbox is a full-height workspace, so both are skipped, as are nested
// routes (editors, detail pages) that bring their own headers.
const HEADING_ROUTES = [
  "/notifications",
  "/contacts",
  "/pipelines",
  "/broadcasts",
  "/automations",
  "/flows",
  "/agents",
  "/settings",
];

function PageHeading() {
  const pathname = usePathname();
  const tNav = useTranslations("Sidebar");
  const item = [...navItems, ...bottomNavItems].find(
    (n) => n.href === pathname && HEADING_ROUTES.includes(n.href),
  );
  if (!item) return null;
  return (
    <div className="animate-rise mb-6 flex items-end gap-3">
      <h1 className="text-4xl leading-none font-light tracking-tight text-foreground sm:text-5xl">
        {tNav(item.labelKey)}
      </h1>
      <span className="mb-1.5 hidden h-2.5 w-2.5 rounded-full bg-highlight sm:block" aria-hidden />
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
