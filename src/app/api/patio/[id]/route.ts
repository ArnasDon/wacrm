import { NextResponse } from "next/server";
import { quemNoPatio, reconstruirSite } from "@/lib/patio/servidor";
import { lerUm, gravarCarro, apagarCarro } from "@/lib/patio/firestore";
import { montarCarro, filtrarParaPapel, aplicarMudanca, separarParaFirestore, diasNoPatio, recorte } from "@/lib/patio/veiculo";
import { anunciosPorCarro } from "@/lib/patio/anuncios";
import { createAdminClient } from "@/lib/trafego/admin";

export const dynamic = "force-dynamic";

const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

// GET /api/patio/:id — ficha completa do carro, filtrada pelo papel.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_VALIDO.test(id)) return NextResponse.json({ erro: "carro inválido" }, { status: 400 });
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  try {
    const lido = await lerUm(quem.projeto, id);
    if (!lido) return NextResponse.json({ erro: "carro não encontrado" }, { status: 404 });
    const admin = createAdminClient();
    const completo = montarCarro(id, lido.publico.dados, lido.privado, {
      criadoEm: lido.publico.criadoEm,
      atualizadoEm: lido.publico.atualizadoEm,
    });
    const carro = filtrarParaPapel(completo, quem.papel);
    const [porCarro, porCarroTotal] = await Promise.all([
      anunciosPorCarro(admin, quem.orgId, 30, id).catch(() => ({}) as Record<string, never>),
      anunciosPorCarro(admin, quem.orgId, 3650, id).catch(() => ({}) as Record<string, never>),
    ]);
    const anuncios = porCarro[id] ?? null;
    const anunciosTotal = porCarroTotal[id] ?? null;
    const { data: vTrafego } = await admin.from("veiculos").select("id").eq("org_id", quem.orgId).eq("site_vehicle_id", id).maybeSingle();
    let historico: unknown[] = [];
    if (quem.papel === "socio") {
      const { data } = await admin
        .from("patio_historico")
        .select("criado_em, quem, acao, campos, antes, depois")
        .eq("org_id", quem.orgId)
        .eq("veiculo_site_id", id)
        .order("criado_em", { ascending: false })
        .limit(50);
      historico = data ?? [];
    }
    // Clientes interessados neste carro (contatos de qualquer conta da loja) e visitas.
    let clientes: unknown[] = [];
    let visitas: unknown[] = [];
    const { data: contas } = await admin.from("accounts").select("id").eq("organization_id", quem.orgId);
    const idsContas = (contas ?? []).map((c: { id: string }) => c.id);
    if (idsContas.length) {
      const { data: cs } = await admin
        .from("contacts")
        .select("id, name, phone, origem, created_at")
        .in("account_id", idsContas)
        .eq("veiculo_site_id", id)
        .order("created_at", { ascending: false })
        .limit(100);
      clientes = cs ?? [];
      const { data: vs } = await admin
        .from("visitas")
        .select("id, contact_id, quando, status")
        .in("account_id", idsContas)
        .eq("veiculo_site_id", id)
        .order("quando", { ascending: false })
        .limit(100);
      visitas = vs ?? [];
    }
    return NextResponse.json({ papel: quem.papel, carro: { ...carro, dias: diasNoPatio(completo) }, anuncios, anunciosTotal, veiculoTrafegoId: vTrafego?.id ?? null, historico, clientes, visitas });
  } catch (e) {
    console.error("[patio] ler:", e);
    return NextResponse.json({ erro: "Não foi possível ler este carro agora." }, { status: 502 });
  }
}

// PATCH /api/patio/:id — muda campos do carro. Lê o carro inteiro de novo
// (público + privado), aplica só o que o papel permite, grava os dois
// documentos juntos, registra no histórico e pede a reconstrução do site.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_VALIDO.test(id)) return NextResponse.json({ erro: "carro inválido" }, { status: 400 });
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  let mudanca: Record<string, unknown>;
  try {
    mudanca = (await req.json()) as Record<string, unknown>;
    if (!mudanca || typeof mudanca !== "object" || Array.isArray(mudanca)) throw new Error();
  } catch {
    return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  }
  try {
    const lido = await lerUm(quem.projeto, id);
    if (!lido) return NextResponse.json({ erro: "carro não encontrado" }, { status: 404 });
    const atual = montarCarro(id, lido.publico.dados, lido.privado, {
      criadoEm: lido.publico.criadoEm,
      atualizadoEm: lido.publico.atualizadoEm,
    });
    const r = aplicarMudanca(atual, mudanca, quem.papel);
    if ("erro" in r) return NextResponse.json({ erro: r.erro }, { status: 403 });
    if (!r.campos.length) return NextResponse.json({ ok: true, mudou: [] });

    const { publico, privado } = separarParaFirestore(r.carro);
    await gravarCarro(quem.projeto, id, publico, privado);

    const acao = r.campos.includes("status") ? `status: ${String(atual.status)} → ${String(r.carro.status)}` : "editou";
    await createAdminClient()
      .from("patio_historico")
      .insert({
        org_id: quem.orgId,
        veiculo_site_id: id,
        user_id: quem.userId,
        quem: quem.nome,
        acao,
        campos: r.campos,
        antes: recorte(atual, r.campos),
        depois: recorte(r.carro, r.campos),
      })
      .then(({ error }) => error && console.error("[patio] histórico:", error.message));

    const siteAtualizando = await reconstruirSite(quem.projeto).catch(() => false);
    return NextResponse.json({
      ok: true,
      mudou: r.campos,
      siteAtualizando,
      carro: { ...filtrarParaPapel(r.carro, quem.papel), dias: diasNoPatio(r.carro) },
    });
  } catch (e) {
    console.error("[patio] gravar:", e);
    return NextResponse.json({ erro: "Não foi possível salvar agora. Nada foi alterado." }, { status: 502 });
  }
}

// DELETE /api/patio/:id — só sócio. A ficha inteira fica guardada no histórico
// do pátio antes de apagar, para dar para recuperar.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_VALIDO.test(id)) return NextResponse.json({ erro: "carro inválido" }, { status: 400 });
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel !== "socio") return NextResponse.json({ erro: "Só sócio exclui um carro." }, { status: 403 });
  try {
    const lido = await lerUm(quem.projeto, id);
    if (!lido) return NextResponse.json({ erro: "carro não encontrado" }, { status: 404 });
    const atual = montarCarro(id, lido.publico.dados, lido.privado, { criadoEm: lido.publico.criadoEm, atualizadoEm: lido.publico.atualizadoEm });
    const { error } = await createAdminClient().from("patio_historico").insert({
      org_id: quem.orgId,
      veiculo_site_id: id,
      user_id: quem.userId,
      quem: quem.nome,
      acao: "excluiu",
      campos: ["*"],
      antes: atual as unknown as Record<string, unknown>,
      depois: null,
    });
    if (error) return NextResponse.json({ erro: "Não foi possível guardar a cópia antes de excluir. Nada foi apagado." }, { status: 502 });
    await apagarCarro(quem.projeto, id);
    const siteAtualizando = await reconstruirSite(quem.projeto).catch(() => false);
    return NextResponse.json({ ok: true, siteAtualizando });
  } catch (e) {
    console.error("[patio] excluir:", e);
    return NextResponse.json({ erro: "Não foi possível excluir agora." }, { status: 502 });
  }
}
