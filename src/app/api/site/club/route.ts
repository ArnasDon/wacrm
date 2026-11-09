import { NextResponse } from "next/server";
import { quemNoSite } from "@/lib/patio/site-servidor";
import { lerDocumento, atualizarCampos, listarColecao } from "@/lib/patio/firestore";
import { caminhosDaPagina } from "@/lib/patio/site";

export const dynamic = "force-dynamic";

// iBox Club: lote (site/links → pagina.grupo e pagina.club), link privado do
// grupo (privado/club) e membros/lista de espera (clubMembros).
export async function GET() {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  const [links, priv, membros] = await Promise.all([
    lerDocumento(quem.projeto, "site/links"),
    lerDocumento(quem.projeto, "privado/club"),
    listarColecao(quem.projeto, "clubMembros").catch(() => []),
  ]);
  const pagina = (links?.pagina as Record<string, unknown>) ?? {};
  return NextResponse.json({
    grupo: pagina.grupo ?? {},
    club: pagina.club ?? {},
    linkGrupo: (priv?.linkGrupo as string) ?? "",
    membros: membros.map((m) => ({ id: m.id, ...m.dados, consentimento: undefined })),
  });
}

export async function PUT(req: Request) {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  let corpo: { grupo?: Record<string, unknown>; club?: Record<string, unknown>; linkGrupo?: string };
  try { corpo = await req.json(); } catch { return NextResponse.json({ erro: "pedido inválido" }, { status: 400 }); }
  try {
    const pagina: Record<string, unknown> = {};
    if (corpo.grupo) pagina.grupo = corpo.grupo;
    if (corpo.club) pagina.club = corpo.club;
    await atualizarCampos(quem.projeto, "site/links", { pagina }, caminhosDaPagina(pagina));
    if (typeof corpo.linkGrupo === "string") {
      if (corpo.linkGrupo && !/^https:\/\//.test(corpo.linkGrupo)) return NextResponse.json({ erro: "O link do grupo precisa começar com https://" }, { status: 400 });
      await atualizarCampos(quem.projeto, "privado/club", { linkGrupo: corpo.linkGrupo }, ["linkGrupo"]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[site/club]", e);
    return NextResponse.json({ erro: "Não foi possível salvar agora." }, { status: 502 });
  }
}
