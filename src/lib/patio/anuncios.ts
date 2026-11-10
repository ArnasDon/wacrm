import type { SupabaseClient } from "@supabase/supabase-js";
import { IMPOSTO_META } from "./resumo";
import { carregarGastoPorCarro, partesPorCarro } from "@/lib/trafego/gasto-carro";

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
  periodo?: { desde: string; ate?: string },
): Promise<Record<string, AnunciosDoCarro>> {
  let qv = admin.from("veiculos").select("id, site_vehicle_id").eq("org_id", orgId).not("site_vehicle_id", "is", null);
  if (soCarro) qv = qv.eq("site_vehicle_id", soCarro);
  const { data: veiculos } = await qv;
  const siteDoVeiculo = new Map<string, string>();
  for (const v of (veiculos ?? []) as { id: string; site_vehicle_id: string }[]) siteDoVeiculo.set(v.id, v.site_vehicle_id);
  if (!siteDoVeiculo.size) return {};

  // Mesma regra de todas as telas: campanha inteira no carro, ou dividida
  // por anúncio / em partes (lib/trafego/gasto-carro.ts). Paginado lá dentro.
  const desde = periodo?.desde ?? new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  const g = await carregarGastoPorCarro(admin, orgId, { desde, ate: periodo?.ate });
  const camp = new Map(g.campanhas.map((c) => [c.id, c]));

  const saida: Record<string, AnunciosDoCarro> = {};
  const vistas = new Set<string>();
  for (const p of partesPorCarro(g.linhas)) {
    const site = siteDoVeiculo.get(p.car_id);
    const c = camp.get(p.campaign_id);
    if (!site || !c) continue;
    vistas.add(`${c.id}|${site}`);
    const gasto = p.gasto * (1 + IMPOSTO_META), msgs = Math.round(p.msgs);
    const alvo = (saida[site] ??= { gasto: 0, msgs: 0, campanhas: [] });
    alvo.gasto += gasto;
    alvo.msgs += msgs;
    alvo.campanhas.push({ id: c.id, nome: c.divisao ? `${c.nome} (parte deste carro)` : c.nome, status: c.status, gasto, msgs });
  }
  // campanhas ligadas sem gasto no período continuam aparecendo (com zero)
  for (const c of g.campanhas) {
    const site = !c.divisao && c.car_id ? siteDoVeiculo.get(c.car_id) : undefined;
    if (!site || vistas.has(`${c.id}|${site}`)) continue;
    (saida[site] ??= { gasto: 0, msgs: 0, campanhas: [] }).campanhas.push({ id: c.id, nome: c.nome, status: c.status, gasto: 0, msgs: 0 });
  }
  return saida;
}
