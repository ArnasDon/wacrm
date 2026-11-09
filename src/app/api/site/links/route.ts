import { NextResponse } from "next/server";
import { quemNoSite } from "@/lib/patio/site-servidor";
import { lerDocumento, atualizarCampos, consultarDesde } from "@/lib/patio/firestore";
import { caminhosDaPagina, contarCliques } from "@/lib/patio/site";

export const dynamic = "force-dynamic";

// Página de links (Firestore site/links, campo "pagina") + cliques dos últimos 30 dias.
export async function GET() {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  const doc = (await lerDocumento(quem.projeto, "site/links")) ?? {};
  let cliques: { alvo: string; cliques: number }[] = [];
  try {
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    cliques = contarCliques(await consultarDesde(quem.projeto, "linksEventos", "ts", desde));
  } catch (e) {
    console.error("[site/links] cliques:", e);
  }
  return NextResponse.json({ pagina: (doc.pagina as Record<string, unknown>) ?? {}, cliques });
}

export async function PUT(req: Request) {
  const quem = await quemNoSite();
  if (quem instanceof NextResponse) return quem;
  let corpo: { pagina?: Record<string, unknown> };
  try { corpo = await req.json(); } catch { return NextResponse.json({ erro: "pedido inválido" }, { status: 400 }); }
  if (!corpo.pagina || typeof corpo.pagina !== "object") return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  try {
    await atualizarCampos(quem.projeto, "site/links", { pagina: corpo.pagina }, caminhosDaPagina(corpo.pagina));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[site/links]", e);
    return NextResponse.json({ erro: "Não foi possível salvar agora." }, { status: 502 });
  }
}
