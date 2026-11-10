import { describe, it, expect } from "vitest";
import { montarLigacoes, buscarCarros, type CarroDoPatio } from "./ligacoes";

const patio: CarroDoPatio[] = [
  { id: "p1", nome: "Jeep Commander Overland 2022", placa: "RPI-0F66", ano: 2022, status: "available", img: null, modelo: "Commander" },
  { id: "p2", nome: "Toyota Hilux SRX Limited 2023", placa: "RPS-5J27", ano: 2023, status: "available", img: null, modelo: "Hilux" },
];
const veiculos = [
  { id: "v1", modelo: "Commander", placa: "RPI0F66", site_vehicle_id: "p1" },
  { id: "v9", modelo: "rampage branca", placa: "SJO0122", site_vehicle_id: null },
];
const camp = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({ id, nome, objetivo: null, status: "PAUSED", car_id: null, categoria_objetivo: null, destino_id: null, ...extra });

describe("montarLigacoes", () => {
  const metricas = [
    { campaign_id: "c1", data: "2026-10-30", gasto: 100, msgs: 4 },
    { campaign_id: "c1", data: "2026-11-01", gasto: 50, msgs: 1 },
    { campaign_id: "c2", data: "2026-10-01", gasto: 10, msgs: 0 },
    { campaign_id: "c3", data: "2026-10-01", gasto: 20, msgs: 0 },
    { campaign_id: "c4", data: "2026-10-01", gasto: 30, msgs: 0 },
  ];
  const linhas = montarLigacoes([
    camp("c1", "[30/10] [ENG] Commander", { status: "ACTIVE" }),
    camp("c2", "25/10 | Engajamento Insta", { objetivo: "OUTCOME_ENGAGEMENT" }),
    camp("c3", "Rampage", { car_id: "v9" }),
    camp("c4", "Hilux", { car_id: "v1" }),
    camp("c5", "sem gasto"),
  ], veiculos, patio, metricas);

  it("soma com imposto, ordena ativas primeiro e esconde campanha vazia sem ligação", () => {
    expect(linhas.map((l) => l.id)).toEqual(["c1", "c4", "c3", "c2"]);
    expect(linhas[0]).toMatchObject({ investido: 168, msgs: 5, primeiroDia: "2026-10-30", ultimoDia: "2026-11-01" });
  });
  it("sugere carro pelo nome e finalidade pelo objetivo", () => {
    expect(linhas.find((l) => l.id === "c1")?.sugestao).toMatchObject({ tipo: "carro", patioId: "p1" });
    expect(linhas.find((l) => l.id === "c2")?.sugestao).toMatchObject({ tipo: "finalidade", chave: "perfil_engajamento" });
  });
  it("marca campanha ligada a carro fora do Pátio e a carro do Pátio", () => {
    expect(linhas.find((l) => l.id === "c3")).toMatchObject({ situacao: "fora", foraId: "v9" });
    expect(linhas.find((l) => l.id === "c4")).toMatchObject({ situacao: "carro", patioId: "p1" });
  });
});

describe("buscarCarros", () => {
  it("acha por pedaço do nome, ano ou placa", () => {
    expect(buscarCarros(patio, "hilux 2023").map((c) => c.id)).toEqual(["p2"]);
    expect(buscarCarros(patio, "0f66").map((c) => c.id)).toEqual(["p1"]);
    expect(buscarCarros(patio, "")).toEqual([]);
  });
});
