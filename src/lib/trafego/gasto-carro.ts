import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "./fetchAll";

// Gasto de anúncio por carro — a regra única que todas as telas usam.
//
// Uma campanha vai para os carros de um destes jeitos:
//   - sem divisão: o gasto todo vai para tr_campaigns.car_id (como sempre foi);
//   - divisão "anuncio": cada anúncio tem o seu carro (tr_ads.car_id) e o
//     carro recebe o gasto REAL daquele anúncio, dia a dia;
//   - divisão "manual": a campanha é repartida por peso entre os carros
//     (tr_campaign_split) — partes iguais ou porcentagem.
// O que não cai em nenhum carro (anúncio sem carro) fica sem carro: nunca é
// contado duas vezes. Parte pura testada em gasto-carro.test.ts.

export type CampanhaDiv = { id: string; car_id: string | null; divisao: string | null };
export type Divisao = { campaign_id: string; car_id: string; peso: number };
export type AnuncioDiv = { id: string; campaign_id: string; car_id: string | null };
export type MetricaCampanha = { campaign_id: string; data: string; gasto: number; msgs: number };
export type MetricaAnuncio = { ad_id: string; data: string; gasto: number; msgs: number };
export type GastoCarro = { car_id: string; campaign_id: string; data: string; gasto: number; msgs: number };

export function distribuirGasto(
  campanhas: CampanhaDiv[],
  metricas: MetricaCampanha[],
  divisoes: Divisao[] = [],
  anuncios: AnuncioDiv[] = [],
  metricasAnuncio: MetricaAnuncio[] = [],
): GastoCarro[] {
  const porId = new Map(campanhas.map((c) => [c.id, c]));
  const pesos = new Map<string, Divisao[]>();
  for (const d of divisoes) if (d.peso > 0) pesos.set(d.campaign_id, [...(pesos.get(d.campaign_id) ?? []), d]);
  const saida: GastoCarro[] = [];

  for (const m of metricas) {
    const c = porId.get(m.campaign_id);
    if (!c || c.divisao === "anuncio") continue; // por anúncio: vem das métricas dos anúncios
    const gasto = Number(m.gasto) || 0, msgs = Number(m.msgs) || 0;
    const partes = c.divisao === "manual" ? pesos.get(c.id) : undefined;
    if (partes?.length) {
      const total = partes.reduce((s, p) => s + p.peso, 0);
      for (const p of partes) saida.push({ car_id: p.car_id, campaign_id: c.id, data: m.data, gasto: (gasto * p.peso) / total, msgs: (msgs * p.peso) / total });
    } else if (c.car_id && c.divisao !== "manual") {
      saida.push({ car_id: c.car_id, campaign_id: c.id, data: m.data, gasto, msgs });
    }
  }

  const anuncio = new Map(anuncios.map((a) => [a.id, a]));
  for (const m of metricasAnuncio) {
    const a = anuncio.get(m.ad_id);
    if (!a?.car_id || porId.get(a.campaign_id)?.divisao !== "anuncio") continue;
    saida.push({ car_id: a.car_id, campaign_id: a.campaign_id, data: m.data, gasto: Number(m.gasto) || 0, msgs: Number(m.msgs) || 0 });
  }
  return saida;
}

/** Soma por campanha × carro (as "partes" de cada campanha em cada carro). */
export function partesPorCarro(linhas: GastoCarro[]): { campaign_id: string; car_id: string; gasto: number; msgs: number }[] {
  const m = new Map<string, { campaign_id: string; car_id: string; gasto: number; msgs: number }>();
  for (const l of linhas) {
    const k = `${l.campaign_id}|${l.car_id}`;
    const x = m.get(k) ?? { campaign_id: l.campaign_id, car_id: l.car_id, gasto: 0, msgs: 0 };
    x.gasto += l.gasto; x.msgs += l.msgs;
    m.set(k, x);
  }
  return [...m.values()];
}

/**
 * Lê do banco e distribui. Funciona também antes do passo único no banco
 * (sem as tabelas novas): aí tudo segue o car_id da campanha, como antes.
 */
export async function carregarGastoPorCarro(admin: SupabaseClient, orgId: string, periodo: { desde?: string; ate?: string } = {}) {
  let campanhas: (CampanhaDiv & { nome: string; status: string | null; categoria_objetivo: string | null; destino_id: string | null })[] = [];
  let temDivisao = true;
  const comDiv = await fetchAll<(typeof campanhas)[number]>((a, b) => admin.from("tr_campaigns").select("id, nome, status, car_id, divisao, categoria_objetivo, destino_id").eq("org_id", orgId).order("id").range(a, b));
  if (comDiv.error) {
    temDivisao = false;
    const sem = await fetchAll<Omit<(typeof campanhas)[number], "divisao">>((a, b) => admin.from("tr_campaigns").select("id, nome, status, car_id, categoria_objetivo, destino_id").eq("org_id", orgId).order("id").range(a, b));
    campanhas = sem.data.map((c) => ({ ...c, divisao: null }));
  } else campanhas = comDiv.data;

  const filtrar = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q) => {
    let r = q;
    if (periodo.desde) r = r.gte("data", periodo.desde);
    if (periodo.ate) r = r.lte("data", periodo.ate);
    return r;
  };
  const metricas = await fetchAll<MetricaCampanha>((a, b) => filtrar(admin.from("tr_campaign_metrics_daily").select("id, campaign_id, data, gasto, msgs").eq("org_id", orgId)).order("id").range(a, b));

  let divisoes: Divisao[] = [], anuncios: (AnuncioDiv & { nome: string | null; conjunto: string | null; status: string | null; categoria_objetivo: string | null })[] = [], metricasAnuncio: MetricaAnuncio[] = [];
  if (temDivisao && campanhas.some((c) => c.divisao)) {
    const [d, a, ma] = await Promise.all([
      fetchAll<Divisao>((x, y) => admin.from("tr_campaign_split").select("campaign_id, car_id, peso").eq("org_id", orgId).order("campaign_id").range(x, y)),
      fetchAll<(typeof anuncios)[number]>((x, y) => admin.from("tr_ads").select("id, campaign_id, car_id, nome, conjunto, status, categoria_objetivo").eq("org_id", orgId).order("id").range(x, y)),
      fetchAll<MetricaAnuncio>((x, y) => filtrar(admin.from("tr_ad_metrics_daily").select("id, ad_id, data, gasto, msgs").eq("org_id", orgId)).order("id").range(x, y)),
    ]);
    divisoes = d.data.map((x) => ({ ...x, peso: Number(x.peso) }));
    anuncios = a.data;
    metricasAnuncio = ma.data;
  }
  return {
    campanhas, metricas: metricas.data, divisoes, anuncios, metricasAnuncio, temDivisao,
    linhas: distribuirGasto(campanhas, metricas.data, divisoes, anuncios, metricasAnuncio),
  };
}
