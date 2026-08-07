"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { useDrawerGesture } from "@/hooks/use-drawer-gesture";
import { ViewportDebugBadge } from "@/components/debug/viewport-debug-badge";

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
      <div className="flex h-dvh items-center justify-center bg-background">
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
    // the JS listeners in useDrawerGesture to interpret. `h-dvh`.
    //
    // History, because this exact line has been fought over across many
    // sessions (partes 13-16, 25) — the *symptom* looked the same each
    // time (something at the bottom cut off) but the cause flipped
    // direction depending on what `dvh` itself measured as on the real
    // device at the time:
    //  - parte 13: `visualViewport.height` (873) read ~59px shorter
    //    than `outerHeight` (932) — but that's not `dvh`, it's a
    //    different API that deliberately excludes safe-area, and using
    //    it as the shell's height was the actual bug (parte 14 fixed
    //    the resulting keyboard regression by dropping it for plain
    //    `dvh`).
    //  - parte 16: bare `dvh` alone still looked ~59px short (matching
    //    the *safe-area-inset-top* amount), so `+ env(safe-area-inset-
    //    top)` was added to compensate.
    //  - parte 25: real on-device measurement (`getBoundingClientRect`
    //    on this exact element, not an inferred number) showed the
    //    *opposite* — shell rendered at 991px while the true screen was
    //    932px, and `991 - env(safe-area-inset-top)=59 = 932` exactly.
    //    `dvh` was, this time, already the full 932px on its own; the
    //    parte-16 addition was now double-counting the same inset,
    //    pushing the shell (and everything anchored to its bottom,
    //    composer included) 59px past the real bottom of the screen.
    // Net: `dvh` on its own has, empirically, been correct both times
    // it was actually measured directly (parte 14's fix worked; parte
    // 25's measurement shows it's exactly right again now) — the
    // *compensation* is what kept introducing the error. Reverted to
    // plain `h-dvh`; if `dvh` itself is ever again confirmed short on
    // a real device, fix it with a fresh on-device measurement at that
    // time rather than reapplying a static offset that's already
    // proven to go stale.
    <div
      ref={shellRef}
      data-debug-shell
      className="flex h-dvh touch-pan-y overflow-hidden bg-background"
    >
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <ViewportDebugBadge />
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        asideRef={asideRef}
        backdropRef={backdropRef}
      />
      {/* `min-h-0` on both flex children below: a flex item's default
          `min-height: auto` lets it grow to fit its own content instead
          of respecting its flex-computed share, which for `<main>`
          specifically (holding pages of arbitrary height, e.g. Inbox's
          own panel, sized from `<main>`'s own height — see
          inbox/page.tsx) could let it silently claim more room than
          the header actually leaves it. Cheap, defensive. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
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
