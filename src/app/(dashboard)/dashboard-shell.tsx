"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { useSwipe } from "@/hooks/use-swipe";

// Width of the left-edge activation band for the "swipe to open" sidebar
// gesture. Deliberately narrow — real page content starts at 16-24px in
// from the edge (the mobile `p-4` on `<main>` below), so this band
// never overlaps a horizontally-scrollable card row, the dashboard's
// weekly agenda, or a Pipeline column drag handle; those gestures start
// well past this. Matches common edge-swipe conventions (iOS's own
// system back-gesture uses a similarly narrow band, for the same
// non-interference reason).
const EDGE_SWIPE_ZONE_PX = 24;

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Swipe-from-the-left-edge to open, mirroring native messaging apps.
  // Closing is the drawer's own gesture (see Sidebar) since it only
  // makes sense to attach once the drawer exists in the DOM. No-op
  // (and no visual effect either way — the drawer is CSS-driven to
  // always show on lg+) if it fires on desktop; touch events simply
  // don't occur there on a mouse-only device.
  const swipeHandlers = useSwipe({
    edgeZonePx: EDGE_SWIPE_ZONE_PX,
    onSwipeRight: () => {
      if (!sidebarOpen) setSidebarOpen(true);
    },
  });

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div
      className="flex h-screen overflow-hidden bg-background"
      {...swipeHandlers}
    >
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
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
