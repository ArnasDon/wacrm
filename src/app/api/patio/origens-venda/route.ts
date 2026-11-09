import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { listarPublicos, lerPrivados } from "@/lib/patio/firestore";
import { listaDeOrigens } from "@/lib/patio/origem-venda";
import { createAdminClient } from "@/lib/trafego/admin";

export const dynamic = "force-dynamic";

// GET /api/patio/origens-venda — opções para a origem da venda: as fixas,
// as personalizadas já usadas em outras vendas e os nomes dos vendedores.
// Só sócio (a venda é dado de sócio).
export async function GET() {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel !== "socio") return NextResponse.json({ erro: "Só sócio." }, { status: 403 });
  let usadas: string[] = [];
  if (situacaoChave() === "ok") {
    try {
      const pub = await listarPublicos(quem.projeto);
      const priv = await lerPrivados(quem.projeto, pub.filter((p) => p.dados.status === "sold").map((p) => p.id));
      usadas = Object.values(priv).map((p) => String(((p.sale ?? {}) as Record<string, unknown>).origem ?? "")).filter(Boolean);
    } catch { /* só as fixas */ }
  }
  const admin = createAdminClient();
  const [{ data: contas }, { data: sellers }] = await Promise.all([
    admin.from("accounts").select("id").eq("organization_id", quem.orgId),
    admin.from("tr_sellers").select("nome").eq("org_id", quem.orgId),
  ]);
  const ids = (contas ?? []).map((c) => c.id as string);
  const { data: perfis } = ids.length ? await admin.from("profiles").select("full_name").in("account_id", ids) : { data: [] };
  const vendedores = [...new Set([...(sellers ?? []).map((s) => String(s.nome ?? "")), ...(perfis ?? []).map((p) => String(p.full_name ?? ""))].map((n) => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return NextResponse.json({ origens: listaDeOrigens(usadas), vendedores });
}
