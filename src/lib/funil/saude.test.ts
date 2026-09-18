import { describe, expect, it } from "vitest";

import { classificarEtapas } from "./degraus";
import {
  COORTE_PEQUENA,
  coortePequena,
  coortesMensais,
  escalaRelativa,
  linhasDoMapa,
  transicoesDoHistorico,
} from "./saude";
import { fatosDoNegocio, type LinhaDeTrajetoria } from "./trajetoria";

const FUNIL = "f";
// 3 de setembro de 2026, 18h local
const AGORA = new Date(2026, 8, 3, 18);

const CLASSIFICACAO = classificarEtapas([
  { id: "lead", name: "Lead", position: 0, degrau: "lead" },
  { id: "mql", name: "MQL", position: 1, degrau: "mql" },
  { id: "contrato", name: "Contrato", position: 2, degrau: "contrato" },
]);

function negocio(id: string, entradas: [string, Date][]): LinhaDeTrajetoria {
  const criadoEm = entradas[0][1];
  return {
    deal_id: id,
    contact_id: null,
    conversation_id: null,
    conversa_do_contato: null,
    title: id,
    value: 0,
    status: "open",
    pipeline_id: FUNIL,
    stage_id: entradas[entradas.length - 1][0],
    channel_id: null,
    source: "channel",
    assigned_to: null,
    created_at: criadoEm.toISOString(),
    updated_at: null,
    contato_nome: null,
    contato_telefone: null,
    contato_email: null,
    contato_empresa: null,
    contato_avatar: null,
    campos: {},
    trajeto: entradas.map(([etapa, em], i) => ({
      etapa,
      funil: FUNIL,
      em: em.toISOString(),
      origem: "usuario",
      tipo: i === 0 ? "deal_created" : "stage_changed",
    })),
  };
}

const d = (mes0: number, dia: number, hora = 10) => new Date(2026, mes0, dia, hora);

const LINHAS: LinhaDeTrajetoria[] = [
  // julho: 1 lead, virou MQL — coorte PEQUENA
  negocio("jul-1", [["lead", d(6, 10)], ["mql", d(6, 12)]]),
  // agosto: 5 leads, 2 viraram MQL, 1 deles fechou
  negocio("ago-1", [["lead", d(7, 1)], ["mql", d(7, 2)], ["contrato", d(7, 20)]]),
  negocio("ago-2", [["lead", d(7, 3)], ["mql", d(7, 4)]]),
  negocio("ago-3", [["lead", d(7, 5)]]),
  negocio("ago-4", [["lead", d(7, 6)]]),
  negocio("ago-5", [["lead", d(7, 7)]]),
  // setembro: 2 leads parados
  negocio("set-1", [["lead", d(8, 1)]]),
  negocio("set-2", [["lead", d(8, 2)]]),
];
const FATOS = LINHAS.map((l) => fatosDoNegocio(l, FUNIL, CLASSIFICACAO));

describe("coortesMensais", () => {
  const meses = coortesMensais(FATOS, CLASSIFICACAO, 3, AGORA, "entrada");

  it("uma coorte por mês, do mais antigo ao atual", () => {
    expect(meses.map((m) => m.chave)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(meses.map((m) => m.resumo.entradas)).toEqual([1, 5, 2]);
  });

  it("taxas por mês e a marca de coorte pequena", () => {
    const leadParaMql = meses.map((m) => m.resumo.transicoes[0].taxa);
    expect(leadParaMql).toEqual([1, 0.4, 0]);
    expect(meses.map((m) => m.pequena)).toEqual([true, false, true]);
    expect(meses[1].resumo.fechados).toBe(1);
  });

  it("em aberto = sem avanço + em andamento (a coorte ainda anda)", () => {
    expect(meses.map((m) => m.emAberto)).toEqual([1, 4, 2]);
  });

  it("mês sem coorte fica com zero, não some", () => {
    const seis = coortesMensais(FATOS, CLASSIFICACAO, 6, AGORA, "entrada");
    expect(seis.map((m) => m.resumo.entradas)).toEqual([0, 0, 0, 1, 5, 2]);
    expect(seis[0].resumo.transicoes[0].taxa).toBeNull();
  });
});

describe("coortesMensais por PERÍODO (o padrão desde 18/09/2026)", () => {
  // O lead de JULHO que fecha contrato em SETEMBRO: por período o contrato é
  // de setembro; por mês de entrada, é da coorte de julho.
  const LINHAS_TARDIAS: LinhaDeTrajetoria[] = [
    ...LINHAS,
    negocio("jul-2", [["lead", d(6, 15)], ["mql", d(7, 10)], ["contrato", d(8, 2)]]),
  ];
  const fatos = LINHAS_TARDIAS.map((l) => fatosDoNegocio(l, FUNIL, CLASSIFICACAO));
  const porPeriodo = coortesMensais(fatos, CLASSIFICACAO, 3, AGORA, "periodo");
  const porEntrada = coortesMensais(fatos, CLASSIFICACAO, 3, AGORA, "entrada");
  const contratos = (meses: typeof porPeriodo) => meses.map((m) => m.resumo.fechados);
  const mqls = (meses: typeof porPeriodo) => meses.map((m) => m.resumo.porDegrau[1].alcancaram);

  it("cada avanço conta no mês em que ACONTECEU; as entradas não mudam de mês", () => {
    expect(porPeriodo.map((m) => m.resumo.entradas)).toEqual([2, 5, 2]);
    expect(mqls(porPeriodo)).toEqual([1, 3, 0]); // o MQL de jul-2 foi em agosto
    expect(contratos(porPeriodo)).toEqual([0, 1, 1]); // e o contrato dele, em setembro
  });

  it("o mesmo dado por mês de entrada devolve o contrato à coorte de julho", () => {
    expect(mqls(porEntrada)).toEqual([2, 2, 0]);
    expect(contratos(porEntrada)).toEqual([1, 1, 0]);
  });

  it("'em aberto' é marca da COORTE: por período o mês passado já é final", () => {
    expect(porPeriodo.map((m) => m.emAberto)).toEqual([0, 0, 0]);
    expect(porEntrada.map((m) => m.emAberto)).toEqual([1, 4, 2]);
  });

  it("as taxas do mês são razão de FLUXO: o que aconteceu nele sobre o que aconteceu nele", () => {
    // setembro: 1 contrato (de julho) sobre 0 MQLs novos → sem denominador;
    // lead → contrato: 1 contrato sobre 2 entradas = 0,5.
    const setembro = porPeriodo[2].resumo;
    expect(setembro.transicoes[1].taxa).toBeNull();
    expect(setembro.global?.taxa).toBe(0.5);
    // agosto: 3 MQLs sobre 5 entradas, 1 contrato sobre 3 MQLs
    expect(porPeriodo[1].resumo.transicoes.map((t) => t.taxa)).toEqual([0.6, 1 / 3]);
  });
});

describe("linhas do mapa de saúde", () => {
  it("transições dos degraus mapeados + a global (só com lead E contrato)", () => {
    expect(transicoesDoHistorico(CLASSIFICACAO)).toEqual([
      { de: "lead", para: "mql", global: false },
      { de: "mql", para: "contrato", global: false },
      { de: "lead", para: "contrato", global: true },
    ]);
    const semContrato = classificarEtapas([{ id: "lead", name: "Lead", position: 0, degrau: "lead" }]);
    expect(transicoesDoHistorico(semContrato)).toEqual([]);
  });

  it("uma taxa por mês e a escala calculada SEM as coortes pequenas", () => {
    const meses = coortesMensais(FATOS, CLASSIFICACAO, 3, AGORA, "entrada");
    const linhas = linhasDoMapa(meses, CLASSIFICACAO);
    const leadMql = linhas[0];
    // julho (1 lead, 100%) e setembro (2 leads, 0%) são pequenas: só agosto (0,4) entra no min/max
    expect(leadMql.taxas).toEqual([1, 0.4, 0]);
    expect(leadMql.escala(0.4)).toBe(0.5);
    expect(leadMql.escala(1)).toBe(0.5);
    expect(leadMql.escala(null)).toBeNull();
    const global = linhas[2];
    expect(global.transicao.global).toBe(true);
    expect(global.taxas).toEqual([0, 0.2, 0]);
  });
});

describe("escalaRelativa (cor relativa à linha, D6)", () => {
  it("pior mês → 0, melhor → 1, o resto proporcional; nulo fica nulo", () => {
    const escala = escalaRelativa([0.2, null, 0.6, 0.4]);
    expect(escala(0.2)).toBe(0);
    expect(escala(0.6)).toBe(1);
    expect(escala(0.4)).toBeCloseTo(0.5);
    expect(escala(null)).toBeNull();
  });

  it("linha sem variação: tudo 0.5 (não há melhor nem pior)", () => {
    const escala = escalaRelativa([0.3, 0.3]);
    expect(escala(0.3)).toBe(0.5);
  });

  it("linha toda nula: nada a pintar", () => {
    expect(escalaRelativa([null, null])(null)).toBeNull();
  });

  it("coorte pequena é menor que o piso", () => {
    expect(coortePequena(COORTE_PEQUENA - 1)).toBe(true);
    expect(coortePequena(COORTE_PEQUENA)).toBe(false);
  });
});
