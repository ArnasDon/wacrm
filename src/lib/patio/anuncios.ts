import type { SupabaseClient } from "@supabase/supabase-js";
import { IMPOSTO_META } from "./resumo";
import { fetchAll } from "@/lib/trafego/fetchAll";

// Liga o carro do Pátio (id do documento no Firestore) às campanhas do
// módulo Tráfego: veiculos.site_vehicle_id → tr_campaigns.car_id →
// métricas diárias. Só leitura. O gasto já sai COM o imposto de 12% do Meta,
// igual aos números de Hoje e do Relatório.

export type CampanhaDoCarro = { id: string; nome: string; status: string | null; gasto: number; msgs: number };
export type AnunciosDoCarro = { gasto: number; msgs: number; campanhas: CampanhaDoCarro[] };

export async function anunciosPorCarro(
  admin: SupabaseClient,
  orgId: string,
  dias = 30,
  soCarro?: string,
): Promise<Record<string, AnunciosDoCarro>> {
  let qv = admin.from("veiculos").select("id, site_vehicle_id").eq("org_id", orgId).not("site_vehicle_id", "is", null);
  if (soCarro) qv = qv.eq("site_vehicle_id", soCarro);
  const { data: veiculos } = await qv;
  const siteDoVeiculo = new Map<string, string>();
  for (const v of (veiculos ?? []) as { id: string; site_vehicle_id: string }[]) siteDoVeiculo.set(v.id, v.site_vehicle_id);
  if (!siteDoVeiculo.size) return {};

  const { data: camps } = await admin
    .from("tr_campaigns")
    .select("id, nome, status, car_id")
    .eq("org_id", orgId)
    .in("car_id", [...siteDoVeiculo.keys()]);
  const campanhas = (camps ?? []) as { id: string; nome: string; status: string | null; car_id: string }[];
  if (!campanhas.length) return {};

  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  // Paginado: sem isso o Supabase corta em 1.000 linhas e o gasto sai menor.
  const { data: metricas } = await fetchAll((de, fim) =>
    admin.from("tr_campaign_metrics_daily").select("id, campaign_id, gasto, msgs").eq("org_id", orgId).gte("data", desde).in("campaign_id", campanhas.map((c) => c.id)).order("id").range(de, fim),
  );
  const soma = new Map<string, { gasto: number; msgs: number }>();
  for (const m of (metricas ?? []) as { campaign_id: string; gasto: number | string; msgs: number }[]) {
    const s = soma.get(m.campaign_id) ?? { gasto: 0, msgs: 0 };
    s.gasto += Number(m.gasto) || 0;
    s.msgs += Number(m.msgs) || 0;
    soma.set(m.campaign_id, s);
  }

  const saida: Record<string, AnunciosDoCarro> = {};
  for (const c of campanhas) {
    const site = siteDoVeiculo.get(c.car_id);
    if (!site) continue;
    const bruto = soma.get(c.id) ?? { gasto: 0, msgs: 0 };
    const s = { gasto: bruto.gasto * (1 + IMPOSTO_META), msgs: bruto.msgs };
    const alvo = (saida[site] ??= { gasto: 0, msgs: 0, campanhas: [] });
    alvo.gasto += s.gasto;
    alvo.msgs += s.msgs;
    alvo.campanhas.push({ id: c.id, nome: c.nome, status: c.status, gasto: s.gasto, msgs: s.msgs });
  }
  return saida;
}
