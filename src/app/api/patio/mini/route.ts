import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { listarPublicos } from "@/lib/patio/firestore";

export const dynamic = "force-dynamic";

// GET /api/patio/mini?ids=a,b — o essencial de cada carro (nome, ano, preço,
// foto, situação) para mostrar no funil, nos contatos e nas conversas.
// Só dados que já são públicos no site. Qualquer pessoa da loja.
export type CarroMini = { id: string; nome: string; versao: string; ano: string; preco: number; img: string; status: string };

let cache: { projeto: string; quando: number; carros: Map<string, CarroMini> } | null = null;

export async function GET(req: Request) {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (situacaoChave() !== "ok") return NextResponse.json({ carros: {} });
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)).slice(0, 200);
  const todos = url.searchParams.get("todos") === "1";
  try {
    if (!cache || cache.projeto !== quem.projeto || Date.now() - cache.quando > 60_000) {
      const pub = await listarPublicos(quem.projeto);
      const m = new Map<string, CarroMini>();
      for (const p of pub) {
        const d = p.dados as Record<string, unknown>;
        const fin = (d.finance ?? {}) as Record<string, unknown>;
        m.set(p.id, {
          id: p.id,
          nome: [d.brand, d.model].filter(Boolean).join(" ") || "Carro",
          versao: String(d.versao ?? ""),
          ano: String(d.year ?? ""),
          preco: Number(fin.sale_price) || 0,
          img: String(d.img ?? ""),
          status: String(d.status ?? "available"),
        });
      }
      cache = { projeto: quem.projeto, quando: Date.now(), carros: m };
    }
    const saida: Record<string, CarroMini> = {};
    if (todos) for (const [k, v] of cache.carros) saida[k] = v;
    else for (const id of ids) { const c = cache.carros.get(id); if (c) saida[id] = c; }
    return NextResponse.json({ carros: saida });
  } catch (e) {
    console.error("[patio/mini]", e);
    return NextResponse.json({ carros: {} });
  }
}
