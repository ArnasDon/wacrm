import type { Metadata } from "next";
import { connection } from "next/server";
import { estadoVisibilidad } from "@/modulos/visibilidad/servidor";
import { DashboardShell } from "./dashboard-shell";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
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

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Lee la config de módulos en cada request (el build no tiene config/).
  await connection();
  const { activo } = estadoVisibilidad();
  return <DashboardShell visibilidadActiva={activo}>{children}</DashboardShell>;
}
