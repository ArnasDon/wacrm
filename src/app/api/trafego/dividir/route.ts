import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { createAdminClient } from "@/lib/trafego/admin";
import { tokensMetaDasLojas } from "@/lib/trafego/servidor";
import { syncAnuncios } from "@/lib/trafego/meta-sync";
import { carrosDoPatio, parDoCarro } from "@/lib/trafego/carros-patio";
import { sugerirCarroParaCampanha } from "@/lib/trafego/estoqueSite";
import { candidatosDoNome, IMPOSTO } from "@/lib/trafego/ligacoes";
import { fetchAll } from "@/lib/trafego/fetchAll";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  /api/trafego/dividir?campanha=<id> — os anúncios da campanha (busca no
//      Facebook na primeira vez), com gasto e conversas desde o início, o carro
//      de cada um e a sugestão; e a divisão manual, se houver.
// POST /api/trafego/dividir
//      { campanha, modo: "anuncio", anuncios: [{ id, patioId | null }] }
//      { campanha, modo: "manual", carros: [{ patioId, peso }] }   (2 ou mais carros)
//      { campanha, modo: "nenhuma" }                               (desfaz a divisão)
// Sócios e marketing.

const UUID = /^[0-9a-f-]{36}$/i;
const PATIO = /^[A-Za-z0-9_-]{1,80}$/;

async function contexto() {
  const q = await quemNoPatio();
  if ("erro" in q) return { erro: NextResponse.json({ erro: q.erro }, { status: q.status }) };
  if (q.papel === "vendedor") return { erro: NextResponse.json({ erro: "Só sócios e marketing." }, { status: 403 }) };
  if (situacaoChave() !== "ok") return { erro: NextResponse.json({ erro: "A chave do Firebase não está pronta." }, { status: 503 }) };
  return { q, admin: createAdminClient() };
}

const faltaBanco = (msg: string) => /divisao|tr_ads|tr_campaign_split|tr_ad_metrics|does not exist|schema cache/i.test(msg);
const AVISO_BANCO = "Falta rodar o passo único no banco (054_divisao_campanhas.sql) para dividir campanhas.";

export async function GET(req: Request) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const { q, admin } = c;
  const id = new URL(req.url).searchParams.get("campanha") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ erro: "campanha inválida" }, { status: 400 });

  const { data: camp, error } = await admin.from("tr_campaigns").select("id, nome, external_campaign_id, divisao").eq("org_id", q.orgId).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ erro: faltaBanco(error.message) ? AVISO_BANCO : error.message }, { status: faltaBanco(error.message) ? 409 : 500 });
  if (!camp) return NextResponse.json({ erro: "Campanha não encontrada." }, { status: 404 });

  // primeira vez: busca os anúncios desta campanha no Facebook, desde o início
  let aviso = "";
  const { count } = await admin.from("tr_ads").select("id", { count: "exact", head: true }).eq("campaign_id", id);
  if (!count && camp.external_campaign_id) {
    const token = (await tokensMetaDasLojas(admin, [q.orgId]).catch(() => ({}) as Record<string, string>))[q.orgId] || process.env.META_ACCESS_TOKEN;
    const { data: cred } = await admin.from("tr_integration_credentials").select("referencia_externa").eq("org_id", q.orgId).eq("provedor", "facebook").eq("ativo", true).maybeSingle();
    if (token && cred?.referencia_externa) {
      try { await syncAnuncios(admin, q.orgId, String(cred.referencia_externa), token, [{ id, external_campaign_id: String(camp.external_campaign_id) }], "maximo"); }
      catch (e) { aviso = `Não consegui buscar os anúncios no Facebook: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`; }
    } else aviso = "Falta a conexão com o Facebook (Conexões) para buscar os anúncios.";
  }

  const [patio, { data: ads }, { data: veic }, { data: div }, { data: totalCamp }] = await Promise.all([
    carrosDoPatio(q.projeto),
    admin.from("tr_ads").select("id, nome, conjunto, status, car_id").eq("campaign_id", id),
    admin.from("veiculos").select("id, site_vehicle_id").eq("org_id", q.orgId).not("site_vehicle_id", "is", null),
    admin.from("tr_campaign_split").select("car_id, peso").eq("campaign_id", id),
    admin.from("tr_campaign_metrics_daily").select("gasto, msgs").eq("campaign_id", id).range(0, 9999),
  ]);
  const lista = (ads ?? []) as { id: string; nome: string | null; conjunto: string | null; status: string | null; car_id: string | null }[];
  const mets = lista.length
    ? (await fetchAll<{ ad_id: string; gasto: number; msgs: number }>((a, b) => admin.from("tr_ad_metrics_daily").select("id, ad_id, gasto, msgs").in("ad_id", lista.map((x) => x.id)).order("id").range(a, b))).data
    : [];
  const soma = new Map<string, { gasto: number; msgs: number }>();
  for (const m of mets) { const s = soma.get(m.ad_id) ?? { gasto: 0, msgs: 0 }; s.gasto += Number(m.gasto) || 0; s.msgs += Number(m.msgs) || 0; soma.set(m.ad_id, s); }
  const patioDoVeic = new Map(((veic ?? []) as { id: string; site_vehicle_id: string }[]).map((v) => [v.id, v.site_vehicle_id]));
  const opcoes = patio.map((p) => ({ id: p.id, placa: p.placa, modelo: p.nome, ano: p.ano, status: p.status === "sold" ? "vendido" : "estoque", nomeSite: p.nome, modeloSite: p.modelo }));

  const anuncios = lista
    .map((a) => {
      const texto = `${a.conjunto ?? ""} ${a.nome ?? ""}`;
      const sug = sugerirCarroParaCampanha(texto, opcoes);
      const cands = sug ? [sug.id] : candidatosDoNome(texto, patio).slice(0, 4).map((x) => x.id);
      const s = soma.get(a.id) ?? { gasto: 0, msgs: 0 };
      return {
        id: a.id, nome: a.nome || "(sem nome)", conjunto: a.conjunto, status: a.status,
        gasto: Math.round(s.gasto * (1 + IMPOSTO) * 100) / 100, msgs: s.msgs,
        patioId: a.car_id ? patioDoVeic.get(a.car_id) ?? null : null,
        sugestao: sug?.id ?? null, candidatos: cands,
      };
    })
    .sort((x, y) => y.gasto - x.gasto);
  const gastoCampanha = ((totalCamp ?? []) as { gasto: number }[]).reduce((s, m) => s + (Number(m.gasto) || 0), 0) * (1 + IMPOSTO);
  return NextResponse.json({
    campanha: { id, nome: camp.nome, divisao: camp.divisao, gasto: Math.round(gastoCampanha * 100) / 100 },
    anuncios,
    divisoes: ((div ?? []) as { car_id: string; peso: number }[]).map((d) => ({ patioId: patioDoVeic.get(d.car_id) ?? null, peso: Number(d.peso) })).filter((d) => d.patioId),
    aviso,
  });
}

export async function POST(req: Request) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const { q, admin } = c;
  const corpo = (await req.json().catch(() => ({}))) as { campanha?: string; modo?: string; anuncios?: { id?: string; patioId?: string | null }[]; carros?: { patioId?: string; peso?: number }[] };
  const id = String(corpo.campanha ?? "");
  if (!UUID.test(id)) return NextResponse.json({ erro: "campanha inválida" }, { status: 400 });
  const { data: camp } = await admin.from("tr_campaigns").select("id").eq("org_id", q.orgId).eq("id", id).maybeSingle();
  if (!camp) return NextResponse.json({ erro: "Campanha não encontrada." }, { status: 404 });

  try {
    const patio = await carrosDoPatio(q.projeto);
    const par = async (patioId: string) => parDoCarro(admin, q.orgId, q.projeto, patioId, patio);

    if (corpo.modo === "nenhuma") {
      await admin.from("tr_campaign_split").delete().eq("campaign_id", id);
      const { error } = await admin.from("tr_campaigns").update({ divisao: null }).eq("id", id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (corpo.modo === "anuncio") {
      const itens = (corpo.anuncios ?? []).filter((a) => UUID.test(String(a.id)));
      if (!itens.length) return NextResponse.json({ erro: "Escolha o carro dos anúncios." }, { status: 400 });
      for (const a of itens) {
        const carId = a.patioId && PATIO.test(a.patioId) ? await par(a.patioId) : null;
        const { error } = await admin.from("tr_ads").update({ car_id: carId }).eq("org_id", q.orgId).eq("campaign_id", id).eq("id", String(a.id));
        if (error) throw new Error(error.message);
      }
      await admin.from("tr_campaign_split").delete().eq("campaign_id", id);
      const { error } = await admin.from("tr_campaigns").update({ divisao: "anuncio", car_id: null, categoria_objetivo: null, destino_id: null }).eq("id", id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (corpo.modo === "manual") {
      const carros = (corpo.carros ?? []).filter((x) => x.patioId && PATIO.test(x.patioId) && Number(x.peso) > 0);
      const unicos = [...new Map(carros.map((x) => [x.patioId!, Number(x.peso)])).entries()];
      if (unicos.length < 2) return NextResponse.json({ erro: "Escolha pelo menos dois carros." }, { status: 400 });
      const linhas = [];
      for (const [patioId, peso] of unicos) linhas.push({ campaign_id: id, car_id: await par(patioId), org_id: q.orgId, peso });
      await admin.from("tr_campaign_split").delete().eq("campaign_id", id);
      const { error: e1 } = await admin.from("tr_campaign_split").insert(linhas);
      if (e1) throw new Error(e1.message);
      const { error } = await admin.from("tr_campaigns").update({ divisao: "manual", car_id: null, categoria_objetivo: null, destino_id: null }).eq("id", id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ erro: "modo inválido" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ erro: faltaBanco(msg) ? AVISO_BANCO : msg.slice(0, 200) }, { status: faltaBanco(msg) ? 409 : 500 });
  }
}
