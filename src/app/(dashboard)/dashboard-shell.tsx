"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { useDrawerGesture } from "@/hooks/use-drawer-gesture";
import { useAppHeight } from "@/hooks/use-app-height";
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
  useAppHeight();
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

  // 2026-08-07 (parte 31) — found via Safari Web Inspector connected
  // live to the iPhone (Develop → device), not hypothesis: focusing the
  // Inbox composer's `<textarea>` sets `document.documentElement
  // .scrollTop` to a nonzero value (measured: 354px) via iOS's native
  // "scroll the focused input into view" behavior. That's a different
  // code path from CSS-overflow-driven scrolling — confirmed neither
  // `html`/`body`'s `overflow: hidden` (globals.css, parte 24) nor
  // locking `<main>` (inbox/page.tsx, parte 28) stops it, because
  // neither of those elements is the one actually being scrolled; it's
  // `<html>` itself (`document.scrollingElement`), one level above both.
  // `--app-height`'s own math was independently confirmed correct at
  // the same moment (composer's real bottom edge exactly matched the
  // live-shrunk viewport, zero overflow) — this was purely a scroll-
  // position bug, not a sizing one. Fixed reactively: snap
  // `document.scrollingElement.scrollTop` back to 0 the instant it
  // moves, rather than trying to block it via CSS (doesn't work) or via
  // a broad `scrollTo` on every `visualViewport.resize` (tried in parte
  // 17, reverted in parte 18 — at the time it fought a height
  // adjustment the composer still needed; that need is gone now that
  // the height math is confirmed correct on its own).
  useEffect(() => {
    const resetDocumentScroll = () => {
      const scroller = document.scrollingElement;
      if (scroller && scroller.scrollTop !== 0) {
        scroller.scrollTop = 0;
      }
    };
    window.addEventListener("scroll", resetDocumentScroll, { passive: true });
    return () => window.removeEventListener("scroll", resetDocumentScroll);
  }, []);

  if (loading) {
    return (
      <div className="flex h-[var(--app-height,100dvh)] items-center justify-center bg-background">
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
    // Height: `var(--app-height, 100dvh)`. This line has been fought
    // over across many sessions (partes 13-16, 25-27) chasing a moving
    // target — `dvh` (and the `window.innerHeight` it tracks) has been
    // measured, on the *same real device*, at both 932 (the true full
    // screen) and 873 (59px short) minutes apart with no keyboard
    // involved. No static CSS formula built from `dvh` can be correct
    // in both states, because the correct answer genuinely differs
    // between them — every fix in that range "worked" for whichever
    // measurement motivated it and broke for the next one.
    // `window.outerHeight`, by contrast, has read 932 in *every* real-
    // device measurement taken across this project's history — the one
    // stable signal. `use-app-height.ts` sets `--app-height` from
    // `outerHeight` at rest, and switches to live `visualViewport.height`
    // tracking the moment a text field is focused (via `focusin`, not by
    // inferring keyboard state from the height number itself — that
    // inference is exactly what isn't reliable here). Only active in
    // real standalone-PWA use; a no-op on desktop or a regular Safari
    // tab, where the `100dvh` fallback is unchanged from before.
    <div
      ref={shellRef}
      data-debug-shell
      className="flex h-[var(--app-height,100dvh)] touch-pan-y overflow-hidden bg-background"
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
