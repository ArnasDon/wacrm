import { notFound } from "next/navigation";

import { requirePlatformAdmin } from "@/lib/auth/platform-admin";

// Sempre dinâmico: o gate depende de quem está logado.
export const dynamic = "force-dynamic";

/**
 * Console da CCC (/ccc/*) — ferramenta do consultor, não do tenant.
 *
 * Este gate só esconde a tela. A autorização de verdade está em cada
 * rota /api/ccc/* (requirePlatformAdmin), porque layout não re-renderiza
 * em navegação client-side e a API é o que toca o dado.
 */
export default async function CccLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requirePlatformAdmin();
  } catch {
    // 404, não 403 — mesmo padrão do /admin.
    notFound();
  }
  return children;
}
