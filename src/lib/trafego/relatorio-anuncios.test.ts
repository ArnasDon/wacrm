import { describe, it, expect } from "vitest";
import { montarRelatorio } from "./relatorio-anuncios";
import { distribuirGasto } from "./gasto-carro";

describe("montarRelatorio", () => {
  const campanhas = [
    { id: "c1", nome: "Hilux", status: "ACTIVE", car_id: "v1", divisao: null, categoria_objetivo: null, destino_id: null },
    { id: "c2", nome: "Insta", status: "PAUSED", car_id: null, divisao: null, categoria_objetivo: "perfil_engajamento", destino_id: null },
    { id: "c3", nome: "Solta", status: "PAUSED", car_id: null, divisao: null, categoria_objetivo: null, destino_id: null },
    { id: "c4", nome: "Creta + TCross", status: "PAUSED", car_id: null, divisao: "manual", categoria_objetivo: null, destino_id: null },
    { id: "c5", nome: "Antiga", status: "PAUSED", car_id: "v9", divisao: null, categoria_objetivo: null, destino_id: null },
  ];
  const metricas = [
    { campaign_id: "c1", data: "2026-10-01", gasto: 100, msgs: 10 },
    { campaign_id: "c2", data: "2026-10-01", gasto: 50, msgs: 0 },
    { campaign_id: "c3", data: "2026-10-02", gasto: 30, msgs: 1 },
    { campaign_id: "c4", data: "2026-11-01", gasto: 80, msgs: 4 },
    { campaign_id: "c5", data: "2026-09-01", gasto: 40, msgs: 2 },
  ];
  const divisoes = [{ campaign_id: "c4", car_id: "v1", peso: 50 }, { campaign_id: "c4", car_id: "v2", peso: 50 }];
  const linhasCarro = distribuirGasto(campanhas, metricas, divisoes);
  const r = montarRelatorio({
    campanhas, metricas, linhasCarro, divisoes,
    patio: [{ id: "p1", nome: "Hilux SRX", placa: "AAA1A11", status: "available", preco: 200000, custo: 180000 }, { id: "p2", nome: "T-Cross", placa: null, status: "sold", preco: 100000 }],
    veiculos: [{ id: "v1", modelo: "Hilux", placa: "AAA1A11", site_vehicle_id: "p1" }, { id: "v2", modelo: "T-Cross", placa: null, site_vehicle_id: "p2" }, { id: "v9", modelo: "rampage", placa: "SJO0122", site_vehicle_id: null }],
  });

  it("cada real em um destino: grupos somam o total", () => {
    expect(r.total.bruto).toBe(300);
    const soma = r.porDestino.reduce((s, d) => s + d.gasto, 0);
    expect(Math.round(soma * 100) / 100).toBe(r.total.gasto);
    expect(r.porDestino.find((d) => d.destino === "patio")?.gasto).toBe(Math.round(180 * 1.12 * 100) / 100);
    expect(r.porDestino.find((d) => d.destino === "fora")?.gasto).toBe(44.8);
  });
  it("por carro soma campanha inteira + parte da dividida, com lucro depois do anúncio", () => {
    const hilux = r.carros.find((c) => c.chave === "p1")!;
    expect(hilux.gasto).toBe(Math.round(140 * 1.12 * 100) / 100);
    expect(hilux.campanhas).toBe(2);
    expect(hilux.lucroDepois).toBe(Math.round((20000 - 140 * 1.12) * 100) / 100);
  });
  it("lista divisão com porcentagem e campanhas sem vínculo", () => {
    expect(r.divisoes.map((d) => d.pct).sort()).toEqual([50, 50]);
    expect(r.divisoes.every((d) => d.pctCombinado === 50)).toBe(true);
    expect(r.semVinculo.map((c) => c.nome).sort()).toEqual(["Antiga", "Solta"]);
    expect(r.porMes.map((m) => m.mes)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
});
