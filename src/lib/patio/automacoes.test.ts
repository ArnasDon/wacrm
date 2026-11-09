import { describe, it, expect } from "vitest";
import { agoraBahia, decidir, bateCondicao, textoDaAutomacao, textoDemandas, ontem, type Automacao } from "./automacoes";

const a = (o: Partial<Automacao>): Automacao => ({ id: "1", org_id: "o", tipo: "mensagem", nome: "Bom dia", group_jid: "1@g.us", conteudo: "Oi", horario: 8, dias: [1, 2, 3, 4, 5], cond_operador: null, cond_valor: null, enabled: true, last_run_date: null, run_requested: false, ...o });

describe("automações", () => {
  const seg8 = { data: "2026-11-09", hora: 8, dia: 1 };
  it("hora da Bahia", () => {
    expect(agoraBahia(new Date("2026-11-09T11:30:00Z"))).toEqual(seg8);
    expect(agoraBahia(new Date("2026-11-10T01:00:00Z"))).toEqual({ data: "2026-11-09", hora: 22, dia: 1 });
    expect(ontem("2026-11-01")).toBe("2026-10-31");
  });
  it("na hora e no dia, uma vez por dia", () => {
    expect(decidir(a({}), seg8)).toEqual({ disparar: true, motivo: "horario" });
    expect(decidir(a({ last_run_date: "2026-11-09" }), seg8)).toEqual({ disparar: false });
    expect(decidir(a({ horario: 9 }), seg8)).toEqual({ disparar: false });
    expect(decidir(a({ dias: [0, 6] }), seg8)).toEqual({ disparar: false });
    expect(decidir(a({ enabled: false }), seg8)).toEqual({ disparar: false });
  });
  it("manual dispara mesmo desligada; sistema nunca", () => {
    expect(decidir(a({ enabled: false, run_requested: true, last_run_date: "2026-11-09" }), seg8)).toEqual({ disparar: true, motivo: "manual" });
    expect(decidir(a({ tipo: "sistema", nome: "Outra", run_requested: true }), seg8)).toEqual({ disparar: false });
  });
  it("demandas do time: de manhã, 1x por dia; domingo mensagem curta", () => {
    const dem = a({ tipo: "sistema", nome: "Demandas do time", horario: null, dias: null });
    expect(decidir(dem, seg8)).toEqual({ disparar: true, motivo: "horario" });
    expect(decidir({ ...dem, last_run_date: "2026-11-09" }, seg8)).toEqual({ disparar: false });
    expect(decidir(a({ tipo: "sistema", nome: "Tráfego" }), seg8)).toEqual({ disparar: false });
    expect(textoDemandas({ data: "2026-11-10", dia: 2 })).toContain("modelo específico do estoque");
    expect(textoDemandas({ data: "2026-11-08", dia: 0 })).toContain("Domingo");
  });
  it("alerta de gasto", () => {
    expect(decidir(a({ tipo: "alerta", horario: null, cond_operador: ">", cond_valor: 500 }), seg8)).toEqual({ disparar: true, motivo: "precisa_gasto" });
    expect(bateCondicao(501, ">", 500)).toBe(true);
    expect(bateCondicao(500, ">", 500)).toBe(false);
    expect(bateCondicao(500, ">=", 500)).toBe(true);
  });
  it("texto", () => {
    expect(textoDaAutomacao(a({ tipo: "relatorio", conteudo: "Resumo" }), { gastoOntem: 1234.5 })).toBe("Resumo\n\n💰 Gasto de ontem no Meta Ads: R$ 1.234,50");
    expect(textoDaAutomacao(a({ tipo: "alerta", conteudo: "Passou: {{valor}}" }), { gastoHoje: 600 })).toBe("Passou: R$ 600,00");
    expect(textoDaAutomacao(a({}), { manual: true })).toContain("disparo manual");
  });
});
