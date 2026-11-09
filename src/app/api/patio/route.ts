import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { listarPublicos, lerPrivados, gravarCarro } from "@/lib/patio/firestore";
import { montarCarro, filtrarParaPapel, diasNoPatio, novoCarro, separarParaFirestore, type DadosNovoCarro } from "@/lib/patio/veiculo";
import { normPlaca } from "@/lib/trafego/estoqueSite";
import { novoId } from "@/lib/patio/cloudinary";
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

// POST /api/patio — cadastra um carro novo como "Aguardando revisão"
// (igual ao "Novo veículo" e ao "Colar card do WhatsApp" do admin).
// Recusa placa que já existe no estoque.
export async function POST(req: Request) {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel === "vendedor") return NextResponse.json({ erro: "Vendedor pode consultar o pátio, mas não cadastrar." }, { status: 403 });
  if (situacaoChave() !== "ok") return NextResponse.json({ erro: "A chave do Firebase ainda não está pronta neste projeto." }, { status: 503 });
  let corpo: { dados?: DadosNovoCarro; card?: string };
  try {
    corpo = (await req.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  }
  const dados = corpo.dados ?? {};
  if (!dados.brand?.trim() || !dados.model?.trim()) return NextResponse.json({ erro: "Informe pelo menos marca e modelo." }, { status: 400 });
  const card = typeof corpo.card === "string" && corpo.card.trim() ? corpo.card.slice(0, 5000) : undefined;
  try {
    const placa = normPlaca(dados.plate);
    if (placa) {
      const existentes = await listarPublicos(quem.projeto);
      const igual = existentes.find((e) => normPlaca(String(e.dados.plate ?? "")) === placa);
      if (igual) return NextResponse.json({ erro: "Essa placa já está no pátio.", id: igual.id }, { status: 409 });
    }
    const carro = novoCarro(novoId(), dados, card);
    const { publico, privado } = separarParaFirestore(carro);
    await gravarCarro(quem.projeto, carro.id, publico, privado);
    await createAdminClient()
      .from("patio_historico")
      .insert({ org_id: quem.orgId, veiculo_site_id: carro.id, user_id: quem.userId, quem: quem.nome, acao: card ? "cadastrou colando o card" : "cadastrou", campos: [] })
      .then(({ error }) => error && console.error("[patio] histórico:", error.message));
    // rascunho não aparece no site: não precisa reconstruir agora
    return NextResponse.json({ ok: true, id: carro.id });
  } catch (e) {
    console.error("[patio] cadastrar:", e);
    return NextResponse.json({ erro: "Não foi possível cadastrar agora. Nada foi criado." }, { status: 502 });
  }
}
