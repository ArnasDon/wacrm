import { describe, it, expect } from "vitest";
import { conferir, sobrasDoMes } from "./conferencia";

const linha = (externo: string | null, data: string, gasto: number, extra: Partial<{ impressions: number; clicks: number; msgs: number }> = {}) => ({
  externo, campanhaId: `i-${externo}`, nome: `C ${externo}`, data, gasto, impressions: extra.impressions ?? 10, clicks: extra.clicks ?? 1, msgs: extra.msgs ?? 0,
});
const camp = (id: string, gasto: number, extra: Partial<{ impressions: number; clicks: number; msgs: number }> = {}) => ({
  id, nome: `C ${id}`, status: "ACTIVE", gasto, impressions: extra.impressions ?? 10, clicks: extra.clicks ?? 1, msgs: extra.msgs ?? 0,
});

describe("conferir", () => {
  it("bate quando painel e Facebook são iguais", () => {
    const r = conferir([{ data: "2026-11-01", gasto: 50 }], [camp("1", 50)], [linha("1", "2026-11-01", 50)]);
    expect(r.bate).toBe(true);
    expect(r.totalMeta).toBe(50);
    expect(r.totalBanco).toBe(50);
  });

  it("aponta dia faltando, campanha excluída faltando e o mês a corrigir", () => {
    const r = conferir(
      [{ data: "2026-10-05", gasto: 30 }, { data: "2026-11-01", gasto: 50 }],
      [camp("1", 50), camp("2", 30)],
      [linha("1", "2026-11-01", 50)],
    );
    expect(r.bate).toBe(false);
    expect(r.dias).toEqual([{ data: "2026-10-05", meta: 30, banco: 0 }]);
    expect(r.campanhas[0]).toMatchObject({ id: "2", motivo: "falta no painel" });
    expect(r.meses).toEqual(["2026-10"]);
  });

  it("aponta campanha que só existe no painel e conversas diferentes", () => {
    const r = conferir(
      [{ data: "2026-11-01", gasto: 50 }],
      [camp("1", 50, { msgs: 3 })],
      [linha("1", "2026-11-01", 50, { msgs: 2 }), linha(null, "2026-11-01", 20)],
    );
    expect(r.campanhas.map((c) => c.motivo).sort()).toEqual(["só no painel", "valor diferente"]);
    expect(r.dias).toEqual([{ data: "2026-11-01", meta: 50, banco: 70 }]);
  });

  it("ignora diferença de centavos", () => {
    const r = conferir([{ data: "2026-11-01", gasto: 50.01 }], [camp("1", 50.01)], [linha("1", "2026-11-01", 50)]);
    expect(r.bate).toBe(true);
  });
});

describe("sobrasDoMes", () => {
  it("apaga só o que tem id do Facebook e não veio do Facebook", () => {
    const banco = [
      { id: "a", externo: "1", data: "2026-10-01" },
      { id: "b", externo: "1", data: "2026-10-02" },
      { id: "c", externo: null, data: "2026-10-02" },
    ];
    expect(sobrasDoMes(banco, new Set(["1|2026-10-01"]))).toEqual(["b"]);
  });
});
