import type { Metadata } from "next";

// Same "do not index" treatment as the (dashboard) layout — this
// route is even more sensitive (platform-wide data across every
// store), so it gets the identical belt-and-suspenders noindex.
export const metadata: Metadata = {
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

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
