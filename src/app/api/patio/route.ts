import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { listarPublicos, lerPrivados } from "@/lib/patio/firestore";
import { montarCarro, filtrarParaPapel, diasNoPatio } from "@/lib/patio/veiculo";
import { anunciosPorCarro } from "@/lib/patio/anuncios";
import { createAdminClient } from "@/lib/trafego/admin";
import { situacaoChave } from "@/lib/patio/google";

export const dynamic = "force-dynamic";

// GET /api/patio — todos os carros da loja (do Firestore do site), já
// filtrados pelo papel de quem pede, com o resumo de anúncios de cada um.
export async function GET() {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  const chave = situacaoChave();
  if (chave !== "ok") {
    return NextResponse.json(
      {
        erro:
          chave === "ausente"
            ? "Falta configurar a chave de serviço do Firebase (FIREBASE_SERVICE_ACCOUNT) neste projeto na Vercel."
            : "A chave de serviço do Firebase (FIREBASE_SERVICE_ACCOUNT) está na Vercel, mas o conteúdo não é o JSON da chave. Copie de novo o valor inteiro, começando em { e terminando em }.",
      },
      { status: 503 },
    );
  }
  try {
    const publicos = await listarPublicos(quem.projeto);
    // Privados (custo, dono, venda) só são lidos para sócios.
    const privados = quem.papel === "socio" ? await lerPrivados(quem.projeto, publicos.map((p) => p.id)) : {};
    const anuncios = await anunciosPorCarro(createAdminClient(), quem.orgId).catch(() => ({}) as Record<string, never>);
    const carros = publicos.map((p) => {
      const c = filtrarParaPapel(
        montarCarro(p.id, p.dados, privados[p.id] ?? {}, { criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm }),
        quem.papel,
      );
      return { ...c, dias: diasNoPatio(c), anuncios: (anuncios as Record<string, unknown>)[p.id] ?? null };
    });
    return NextResponse.json({ papel: quem.papel, carros });
  } catch (e) {
    console.error("[patio] listar:", e);
    return NextResponse.json({ erro: "Não foi possível ler o estoque do site agora." }, { status: 502 });
  }
}
