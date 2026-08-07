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
      <div className="flex h-[calc(100dvh+env(safe-area-inset-top))] items-center justify-center bg-background">
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
    //
    // Height: `calc(100dvh + env(safe-area-inset-top))`, not bare
    // `100dvh` (2026-08-07, parte 16). `100dvh` alone (parte 14 — fixed
    // the on-screen-keyboard regression from parte 13's JS-based height)
    // was still leaving a gap at the *bottom* of the screen, and
    // crucially the gap showed up below *every* child of this shell —
    // the sidebar included, not just the Inbox/composer — proving the
    // shell itself, not any descendant, was rendering short. On this
    // device/iOS combination (Dynamic Island, iPhone 14 Pro Max),
    // `100dvh` in real standalone-PWA use appears to already exclude the
    // top safe-area inset from its "dynamic" viewport (a known class of
    // WebKit quirk on Dynamic-Island hardware), rather than extending
    // full-bleed under it the way `viewport-fit=cover` is supposed to
    // guarantee — so the shell (anchored at the true top of the screen)
    // came up exactly `env(safe-area-inset-top)` short at the bottom.
    // Adding that inset back in restores the shell to the true full
    // screen height. This is a *static* correction — `env(safe-area-
    // inset-top)` never changes for the keyboard — so it composes safely
    // with `dvh`'s existing, already-correct, synchronous keyboard-
    // shrink behavior (parte 14) without touching it: both still shrink
    // together when the keyboard opens, just from a taller baseline.
    // `env()` resolves to `0` on any device without a notch (desktop,
    // older phones), so this is a no-op there — not iPhone-14-specific,
    // a general formula.
    <div
      ref={shellRef}
      data-debug-shell
      className="flex h-[calc(100dvh+env(safe-area-inset-top))] touch-pan-y overflow-hidden bg-background"
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
