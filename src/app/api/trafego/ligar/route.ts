import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { listarPublicos } from "@/lib/patio/firestore";
import { createAdminClient } from "@/lib/trafego/admin";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { FINALIDADES } from "@/lib/trafego/finalidades";
import { normPlaca } from "@/lib/trafego/estoqueSite";
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

const s = (v: unknown) => (v == null ? "" : String(v)).trim();

async function carrosDoPatio(projeto: string): Promise<CarroDoPatio[]> {
  const pub = await listarPublicos(projeto);
  return pub
    .filter((p) => p.dados.status !== "review")
    .map((p) => {
      const d = p.dados;
      const ano = Number(String(d.year ?? "").slice(0, 4)) || null;
      return {
        id: p.id,
        nome: [s(d.brand), s(d.model), s(d.versao), s(d.year)].filter(Boolean).join(" ") || "Carro sem nome",
        placa: s(d.plate) || null,
        ano,
        status: s(d.status),
        img: s(d.img) || null,
        modelo: s(d.model) || null,
        preco: Number((d.finance as Record<string, unknown> | undefined)?.sale_price) || null,
      };
    });
}

export async function GET() {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const admin = createAdminClient();
  try {
    const { data: dest } = await admin.from("tr_link_destinos").select("id, nome").eq("org_id", q.orgId);
    const destinos = Object.fromEntries((dest ?? []).map((d) => [String(d.id), String(d.nome)]));
    const [patio, camps, veic, mets] = await Promise.all([
      carrosDoPatio(q.projeto),
      fetchAll<CampanhaCrua>((a, b) => admin.from("tr_campaigns").select("id, nome, objetivo, status, car_id, categoria_objetivo, destino_id").eq("org_id", q.orgId).order("id").range(a, b)),
      fetchAll<VeiculoCru>((a, b) => admin.from("veiculos").select("id, modelo, placa, site_vehicle_id").eq("org_id", q.orgId).order("id").range(a, b)),
      fetchAll<Metrica>((a, b) => admin.from("tr_campaign_metrics_daily").select("id, campaign_id, data, gasto, msgs").eq("org_id", q.orgId).order("id").range(a, b)),
    ]);
    if (camps.error || veic.error || mets.error) throw new Error("dados do Marketing não carregaram");
    const linhas = montarLigacoes(camps.data, veic.data, patio, mets.data, destinos);
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
    const patioId = corpo.patioId;
    // o par do carro no Marketing; se não houver, cria a partir do Pátio
    const { data: par } = await admin.from("veiculos").select("id").eq("org_id", q.orgId).eq("site_vehicle_id", patioId).maybeSingle();
    let carId = par?.id as string | undefined;
    if (!carId) {
      const carro = (await carrosDoPatio(q.projeto)).find((c) => c.id === patioId);
      if (!carro) return NextResponse.json({ erro: "Carro não encontrado no Pátio." }, { status: 404 });
      const { data: usadas } = await admin.from("veiculos").select("placa").eq("org_id", q.orgId);
      const placasUsadas = new Set((usadas ?? []).map((u) => String(u.placa ?? "").toUpperCase()));
      let placa = normPlaca(carro.placa) || `SITE-${patioId.slice(0, 8).toUpperCase()}`;
      if (placasUsadas.has(placa)) placa = `${placa}-${patioId.slice(0, 4).toUpperCase()}`;
      const { data: novo, error } = await admin
        .from("veiculos")
        .insert({ org_id: q.orgId, placa, modelo: carro.nome, ano: carro.ano, status: carro.status === "sold" ? "vendido" : "estoque", origem: "site", site_vehicle_id: patioId, nome_site: carro.nome, modelo_site: carro.modelo, foto_url: carro.img })
        .select("id")
        .single();
      if (error || !novo) return NextResponse.json({ erro: `Não consegui preparar o carro: ${error?.message ?? ""}` }, { status: 500 });
      carId = novo.id as string;
    }
    mudar = { car_id: carId, categoria_objetivo: null, destino_id: null };
  } else {
    return NextResponse.json({ erro: "Diga a que ligar." }, { status: 400 });
  }

  const { data: feitas, error } = await admin.from("tr_campaigns").update(mudar).eq("org_id", q.orgId).in("id", ids).select("id");
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ligadas: (feitas ?? []).length, rotulo });
}
