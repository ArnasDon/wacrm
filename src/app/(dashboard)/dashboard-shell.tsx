"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { useDrawerGesture } from "@/hooks/use-drawer-gesture";

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

  // Drag-to-open/close the mobile drawer, tracking the finger live —
  // see use-drawer-gesture.ts. Needs refs to the shell (where the touch
  // listeners live — it has to span the whole screen so an edge-swipe
  // works from any page) and to the drawer/backdrop themselves (Sidebar
  // forwards its own internal elements up so this hook can drive their
  // transform/opacity directly during the gesture). No-op on desktop —
  // touch events simply don't occur there on a mouse-only device, and
  // the drawer is CSS-driven to always show on lg+ regardless.
  const shellRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  useDrawerGesture({
    open: sidebarOpen,
    onOpenChange: setSidebarOpen,
    containerRef: shellRef,
    panelRef: asideRef,
    backdropRef,
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
    // `touch-pan-y` tells the browser vertical scroll is still native
    // (no latency added there) while leaving horizontal gestures for
    // the JS listeners in useDrawerGesture to interpret.
    <div
      ref={shellRef}
      className="flex h-screen touch-pan-y overflow-hidden bg-background"
    >
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        asideRef={asideRef}
        backdropRef={backdropRef}
      />
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
