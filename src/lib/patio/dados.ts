import type { SupabaseClient } from "@supabase/supabase-js";
import { listarPublicos, lerPrivados } from "./firestore";
import { montarCarro, diasNoPatio } from "./veiculo";
import { anunciosPorCarro } from "./anuncios";
import { fetchAll } from "@/lib/trafego/fetchAll";
import type { CarroResumo, CampanhaPeriodo } from "./resumo";
import type { Quem } from "./servidor";

/** Todos os carros completos (só servidor), com dias no pátio e anúncios dos últimos 30 dias. */
export async function carrosCompletos(quem: Quem, admin: SupabaseClient, periodo?: { desde: string; ate?: string }): Promise<CarroResumo[]> {
  const publicos = await listarPublicos(quem.projeto);
  const privados = await lerPrivados(quem.projeto, publicos.map((p) => p.id));
  const anuncios = await anunciosPorCarro(admin, quem.orgId, 30, undefined, periodo).catch(() => ({}) as Record<string, never>);
  return publicos.map((p) => {
    const c = montarCarro(p.id, p.dados, privados[p.id] ?? {}, { criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm });
    return { ...c, dias: diasNoPatio(c), anuncios: anuncios[p.id] ?? null };
  });
}

/** Gasto e conversas por campanha num período, com a situação do carro ligado. */
export async function campanhasNoPeriodo(admin: SupabaseClient, orgId: string, desde: string, ate: string): Promise<CampanhaPeriodo[]> {
  const comDiv = await admin.from("tr_campaigns").select("id, nome, status, car_id, categoria_objetivo, destino_id, divisao").eq("org_id", orgId);
  const camps: unknown[] | null = comDiv.error ? (await admin.from("tr_campaigns").select("id, nome, status, car_id, categoria_objetivo, destino_id").eq("org_id", orgId)).data : comDiv.data;
  const lista = (camps ?? []) as { id: string; nome: string; status: string | null; car_id: string | null; categoria_objetivo: string | null; destino_id: string | null; divisao?: string | null }[];
  if (!lista.length) return [];
  // Paginado: uma linha por campanha por dia passa fácil de 1.000 linhas,
  // e o Supabase corta em silêncio no milésimo (mesmo bug corrigido no painel em 08/10).
  const { data: metricas } = await fetchAll((de, fim) =>
    admin.from("tr_campaign_metrics_daily").select("id, campaign_id, gasto, msgs").eq("org_id", orgId).gte("data", desde).lte("data", ate).order("id").range(de, fim),
  );
  const soma = new Map<string, { gasto: number; msgs: number }>();
  for (const m of (metricas ?? []) as { campaign_id: string; gasto: number | string; msgs: number }[]) {
    const s = soma.get(m.campaign_id) ?? { gasto: 0, msgs: 0 };
    s.gasto += Number(m.gasto) || 0;
    s.msgs += Number(m.msgs) || 0;
    soma.set(m.campaign_id, s);
  }
  const ids = [...new Set(lista.map((c) => c.car_id).filter((x): x is string => !!x))];
  const situacao = new Map<string, boolean>();
  if (ids.length) {
    const { data: vs } = await admin.from("veiculos").select("id, status, site_status").in("id", ids);
    for (const v of (vs ?? []) as { id: string; status: string; site_status: string | null }[]) {
      situacao.set(v.id, v.status === "vendido" || v.site_status === "sold");
    }
  }
  return lista.map((c) => ({
    id: c.id,
    nome: c.nome,
    status: c.status,
    gasto: soma.get(c.id)?.gasto ?? 0,
    msgs: soma.get(c.id)?.msgs ?? 0,
    // "outra": campanha com finalidade sem carro (Instagram, site, marca…) — não é pendência.
    // dividida entre carros conta como ligada
    carro: c.divisao ? "ok" : !c.car_id ? (c.categoria_objetivo || c.destino_id ? "outra" : "sem") : situacao.get(c.car_id) ? "vendido" : "ok",
  }));
}
