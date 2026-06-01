// ============================================================
// /join/[token] layout — minimal full-bleed dark shell.
//
// The route group sits outside both `(auth)` and `(dashboard)`
// because it's hybrid: the page must render for anonymous
// visitors (to show "Sign up to join Acme") *and* for signed-in
// users (to show "Accept invite"). Reusing `(auth)`'s layout
// would funnel signed-in users through the middleware's auth-
// page redirect; reusing `(dashboard)` would funnel anonymous
// visitors through its login redirect. A dedicated layout
// avoids both.
//
// Styling matches the login / signup pages — centered card on a
// slate-950 background — so the join experience feels like a
// natural step in the auth funnel rather than a foreign page.
//
// Referrer-Policy: no-referrer
//   The plaintext invite token lives in the URL path. Without
//   this header, any externally-loaded resource (third-party
//   font, CDN script, image) would receive the full join URL in
//   its `Referer` header. The /join page doesn't currently load
//   anything external, but `Referrer-Policy: no-referrer` is a
//   cheap belt-and-braces guard against future regressions
//   accidentally leaking tokens. Per Next.js 16's `metadata`
//   export, this surfaces as `<meta name="referrer" content="no-referrer">`.
// ============================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  referrer: 'no-referrer',
  // Belt-and-braces against an invite URL ending up in search
  // results if a join page is ever crawled.
  robots: { index: false, follow: false },
};

export default function JoinLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      {children}
    </div>
  );
}
