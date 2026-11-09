import { describe, it, expect } from "vitest";
import { montarAuditoria, type VeiculoMkt, type CampanhaAud } from "./auditoria";
import type { Carro } from "./veiculo";

const carro = (o: Partial<Carro>): Carro => ({ id: "x", status: "available", ...o }) as Carro;
const v = (o: Partial<VeiculoMkt>): VeiculoMkt => ({ id: "v", placa: null, modelo: null, ano: null, status: "estoque", origem: "manual", site_vehicle_id: null, ...o });
const camp = (o: Partial<CampanhaAud>): CampanhaAud => ({ id: "c", nome: "C", status: "ACTIVE", car_id: null, categoria_objetivo: null, destino_id: null, gasto: 0, msgs: 0, ...o });

describe("auditoria de vínculos", () => {
  const patio = [
    carro({ id: "p1", brand: "Toyota", model: "Hilux", year: "2021", plate: "RCO1A97", finance: { sale_price: 200000, purchase_price: 160000 } }),
    carro({ id: "p2", brand: "BYD", model: "Song Plus", year: "2025", plate: "ABC1D23", finance: { sale_price: 230000 } }),
  ];
  const veiculos = [
    v({ id: "v1", placa: "RCO1A97", modelo: "Hilux SRV", ano: 2021 }), // órfão com campanha, mesma placa de p1
    v({ id: "v2", placa: "ABC1D23", modelo: "Song", site_vehicle_id: "p2", origem: "site" }),
  ];
  const campanhas = [
    camp({ id: "c1", nome: "Hilux 2021", car_id: "v1", gasto: 100, msgs: 10 }),
    camp({ id: "c2", nome: "Song", car_id: "v2", gasto: 50, msgs: 5 }),
    camp({ id: "c3", nome: "Perfil", categoria_objetivo: "perfil_engajamento", gasto: 30 }),
    camp({ id: "c4", nome: "Solta", gasto: 20, msgs: 1 }),
  ];
  const a = montarAuditoria(patio, veiculos, campanhas, true);
  it("liga, soma com imposto e sugere pela placa", () => {
    const p2 = a.linhas.find((l) => l.id === "p2")!;
    expect(p2.veiculoId).toBe("v2");
    expect(p2.investido).toBeCloseTo(56);
    const p1 = a.linhas.find((l) => l.id === "p1")!;
    expect(p1.veiculoId).toBeNull();
    expect(p1.sugestao).toMatchObject({ veiculoId: "v1", motivo: "placa igual" });
    expect(p1.lucro).toBe(40000);
    expect(a.orfaos[0]).toMatchObject({ id: "v1", sugestao: { carroId: "p1" } });
  });
  it("separa campanhas sem vínculo das com finalidade", () => {
    expect(a.semVinculo.map((c) => c.id)).toEqual(["c4"]);
    expect(a.totais.investidoFinalidade).toBeCloseTo(33.6);
  });
  it("sem sócio, não mostra custo nem lucro", () => {
    const b = montarAuditoria(patio, veiculos, campanhas, false);
    expect(b.linhas.every((l) => l.custo === null && l.lucro === null)).toBe(true);
  });
});
