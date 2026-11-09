import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/trafego/admin";
import { syncCredentials, type CredentialRow } from "@/lib/trafego/windsor-sync";
import { gestorDaLoja, tokensMetaDasLojas, chavesWindsorDasLojas } from "@/lib/trafego/servidor";

// Botão "Sincronizar agora" (Tráfego → Conexões e barra de sincronização).
// Só sócio/gestor, e só a loja de quem clicou.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const quem = await gestorDaLoja();
  if ("erro" in quem) return NextResponse.json({ error: quem.erro }, { status: quem.status });

  const admin = createAdminClient();
  const { data: credentials, error } = await admin
    .from("tr_integration_credentials")
    .select("id, org_id, provedor, referencia_externa")
    .eq("ativo", true)
    .eq("org_id", quem.orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tokens = await tokensMetaDasLojas(admin, [quem.orgId]);
  const windsor = await chavesWindsorDasLojas(admin).catch(() => ({}) as Record<string, string>);
  const results = await syncCredentials(
    admin,
    (credentials ?? []) as CredentialRow[],
    windsor[quem.orgId] || process.env.WINDSOR_API_KEY || "",
    "rapido",
    tokens,
  );
  return NextResponse.json({ ok: true, results });
}
