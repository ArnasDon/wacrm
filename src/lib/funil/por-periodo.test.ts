import { describe, expect, it } from "vitest";

import { resumoDoPeriodo } from "./coorte";
import { classificarEtapas, type EtapaMinima } from "./degraus";
import type { Intervalo } from "./periodo";
import {
  lerModo,
  MODO_PADRAO,
  periodoSemAtividade,
  resumoNoModo,
  resumoPorPeriodo,
} from "./por-periodo";
import { fatosDoNegocio, type LinhaDeTrajetoria, type PassoDoTrajeto } from "./trajetoria";

/**
 * As regras que o operador pediu POR ESCRITO em 18/09/2026, nos dois modos:
 *
 *  1. o mesmo lead que bate duas vezes em "Reunião Agendada" conta UMA vez;
 *  2. quem saiu de Reunião para Contrato continua contado em Reunião — e em
 *     Proposta, mesmo sem ter passado por ela;
 *  3. por PERÍODO (o padrão), os 5 contratos fechados este mês aparecem este
 *     mês, ainda que as reuniões tenham sido no mês passado.
 *
 * O funil é o Bancário - Comercial, com o mapeamento sugerido.
 */
const FUNIL = "bancario-comercial";
const etapa = (id: string, position: number, degrau: string | null): EtapaMinima => ({
  id,
  name: id,
  position,
  degrau,
});
const C = classificarEtapas([
  etapa("contato-avulso", 0, "lead"),
  etapa("desqualificado", 1, "perda"),
  etapa("mql1", 3, "mql"),
  etapa("reuniao-agendada", 4, "reuniao"),
  etapa("no-show", 6, "perda"),
  etapa("proposta", 8, "proposta"),
  etapa("contrato-fechado", 9, "contrato"),
  etapa("estacionamento", 11, null),
]);

const p = (etapaId: string, em: string, tipo = "stage_changed"): PassoDoTrajeto => ({
  etapa: etapaId,
  funil: FUNIL,
  em,
  origem: "usuario",
  tipo,
});

function negocio(id: string, trajeto: PassoDoTrajeto[], valor = 1000): LinhaDeTrajetoria {
  return {
    deal_id: id,
    contact_id: null,
    conversation_id: null,
    conversa_do_contato: null,
    title: id,
    value: valor,
    status: "open",
    pipeline_id: FUNIL,
    stage_id: trajeto[trajeto.length - 1].etapa ?? "",
    channel_id: null,
    source: "channel",
    assigned_to: null,
    created_at: trajeto[0].em,
    updated_at: null,
    contato_nome: null,
    contato_telefone: null,
    contato_email: null,
    contato_empresa: null,
    contato_avatar: null,
    campos: {},
    trajeto,
  };
}

const fatosDe = (linhas: LinhaDeTrajetoria[]) => linhas.map((l) => fatosDoNegocio(l, FUNIL, C));
const AGOSTO: Intervalo = { desde: new Date("2026-08-01T00:00:00-03:00"), ate: new Date("2026-09-01T00:00:00-03:00") };
const SETEMBRO: Intervalo = { desde: new Date("2026-09-01T00:00:00-03:00"), ate: new Date("2026-10-01T00:00:00-03:00") };
const OUTUBRO: Intervalo = { desde: new Date("2026-10-01T00:00:00-03:00"), ate: new Date("2026-11-01T00:00:00-03:00") };
const AGORA = new Date("2026-10-20T12:00:00-03:00");

type Resumo = ReturnType<typeof resumoPorPeriodo>;
const contagem = (r: Resumo) => Object.fromEntries(r.porDegrau.map((d) => [d.degrau, d.alcancaram]));

describe("o pedido do operador: o que fechou ESTE mês aparece ESTE mês", () => {
  // 10 reuniões marcadas em agosto; 5 delas fecham contrato em setembro.
  const linhas = Array.from({ length: 10 }, (_, i) => {
    const dia = String(i + 1).padStart(2, "0");
    const trajeto = [
      p("contato-avulso", `2026-08-${dia}T10:00:00-03:00`, "deal_created"),
      p("reuniao-agendada", `2026-08-${dia}T15:00:00-03:00`),
    ];
    if (i < 5) trajeto.push(p("contrato-fechado", `2026-09-${dia}T11:00:00-03:00`));
    return negocio(`n${i}`, trajeto, 2000);
  });
  const fatos = fatosDe(linhas);

  it("por período: agosto tem as 10 reuniões, setembro tem os 5 contratos", () => {
    const ago = resumoPorPeriodo(fatos, C, AGOSTO, AGORA);
    const set = resumoPorPeriodo(fatos, C, SETEMBRO, AGORA);
    expect(contagem(ago)).toEqual({ lead: 10, mql: 10, reuniao: 10, proposta: 0, contrato: 0 });
    expect(contagem(set)).toEqual({ lead: 0, mql: 0, reuniao: 0, proposta: 5, contrato: 5 });
    expect(set.fechados).toBe(5);
    expect(set.fechadosAgora).toBe(5);
    expect(set.valorFechado).toBe(10000);
    expect(set.ticketMedio).toBe(2000);
    expect(ago.valorFechado).toBe(0);
  });

  it("por mês de entrada (a forma anterior): tudo fica na coorte de agosto", () => {
    const ago = resumoDoPeriodo(fatos, C, AGOSTO, AGORA);
    const set = resumoDoPeriodo(fatos, C, SETEMBRO, AGORA);
    expect(contagem(ago)).toEqual({ lead: 10, mql: 10, reuniao: 10, proposta: 5, contrato: 5 });
    expect(contagem(set)).toEqual({ lead: 0, mql: 0, reuniao: 0, proposta: 0, contrato: 0 });
  });

  it("nenhum lead entrou em setembro, mas o período NÃO está vazio", () => {
    const set = resumoPorPeriodo(fatos, C, SETEMBRO, AGORA);
    expect(set.entradas).toBe(0);
    expect(periodoSemAtividade(set)).toBe(false);
    expect(periodoSemAtividade(resumoPorPeriodo(fatos, C, OUTUBRO, AGORA))).toBe(true);
  });

  it("⚠️ a taxa é razão de FLUXO e pode passar de 100% — não é cortada", () => {
    // setembro: mais 2 reuniões novas, e os 5 contratos das reuniões de agosto
    const novas = [0, 1].map((i) =>
      negocio(`s${i}`, [
        p("contato-avulso", `2026-09-0${i + 1}T09:00:00-03:00`, "deal_created"),
        p("reuniao-agendada", `2026-09-0${i + 1}T16:00:00-03:00`),
      ]),
    );
    const set = resumoPorPeriodo(fatosDe([...linhas, ...novas]), C, SETEMBRO, AGORA);
    expect(contagem(set)).toEqual({ lead: 2, mql: 2, reuniao: 2, proposta: 5, contrato: 5 });
    const reuniaoParaProposta = set.transicoes.find((t) => t.de === "reuniao" && t.para === "proposta");
    expect(reuniaoParaProposta?.taxa).toBe(2.5);
    expect(set.global?.taxa).toBe(2.5);
  });
});

describe("1) bater duas vezes em Reunião Agendada conta UMA vez", () => {
  // avulso → MQL1 → reunião (ago) → desqualificado → reunião DE NOVO (set)
  const vaiEVolta = [
    p("contato-avulso", "2026-08-02T10:00:00-03:00", "deal_created"),
    p("mql1", "2026-08-03T10:00:00-03:00"),
    p("reuniao-agendada", "2026-08-04T10:00:00-03:00"),
    p("desqualificado", "2026-08-20T10:00:00-03:00"),
    p("reuniao-agendada", "2026-09-10T10:00:00-03:00"),
  ];
  const fatos = fatosDe([negocio("a", vaiEVolta)]);

  it("por período: a reunião é de agosto, e a volta em setembro NÃO conta de novo", () => {
    expect(contagem(resumoPorPeriodo(fatos, C, AGOSTO, AGORA)).reuniao).toBe(1);
    expect(contagem(resumoPorPeriodo(fatos, C, SETEMBRO, AGORA)).reuniao).toBe(0);
  });

  it("por mês de entrada: uma entrada, um lead em cada degrau", () => {
    const r = resumoDoPeriodo(fatos, C, AGOSTO, AGORA);
    expect(r.entradas).toBe(1);
    expect(contagem(r)).toEqual({ lead: 1, mql: 1, reuniao: 1, proposta: 0, contrato: 0 });
  });

  it("voltou da perda: não é perdido em mês nenhum, nos dois modos", () => {
    for (const intervalo of [AGOSTO, SETEMBRO]) {
      expect(resumoPorPeriodo(fatos, C, intervalo, AGORA).perdidos).toBe(0);
    }
    expect(resumoDoPeriodo(fatos, C, AGOSTO, AGORA).perdidos).toBe(0);
    expect(fatos[0].situacao).toBe("andamento");
  });

  it("ENQUANTO está desqualificado: a perda é do mês em que aconteceu, e o alcance fica", () => {
    const ateAPerda = fatosDe([negocio("a", vaiEVolta.slice(0, 4))]);
    const ago = resumoPorPeriodo(ateAPerda, C, AGOSTO, AGORA);
    expect(ago.perdidos).toBe(1);
    expect(ago.perdasPorEtapa.find((x) => x.etapaId === "desqualificado")?.n).toBe(1);
    expect(contagem(ago).reuniao).toBe(1);
    expect(resumoPorPeriodo(ateAPerda, C, SETEMBRO, AGORA).perdidos).toBe(0);
  });
});

describe("2) sair de Reunião para Contrato não tira o lead de Reunião", () => {
  const fechou = fatosDe([
    negocio("b", [
      p("contato-avulso", "2026-09-02T10:00:00-03:00", "deal_created"),
      p("reuniao-agendada", "2026-09-04T10:00:00-03:00"),
      p("contrato-fechado", "2026-09-12T10:00:00-03:00"),
    ]),
  ]);

  it("conta em todos os degraus — Proposta inclusive, que ele pulou — nos dois modos", () => {
    const todos = { lead: 1, mql: 1, reuniao: 1, proposta: 1, contrato: 1 };
    expect(contagem(resumoPorPeriodo(fechou, C, SETEMBRO, AGORA))).toEqual(todos);
    expect(contagem(resumoDoPeriodo(fechou, C, SETEMBRO, AGORA))).toEqual(todos);
  });

  it("o degrau pulado ganha a data do degrau que o alcançou (Proposta = dia do contrato)", () => {
    const [f] = fechou;
    expect(f.alcancouEm.map((d) => d?.toISOString().slice(0, 10))).toEqual([
      "2026-09-02",
      "2026-09-04",
      "2026-09-04",
      "2026-09-12",
      "2026-09-12",
    ]);
  });
});

describe("dinheiro e perda por período", () => {
  it("distrato: conta no degrau do mês do contrato, some do dinheiro, e é perda do mês em que se perdeu", () => {
    const fatos = fatosDe([
      negocio(
        "d",
        [
          p("contato-avulso", "2026-08-02T10:00:00-03:00", "deal_created"),
          p("contrato-fechado", "2026-08-10T10:00:00-03:00"),
          p("desqualificado", "2026-09-05T10:00:00-03:00"),
        ],
        5000,
      ),
    ]);
    const ago = resumoPorPeriodo(fatos, C, AGOSTO, AGORA);
    const set = resumoPorPeriodo(fatos, C, SETEMBRO, AGORA);
    expect(ago.fechados).toBe(1);
    expect(ago.fechadosAgora).toBe(0);
    expect(ago.valorFechado).toBe(0);
    expect(ago.perdidos).toBe(0);
    expect(set.perdidos).toBe(1);
  });

  it("perdido duas vezes na MESMA etapa: vale a última entrada, e conta uma vez só", () => {
    const fatos = fatosDe([
      negocio("e", [
        p("contato-avulso", "2026-08-02T10:00:00-03:00", "deal_created"),
        p("no-show", "2026-08-10T10:00:00-03:00"),
        p("reuniao-agendada", "2026-08-12T10:00:00-03:00"),
        p("no-show", "2026-09-03T10:00:00-03:00"),
      ]),
    ]);
    expect(resumoPorPeriodo(fatos, C, AGOSTO, AGORA).perdidos).toBe(0);
    expect(resumoPorPeriodo(fatos, C, SETEMBRO, AGORA).perdidos).toBe(1);
  });

  it("os leads que ENTRARAM no período seguem com a foto de hoje (igual à coorte)", () => {
    const fatos = fatosDe([
      negocio("s1", [p("contato-avulso", "2026-09-02T10:00:00-03:00", "deal_created")]),
      negocio("s2", [
        p("contato-avulso", "2026-09-03T10:00:00-03:00", "deal_created"),
        p("mql1", "2026-09-04T10:00:00-03:00"),
      ]),
      negocio("s3", [
        p("contato-avulso", "2026-09-05T10:00:00-03:00", "deal_created"),
        p("estacionamento", "2026-09-06T10:00:00-03:00"),
      ]),
    ]);
    const periodo = resumoPorPeriodo(fatos, C, SETEMBRO, AGORA);
    const coorte = resumoDoPeriodo(fatos, C, SETEMBRO, AGORA);
    for (const campo of ["semAvanco", "emAndamento", "foraDoFunil", "entradas"] as const) {
      expect(periodo[campo]).toBe(coorte[campo]);
    }
    expect(periodo.emAndamentoPorDegrau).toEqual(coorte.emAndamentoPorDegrau);
    expect(periodo.entradasPorDia).toEqual(coorte.entradasPorDia);
  });
});

describe("eventos retroativos (a carga da Kommo) contam na data REAL", () => {
  it("a origem do evento não importa: vale o instante que ele carrega", () => {
    const importado = negocio("k", [
      { ...p("contato-avulso", "2026-06-10T10:00:00-03:00", "deal_created"), origem: "retroativo" },
      { ...p("reuniao-agendada", "2026-06-15T10:00:00-03:00"), origem: "retroativo" },
      { ...p("contrato-fechado", "2026-08-05T10:00:00-03:00"), origem: "retroativo" },
    ]);
    const fatos = fatosDe([importado]);
    expect(resumoPorPeriodo(fatos, C, AGOSTO, AGORA).fechados).toBe(1);
    expect(resumoPorPeriodo(fatos, C, OUTUBRO, AGORA).fechados).toBe(0);
  });
});

describe("o modo", () => {
  it("o padrão é por período, e valor estranho no storage cai nele", () => {
    expect(MODO_PADRAO).toBe("periodo");
    expect(lerModo("entrada")).toBe("entrada");
    expect(lerModo("periodo")).toBe("periodo");
    for (const lixo of [null, undefined, "", "coorte", 1, {}, "PERIODO"]) {
      expect(lerModo(lixo)).toBe("periodo");
    }
  });

  it("resumoNoModo despacha para a conta certa", () => {
    const fatos = fatosDe([
      negocio("x", [
        p("contato-avulso", "2026-08-02T10:00:00-03:00", "deal_created"),
        p("contrato-fechado", "2026-09-02T10:00:00-03:00"),
      ]),
    ]);
    expect(resumoNoModo("periodo", fatos, C, SETEMBRO, AGORA).fechados).toBe(1);
    expect(resumoNoModo("entrada", fatos, C, SETEMBRO, AGORA).fechados).toBe(0);
    expect(resumoNoModo("entrada", fatos, C, AGOSTO, AGORA).fechados).toBe(1);
  });
});
