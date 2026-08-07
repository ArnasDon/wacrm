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
    // the JS listeners in useDrawerGesture to interpret.
    //
    // Height: `var(--app-height)`, set synchronously pre-paint by the
    // boot script in layout.tsx (`VIEWPORT_BOOT_SCRIPT`) from
    // `visualViewport.height`/`innerHeight`, falling back to `100dvh`
    // (globals.css `:root`) if that hasn't run for any reason. This
    // used to be plain `h-dvh` — simpler, and correct in every case
    // tested at the time — but real iOS standalone-PWA use (2026-08-07,
    // parte 13) showed a gap at the bottom sized like Safari's own
    // chrome despite standalone mode, meaning `dvh` itself was suspected
    // of under-reporting the true available height in that context.
    // `visualViewport.height` is what iOS actually resizes for the
    // on-screen keyboard and is the more trustworthy read of "space
    // genuinely available for content" there. A prior attempt at a JS
    // height var (removed — see git history) set it from a `useEffect`
    // *after* first paint, causing a visible reflow the moment it fired;
    // this one runs before hydration, so there's exactly one height
    // calculation, not two racing ones. `useAppHeight()` above only
    // *updates* the value post-mount (keyboard, rotation) — it never
    // sets it for the first time.
    <div
      ref={shellRef}
      className="flex touch-pan-y overflow-hidden bg-background"
      style={{ height: "var(--app-height, 100dvh)" }}
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
