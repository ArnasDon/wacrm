"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

/**
 * A platform admin inside a merchant's workspace must never forget
 * whose data they are looking at — every write from here lands on the
 * merchant's account, not theirs.
 */
function ActingBanner() {
  const { actingAsAccount, account } = useAuth();
  const [leaving, setLeaving] = useState(false);
  if (!actingAsAccount) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/15 px-4 py-2 text-xs text-amber-100">
      <span>
        You are working inside <b>{account?.name ?? "a merchant account"}</b>. Everything you change here belongs to them.
      </span>
      <button
        type="button"
        className="underline hover:text-white disabled:opacity-60"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void fetch("/api/admin/open", { method: "DELETE" })
            .then(() => window.location.assign("/admin"))
            .catch(() => setLeaving(false));
        }}
      >
        {leaving ? "Leaving…" : "Back to my account"}
      </button>
    </div>
  );
}

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <ActingBanner />
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
