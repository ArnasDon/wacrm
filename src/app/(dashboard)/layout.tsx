import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { buildBrandMetadata } from "@/lib/branding/brand";
import { getBrand } from "@/lib/branding/server";

// Server layout that declares "do not index" metadata for the authed
// app, and brands the browser tab for the signed-in account.
//
// The robots block is belt-and-suspenders: robots.ts already disallows
// these paths at the crawler level and middleware redirects
// unauthenticated visitors — but it is SEO-critical if a URL ever
// leaks via a link shared externally.
//
// The branding half puts the account's own name in the <title> and its
// logo in the favicon, so a customer using a white-labelled deployment
// never sees "wacrm" in their tab. It is resolved here rather than in
// a client effect so the first paint of the <head> is already correct
// — no flash of the generic mark.
//
// Two things this depends on, both easy to break:
//   - `title.absolute`, not `title.default`. See buildBrandMetadata.
//   - The `private, no-store` rule in next.config.ts. This response now
//     varies per account, so it must never enter a shared cache.
export async function generateMetadata(): Promise<Metadata> {
  // Never throws — falls back to the generic brand on any failure.
  const brand = await getBrand();

  return {
    ...buildBrandMetadata(brand),
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    },
  };
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
