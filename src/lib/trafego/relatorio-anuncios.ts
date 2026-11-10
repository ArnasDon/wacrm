// Relatório detalhado de anúncios: para onde foi cada real, por carro, por
// campanha, por divisão e por dia. Parte pura (as contas); a planilha é
// montada em relatorio-anuncios-xlsx.ts. Testado em relatorio-anuncios.test.ts.
//
// Cada real gasto cai em exatamente um destino, então os grupos sempre somam
// o total da conta:
//   carro do Pátio · carro fora do Pátio (cadastro antigo do Marketing) ·
//   finalidade (Instagram, site, marca…) · sem vínculo.

import type { CampanhaDiv, Divisao, GastoCarro, MetricaCampanha } from "./gasto-carro";
import { rotuloFinalidade } from "./finalidades";

export const IMPOSTO = 0.12;
export type Destino = "patio" | "fora" | "finalidade" | "sem";
export const NOME_DESTINO: Record<Destino, string> = { patio: "Carro do Pátio", fora: "Carro fora do Pátio", finalidade: "Finalidade", sem: "Sem vínculo" };

export type CampanhaRel = CampanhaDiv & { nome: string; status: string | null; objetivo?: string | null; categoria_objetivo: string | null; destino_id: string | null };
export type CarroRel = { id: string; nome: string; placa: string | null; status: string; preco: number | null; custo?: number | null; venda?: number | null };
export type VeiculoRel = { id: string; modelo: string | null; placa: string | null; site_vehicle_id: string | null };

export type LinhaDia = { data: string; campanhaId: string; campanha: string; destino: Destino; alvo: string; carroId: string | null; gasto: number; msgs: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function montarRelatorio(p: {
  campanhas: CampanhaRel[];
  metricas: MetricaCampanha[];
  linhasCarro: GastoCarro[];
  divisoes: Divisao[];
  patio: CarroRel[];
  veiculos: VeiculoRel[];
  destinos?: Record<string, string>;
}) {
  const camp = new Map(p.campanhas.map((c) => [c.id, c]));
  const veic = new Map(p.veiculos.map((v) => [v.id, v]));
  const patio = new Map(p.patio.map((c) => [c.id, c]));
  const carroDe = (carId: string) => {
    const v = veic.get(carId);
    const pc = v?.site_vehicle_id ? patio.get(v.site_vehicle_id) : undefined;
    if (pc) return { destino: "patio" as Destino, chave: pc.id, alvo: [pc.nome, pc.placa].filter(Boolean).join(" · ") };
    return { destino: "fora" as Destino, chave: `fora:${carId}`, alvo: [v?.modelo, v?.placa].filter(Boolean).join(" · ") || "carro apagado" };
  };
  const partesDia = new Map<string, GastoCarro[]>();
  for (const l of p.linhasCarro) partesDia.set(`${l.campaign_id}|${l.data}`, [...(partesDia.get(`${l.campaign_id}|${l.data}`) ?? []), l]);

  // ---- dia a dia: cada real em um destino ----
  const dias: LinhaDia[] = [];
  const usados = new Set<string>();
  for (const m of p.metricas) {
    const c = camp.get(m.campaign_id);
    if (!c) continue;
    const gasto = Number(m.gasto) || 0, msgs = Number(m.msgs) || 0;
    if (gasto <= 0 && msgs <= 0) continue;
    const base = { data: m.data, campanhaId: c.id, campanha: c.nome };
    if (c.divisao) {
      const k = `${c.id}|${m.data}`;
      usados.add(k);
      const partes = partesDia.get(k) ?? [];
      let g = 0, mm = 0;
      for (const pt of partes) {
        const d = carroDe(pt.car_id);
        dias.push({ ...base, destino: d.destino, alvo: d.alvo, carroId: d.chave, gasto: pt.gasto, msgs: pt.msgs });
        g += pt.gasto; mm += pt.msgs;
      }
      if (gasto - g > 0.005) dias.push({ ...base, destino: "sem", alvo: "Parte da campanha dividida sem carro", carroId: null, gasto: gasto - g, msgs: Math.max(0, msgs - mm) });
    } else if (c.car_id) {
      const d = carroDe(c.car_id);
      dias.push({ ...base, destino: d.destino, alvo: d.alvo, carroId: d.chave, gasto, msgs });
    } else if (c.categoria_objetivo || c.destino_id) {
      const alvo = c.categoria_objetivo ? rotuloFinalidade(c.categoria_objetivo) : `Destino: ${p.destinos?.[c.destino_id!] ?? "cadastrado"}`;
      dias.push({ ...base, destino: "finalidade", alvo, carroId: null, gasto, msgs });
    } else {
      dias.push({ ...base, destino: "sem", alvo: "Sem vínculo", carroId: null, gasto, msgs });
    }
  }
  // partes de anúncio em dias em que a campanha não tem linha diária (raro): entram também
  for (const [k, partes] of partesDia) {
    if (usados.has(k)) continue;
    const c = camp.get(partes[0].campaign_id);
    if (!c?.divisao) continue;
    for (const pt of partes) {
      const d = carroDe(pt.car_id);
      dias.push({ data: pt.data, campanhaId: c.id, campanha: c.nome, destino: d.destino, alvo: d.alvo, carroId: d.chave, gasto: pt.gasto, msgs: pt.msgs });
    }
  }
  dias.sort((a, b) => a.data.localeCompare(b.data) || a.campanha.localeCompare(b.campanha, "pt-BR"));

  // ---- resumo ----
  const totalBruto = dias.reduce((s, d) => s + d.gasto, 0);
  const porDestino = (Object.keys(NOME_DESTINO) as Destino[]).map((k) => {
    const x = dias.filter((d) => d.destino === k);
    return { destino: k, nome: NOME_DESTINO[k], gasto: r2(x.reduce((s, d) => s + d.gasto, 0) * (1 + IMPOSTO)), msgs: Math.round(x.reduce((s, d) => s + d.msgs, 0)) };
  });
  const porMes = new Map<string, { gasto: number; msgs: number }>();
  for (const d of dias) { const m = d.data.slice(0, 7); const x = porMes.get(m) ?? { gasto: 0, msgs: 0 }; x.gasto += d.gasto; x.msgs += d.msgs; porMes.set(m, x); }

  // ---- por campanha ----
  const porCamp = new Map<string, { gasto: number; msgs: number; de: string; ate: string; alvos: Map<string, number> }>();
  for (const d of dias) {
    const x = porCamp.get(d.campanhaId) ?? { gasto: 0, msgs: 0, de: d.data, ate: d.data, alvos: new Map() };
    x.gasto += d.gasto; x.msgs += d.msgs;
    if (d.data < x.de) x.de = d.data;
    if (d.data > x.ate) x.ate = d.data;
    x.alvos.set(d.alvo, (x.alvos.get(d.alvo) ?? 0) + d.gasto);
    porCamp.set(d.campanhaId, x);
  }
  const vinculo = (c: CampanhaRel, alvos: Map<string, number>) => {
    if (c.divisao) return { situacao: c.divisao === "anuncio" ? "Dividida por anúncio" : "Dividida em partes", ligadaA: [...alvos.keys()].filter((a) => !a.startsWith("Parte da campanha")).join(" | ") };
    if (c.car_id) { const d = carroDe(c.car_id); return { situacao: NOME_DESTINO[d.destino], ligadaA: d.alvo }; }
    if (c.categoria_objetivo || c.destino_id) return { situacao: "Finalidade", ligadaA: [...alvos.keys()][0] ?? rotuloFinalidade(c.categoria_objetivo) };
    return { situacao: "Sem vínculo", ligadaA: "" };
  };
  const campanhas = [...porCamp.entries()]
    .map(([id, x]) => {
      const c = camp.get(id)!;
      const v = vinculo(c, x.alvos);
      return {
        id, nome: c.nome, status: c.status, objetivo: c.objetivo ?? null, de: x.de, ate: x.ate,
        bruto: r2(x.gasto), imposto: r2(x.gasto * IMPOSTO), gasto: r2(x.gasto * (1 + IMPOSTO)), msgs: Math.round(x.msgs),
        ...v,
      };
    })
    .sort((a, b) => b.gasto - a.gasto);

  // ---- por carro ----
  const porCarro = new Map<string, { destino: Destino; alvo: string; gasto: number; msgs: number; camps: Set<string>; de: string; ate: string }>();
  for (const d of dias) {
    if (!d.carroId) continue;
    const x = porCarro.get(d.carroId) ?? { destino: d.destino, alvo: d.alvo, gasto: 0, msgs: 0, camps: new Set(), de: d.data, ate: d.data };
    x.gasto += d.gasto; x.msgs += d.msgs; x.camps.add(d.campanhaId);
    if (d.data < x.de) x.de = d.data;
    if (d.data > x.ate) x.ate = d.data;
    porCarro.set(d.carroId, x);
  }
  const carros = [...porCarro.entries()]
    .map(([chave, x]) => {
      const pc = patio.get(chave);
      const gasto = r2(x.gasto * (1 + IMPOSTO));
      const lucro = pc && pc.custo != null && (pc.venda ?? pc.preco) ? (pc.venda ?? pc.preco ?? 0) - pc.custo : null;
      return {
        chave, nome: pc?.nome ?? x.alvo, placa: pc?.placa ?? null, status: pc?.status ?? "fora", noPatio: !!pc, preco: pc?.preco ?? null,
        gasto, msgs: Math.round(x.msgs), campanhas: x.camps.size, de: x.de, ate: x.ate,
        custoCarro: pc?.custo ?? null, venda: pc?.venda ?? null, lucro, lucroDepois: lucro != null ? r2(lucro - gasto) : null,
      };
    })
    .sort((a, b) => b.gasto - a.gasto);

  // ---- divisões ----
  const divisoes = [...new Set(p.linhasCarro.map((l) => l.campaign_id))]
    .map((id) => camp.get(id))
    .filter((c): c is CampanhaRel => !!c?.divisao)
    .flatMap((c) => {
      const partes = new Map<string, { alvo: string; gasto: number; msgs: number }>();
      for (const d of dias.filter((x) => x.campanhaId === c.id)) {
        const k = d.carroId ?? "sem";
        const x = partes.get(k) ?? { alvo: d.alvo, gasto: 0, msgs: 0 };
        x.gasto += d.gasto; x.msgs += d.msgs;
        partes.set(k, x);
      }
      const total = [...partes.values()].reduce((s, x) => s + x.gasto, 0);
      const pesos = p.divisoes.filter((d) => d.campaign_id === c.id);
      const somaPesos = pesos.reduce((s, d) => s + d.peso, 0);
      const pesoDe = new Map(pesos.map((d) => [carroDe(d.car_id).chave, somaPesos ? r2((d.peso / somaPesos) * 100) : 0]));
      return [...partes.entries()].map(([k, x]) => ({
        campanha: c.nome, modo: c.divisao === "anuncio" ? "Por anúncio (gasto real)" : "Em partes",
        alvo: x.alvo, pct: total ? r2((x.gasto / total) * 100) : 0,
        pctCombinado: c.divisao === "manual" ? pesoDe.get(k) ?? null : null,
        gasto: r2(x.gasto * (1 + IMPOSTO)), msgs: Math.round(x.msgs),
      }));
    });

  const semVinculo = campanhas.filter((c) => c.situacao === "Sem vínculo" || c.situacao === "Carro fora do Pátio")
    .concat(campanhas.filter((c) => c.situacao.startsWith("Dividida")).flatMap((c) => {
      const resto = dias.filter((d) => d.campanhaId === c.id && d.destino === "sem").reduce((s, d) => s + d.gasto, 0);
      return resto > 0.005 ? [{ ...c, situacao: "Parte sem carro (dividida)", bruto: r2(resto), imposto: r2(resto * IMPOSTO), gasto: r2(resto * (1 + IMPOSTO)), msgs: 0 }] : [];
    }))
    .sort((a, b) => b.gasto - a.gasto);

  return {
    total: { bruto: r2(totalBruto), imposto: r2(totalBruto * IMPOSTO), gasto: r2(totalBruto * (1 + IMPOSTO)), msgs: Math.round(dias.reduce((s, d) => s + d.msgs, 0)) },
    porDestino,
    porMes: [...porMes.entries()].sort().map(([mes, x]) => ({ mes, bruto: r2(x.gasto), gasto: r2(x.gasto * (1 + IMPOSTO)), msgs: Math.round(x.msgs) })),
    campanhas, carros, divisoes, semVinculo,
    dias: dias.map((d) => ({ ...d, gasto: r2(d.gasto * (1 + IMPOSTO)), msgs: Math.round(d.msgs * 100) / 100 })),
  };
}
export type Relatorio = ReturnType<typeof montarRelatorio>;
