"use client";

import type { ReactNode } from "react";

export function AuthBrandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-between p-4 sm:p-6 bg-background overflow-hidden">
      {/* Subtle Ambient Background Gradients */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[500px] rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 right-1/4 h-[400px] w-[400px] rounded-full bg-emerald-500/10 blur-[120px]" />

      {/* Decorative Grid Pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02] dark:opacity-[0.04]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
          backgroundSize: "32px 32px",
        }}
      />

      {/* Top spacer for balanced vertical centering */}
      <div className="w-full h-2 sm:h-6" />

      {/* Centered Auth Card Container */}
      <main className="relative z-10 w-full max-w-md my-auto py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full text-center text-xs text-muted-foreground pb-4 pt-2">
        <p>Fly Order Logistics & Delivery • Official WhatsApp CRM</p>
      </footer>
    </div>
  );
}
