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
    // the JS listeners in useDrawerGesture to interpret. `h-dvh`
    // (100dvh) is the structural height — computed natively by the
    // browser's own layout engine, synchronously, on every frame,
    // including when the iOS on-screen keyboard opens/closes (that's
    // the entire point of the `dvh` unit: it already shrinks for the
    // keyboard as part of normal layout, no JS needed).
    //
    // A same-session experiment (2026-08-07, parte 13) replaced this
    // with a JS-computed `--app-height` read from
    // `visualViewport.height`, on the hypothesis that `dvh` itself was
    // under-reporting the real standalone-PWA height. Diagnostics the
    // user gathered from the actual device disproved that: standalone
    // was confirmed `true`, but `visualViewport.height` (873) was ~59px
    // *shorter* than `outerHeight` (932) — because `visualViewport`, on
    // iOS, deliberately reports a viewport that already excludes the
    // safe-area insets, unlike the CSS layout viewport `dvh` is based
    // on (which extends full-bleed under the notch/home-indicator with
    // `viewport-fit=cover`, letting `env(safe-area-inset-*)` carve out
    // the insets inside it). Using that shorter value as the shell's
    // structural height, while Header.tsx *also* adds its own
    // `padding-top: env(safe-area-inset-top)` inside that shell,
    // double-subtracted the same inset — leaving an unused gap at the
    // bottom (the reported "black bar"). Worse, because that height was
    // only updated via an async `resize` listener (not synchronously,
    // like native `dvh`), opening the keyboard visibly lagged behind
    // the real keyboard animation, sending the composer toward the top
    // with a large gap before the on-screen keyboard.  Reverted;
    // `h-dvh` alone is simpler and was already correct. See
    // `use-app-height.ts`/`viewport-debug-badge.tsx` removal in the
    // same commit.
    <div
      ref={shellRef}
      className="flex h-dvh touch-pan-y overflow-hidden bg-background"
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
      {/* `min-h-0` on both flex children below: a flex item's default
          `min-height: auto` lets it grow to fit its own content instead
          of respecting its flex-computed share, which for `<main>`
          specifically (holding pages of arbitrary height, e.g. Inbox's
          own fixed-height panel) could let it silently claim more room
          than the header actually leaves it. Cheap, defensive — closes
          off the *general* version of the bug the Inbox-specific
          `--header-height` fix above addresses concretely. */}
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
