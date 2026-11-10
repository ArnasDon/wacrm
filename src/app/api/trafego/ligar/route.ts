import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { createAdminClient } from "@/lib/trafego/admin";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { FINALIDADES } from "@/lib/trafego/finalidades";
import { carrosDoPatio, parDoCarro } from "@/lib/trafego/carros-patio";
import { carregarGastoPorCarro, partesPorCarro } from "@/lib/trafego/gasto-carro";
import { montarLigacoes, type CarroDoPatio, type CampanhaCrua, type VeiculoCru, type Metrica } from "@/lib/trafego/ligacoes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  /api/trafego/ligar — campanhas com gasto e a ligação de cada uma
//      (carro do Pátio, finalidade, carro fora do Pátio ou nada), mais a
//      sugestão e a lista de carros do Pátio para buscar.
// POST /api/trafego/ligar { campanhas: [...ids], patioId } — liga ao carro do Pátio
//      (cria o par no Marketing se ainda não existir);
//      { campanhas, finalidade } — liga a uma finalidade; { campanhas, limpar: true } — desfaz.
// Sócios e marketing.

async function quem() {
  const q = await quemNoPatio();
  if ("erro" in q) return NextResponse.json({ erro: q.erro }, { status: q.status });
  if (q.papel === "vendedor") return NextResponse.json({ erro: "Só sócios e marketing." }, { status: 403 });
  if (situacaoChave() !== "ok") return NextResponse.json({ erro: "A chave do Firebase não está pronta." }, { status: 503 });
  return q;
}

export async function GET() {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const admin = createAdminClient();
  try {
    const { data: dest } = await admin.from("tr_link_destinos").select("id, nome").eq("org_id", q.orgId);
    const destinos = Object.fromEntries((dest ?? []).map((d) => [String(d.id), String(d.nome)]));
    const [patio, camps, veic, mets, gasto] = await Promise.all([
      carrosDoPatio(q.projeto),
      fetchAll<CampanhaCrua>((a, b) => admin.from("tr_campaigns").select("id, nome, objetivo, status, car_id, categoria_objetivo, destino_id").eq("org_id", q.orgId).order("id").range(a, b)),
      fetchAll<VeiculoCru>((a, b) => admin.from("veiculos").select("id, modelo, placa, site_vehicle_id").eq("org_id", q.orgId).order("id").range(a, b)),
      fetchAll<Metrica>((a, b) => admin.from("tr_campaign_metrics_daily").select("id, campaign_id, data, gasto, msgs").eq("org_id", q.orgId).order("id").range(a, b)),
      carregarGastoPorCarro(admin, q.orgId),
    ]);
    const divisao = new Map(gasto.campanhas.map((c) => [c.id, c.divisao]));
    const partes: Record<string, { car_id: string; gasto: number; msgs: number }[]> = {};
    for (const p of partesPorCarro(gasto.linhas)) if (divisao.get(p.campaign_id)) (partes[p.campaign_id] ??= []).push(p);
    const campanhas = camps.data.map((c) => ({ ...c, divisao: divisao.get(c.id) ?? null }));
    if (camps.error || veic.error || mets.error) throw new Error("dados do Marketing não carregaram");
    const linhas = montarLigacoes(campanhas, veic.data, patio, mets.data, destinos, partes);
    return NextResponse.json({ linhas, patio: patio.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), finalidades: FINALIDADES });
  } catch (e) {
    console.error("[trafego/ligar]", e);
    return NextResponse.json({ erro: "Não foi possível carregar as campanhas agora." }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const corpo = (await req.json().catch(() => ({}))) as { campanhas?: unknown; patioId?: unknown; finalidade?: unknown; limpar?: unknown };
  const ids = Array.isArray(corpo.campanhas) ? corpo.campanhas.map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : [];
  if (!ids.length || ids.length > 500) return NextResponse.json({ erro: "Escolha as campanhas." }, { status: 400 });
  const admin = createAdminClient();

  let mudar: { car_id: string | null; categoria_objetivo: string | null; destino_id?: null };
  let rotulo = "";
  if (corpo.limpar === true) {
    mudar = { car_id: null, categoria_objetivo: null, destino_id: null };
  } else if (typeof corpo.finalidade === "string" && FINALIDADES.some((f) => f.key === corpo.finalidade)) {
    mudar = { car_id: null, categoria_objetivo: corpo.finalidade, destino_id: null };
    rotulo = FINALIDADES.find((f) => f.key === corpo.finalidade)!.label;
  } else if (typeof corpo.patioId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(corpo.patioId)) {
    let carId: string;
    try { carId = await parDoCarro(admin, q.orgId, q.projeto, corpo.patioId); }
    catch (e) { return NextResponse.json({ erro: e instanceof Error ? e.message : "Carro não encontrado." }, { status: 404 }); }
    mudar = { car_id: carId, categoria_objetivo: null, destino_id: null };
  } else {
    return NextResponse.json({ erro: "Diga a que ligar." }, { status: 400 });
  }

  // ligar a um carro ou finalidade desfaz qualquer divisão da campanha
  let r = await admin.from("tr_campaigns").update({ ...mudar, divisao: null }).eq("org_id", q.orgId).in("id", ids).select("id");
  if (r.error && /divisao/.test(r.error.message)) r = await admin.from("tr_campaigns").update(mudar).eq("org_id", q.orgId).in("id", ids).select("id");
  const { data: feitas, error } = r;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ligadas: (feitas ?? []).length, rotulo });
}
