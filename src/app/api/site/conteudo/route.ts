import { NextResponse } from "next/server";
import { quemNoSite } from "@/lib/patio/site-servidor";
import { lerDocumento, gravarDocumento } from "@/lib/patio/firestore";
import { reconstruirSite } from "@/lib/patio/servidor";
import { createAdminClient } from "@/lib/trafego/admin";

export const dynamic = "force-dynamic";

// Conteúdo da página inicial do site (Firestore site/content), o mesmo que
// a aba "Conteúdo do site" do admin grava.
export async function GET() {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  return NextResponse.json({ conteudo: (await lerDocumento(quem.projeto, "site/content")) ?? {} });
}

export async function PUT(req: Request) {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  let corpo: { conteudo?: Record<string, unknown> };
  try { corpo = await req.json(); } catch { return NextResponse.json({ erro: "pedido inválido" }, { status: 400 }); }
  if (!corpo.conteudo || typeof corpo.conteudo !== "object") return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  try {
    // Junta com o que já existe: campo que esta tela não conhece não se perde.
    const atual = (await lerDocumento(quem.projeto, "site/content")) ?? {};
    await gravarDocumento(quem.projeto, "site/content", { ...atual, ...corpo.conteudo });
    await createAdminClient().from("patio_historico").insert({ org_id: quem.orgId, veiculo_site_id: "site:conteudo", user_id: quem.userId, quem: quem.nome, acao: "editou o conteúdo do site", campos: Object.keys(corpo.conteudo) });
    const site = await reconstruirSite(quem.projeto).catch(() => false);
    return NextResponse.json({ ok: true, siteAtualizando: site });
  } catch (e) {
    console.error("[site/conteudo]", e);
    return NextResponse.json({ erro: "Não foi possível salvar agora." }, { status: 502 });
  }
}
