import { describe, it, expect } from "vitest";
import { distribuirGasto, partesPorCarro } from "./gasto-carro";

const met = (campaign_id: string, gasto: number, msgs = 0, data = "2026-11-01") => ({ campaign_id, data, gasto, msgs });

describe("distribuirGasto", () => {
  it("sem divisão: tudo no carro da campanha", () => {
    const l = distribuirGasto([{ id: "c1", car_id: "A", divisao: null }], [met("c1", 100, 4)]);
    expect(l).toEqual([{ car_id: "A", campaign_id: "c1", data: "2026-11-01", gasto: 100, msgs: 4 }]);
  });
  it("manual: reparte por peso", () => {
    const l = partesPorCarro(distribuirGasto([{ id: "c1", car_id: null, divisao: "manual" }], [met("c1", 100, 10)], [{ campaign_id: "c1", car_id: "A", peso: 60 }, { campaign_id: "c1", car_id: "B", peso: 40 }]));
    expect(l.find((x) => x.car_id === "A")).toMatchObject({ gasto: 60, msgs: 6 });
    expect(l.find((x) => x.car_id === "B")).toMatchObject({ gasto: 40, msgs: 4 });
  });
  it("manual sem carros escolhidos: não cai em carro nenhum", () => {
    expect(distribuirGasto([{ id: "c1", car_id: "A", divisao: "manual" }], [met("c1", 100)])).toEqual([]);
  });
  it("por anúncio: gasto real de cada anúncio, ignora a métrica da campanha e anúncio sem carro", () => {
    const l = partesPorCarro(distribuirGasto(
      [{ id: "c1", car_id: "A", divisao: "anuncio" }],
      [met("c1", 167)],
      [],
      [{ id: "a1", campaign_id: "c1", car_id: "M" }, { id: "a2", campaign_id: "c1", car_id: "S" }, { id: "a3", campaign_id: "c1", car_id: null }],
      [{ ad_id: "a1", data: "2026-11-01", gasto: 72.61, msgs: 3 }, { ad_id: "a2", data: "2026-11-01", gasto: 73.5, msgs: 2 }, { ad_id: "a3", data: "2026-11-01", gasto: 21.19, msgs: 1 }],
    ));
    expect(l).toHaveLength(2);
    expect(l.find((x) => x.car_id === "M")?.gasto).toBe(72.61);
    expect(l.find((x) => x.car_id === "S")?.gasto).toBe(73.5);
  });
});
