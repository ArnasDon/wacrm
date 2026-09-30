// ============================================================
// /partner/* layout — public, outside (auth) and (dashboard) for the
// same reason as /join: it must render for anonymous visitors and
// must not be bounced by the auth-page redirect.
//
// Referrer-Policy: no-referrer — the signup token is in the query
// string (/partner/signup?token=…), so never leak it via Referer.
// ============================================================

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default function PartnerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      {children}
    </div>
  );
}
