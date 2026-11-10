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

describe("vários carros do mesmo modelo", () => {
  it("mostra as opções em vez de sugerir finalidade", () => {
    const p2: CarroDoPatio[] = [
      { id: "b1", nome: "BMW 320I Sport Gp 2022", placa: "RDM-1C32", ano: 2022, status: "available", img: null, modelo: "320I Sport Gp" },
      { id: "b2", nome: "BMW 320I M-Sport 2023", placa: "RPX-7F77", ano: 2023, status: "available", img: null, modelo: "320I M-Sport" },
    ];
    const [l] = montarLigacoes([{ id: "c1", nome: "[30/10] [ENG] BMW 320i rebaixada", objetivo: "OUTCOME_ENGAGEMENT", status: "ACTIVE", car_id: null, categoria_objetivo: null, destino_id: null }], [], p2, [{ campaign_id: "c1", data: "2026-10-30", gasto: 10, msgs: 1 }]);
    expect(l.sugestao).toBeNull();
    expect(l.opcoes.map((o) => o.patioId).sort()).toEqual(["b1", "b2"]);
  });
});

describe("candidatos pelo modelo", () => {
  it("não confunde T-Cross com Corolla Cross", async () => {
    const { candidatosDoNome } = await import("./ligacoes");
    const p3: CarroDoPatio[] = [
      { id: "t", nome: "Volkswagen T-Cross Comfortline 2023", placa: "FIS-6B93", ano: 2023, status: "available", img: null, modelo: "T-Cross Comfortline" },
      { id: "c", nome: "Toyota Corolla Cross XRX 2025", placa: "SKB-1E92", ano: 2025, status: "available", img: null, modelo: "Corolla Cross XRX" },
    ];
    expect(candidatosDoNome("[28/05] [WP] [apolo] corolla cross [9c12]", p3).map((x) => x.id)).toEqual(["c"]);
    expect(candidatosDoNome("[23/09] enga | Quiz | Tcross", p3).map((x) => x.id)).toEqual(["t"]);
    expect(candidatosDoNome("[24/03] VD | T-Cross", p3).map((x) => x.id)).toEqual(["t"]);
  });
});

describe("ano no fim do nome", () => {
  it("'SW4 SRX 22' prefere o carro de 2022", async () => {
    const { sugerirCarroParaCampanha } = await import("./estoqueSite");
    const cars = [
      { id: "a", placa: "RPP4D14", modelo: "TOYOTA SW4 SRX 2023", ano: 2023, status: "estoque", nomeSite: "TOYOTA SW4 SRX 2023", modeloSite: "SW4 SRX" },
      { id: "b", placa: "RCP4A87", modelo: "Toyota SW4 SRX 7 Lugares 2022/22", ano: 2022, status: "vendido", nomeSite: "Toyota SW4 SRX 7 Lugares 2022/22", modeloSite: "SW4 SRX 7 Lugares" },
    ];
    expect(sugerirCarroParaCampanha("TOYOTA SW4 SRX 22 carrossel - TOYOTA SW4 SRX 22", cars)?.id).toBe("b");
  });
});
