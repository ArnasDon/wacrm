import { describe, expect, it } from "vitest";

import { classificarEtapas, type EtapaMinima } from "./degraus";
import {
  aplicarMudancaDeEtapa,
  fatosDoNegocio,
  lerLinha,
  type LinhaDeTrajetoria,
  type PassoDoTrajeto,
} from "./trajetoria";

const FUNIL = "funil-comercial";
const OUTRO = "funil-juridico";

const etapa = (id: string, position: number, degrau: string | null): EtapaMinima => ({
  id,
  name: id,
  position,
  degrau,
});

const CLASSIFICACAO = classificarEtapas([
  etapa("avulso", 0, "lead"),
  etapa("desq", 1, "perda"),
  etapa("lead", 2, "lead"),
  etapa("mql1", 3, "mql"),
  etapa("reuniao", 4, "reuniao"),
  etapa("noshow", 6, "perda"),
  etapa("proposta", 8, "proposta"),
  etapa("contrato", 9, "contrato"),
  etapa("parking", 11, null),
]);

const passo = (
  etapaId: string,
  em: string,
  funil: string = FUNIL,
  tipo: string = "stage_changed",
): PassoDoTrajeto => ({ etapa: etapaId, funil, em, origem: "usuario", tipo });

function linha(sobre: Partial<LinhaDeTrajetoria> & { deal_id: string }): LinhaDeTrajetoria {
  return {
    contact_id: null,
    conversation_id: null,
    conversa_do_contato: null,
    title: "x",
    value: 0,
    status: "open",
    pipeline_id: FUNIL,
    stage_id: "avulso",
    channel_id: null,
    source: "channel",
    assigned_to: null,
    created_at: "2026-09-01T12:00:00+00:00",
    updated_at: null,
    contato_nome: null,
    contato_telefone: null,
    contato_email: null,
    contato_empresa: null,
    contato_avatar: null,
    campos: {},
    trajeto: [passo("avulso", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created")],
    ...sobre,
  };
}

describe("lerLinha — parse sem `as`", () => {
  it("lê a linha da RPC, com numeric em texto e campos nulos", () => {
    const lida = lerLinha({
      deal_id: "d1",
      contact_id: "c1",
      conversation_id: null,
      conversa_do_contato: "conv1",
      title: "Negócio",
      value: "18000.00",
      status: "open",
      pipeline_id: FUNIL,
      stage_id: "lead",
      channel_id: null,
      source: "channel",
      assigned_to: null,
      created_at: "2026-09-01T12:00:00+00:00",
      updated_at: null,
      contato_nome: "Ana",
      contato_telefone: "+5511999",
      contato_email: null,
      contato_empresa: null,
      contato_avatar: null,
      campos: null,
      trajeto: [{ etapa: "lead", funil: FUNIL, em: "2026-09-01T12:00:00+00:00", origem: "conexao", tipo: "deal_created" }],
    });
    expect(lida).not.toBeNull();
    expect(lida?.value).toBe(18000);
    expect(lida?.campos).toEqual({});
    expect(lida?.trajeto).toHaveLength(1);
    expect(lida?.conversa_do_contato).toBe("conv1");
  });

  it("campos vêm como objeto chave → texto; valor que não é texto é ignorado", () => {
    const lida = lerLinha({
      deal_id: "d1",
      pipeline_id: FUNIL,
      stage_id: "lead",
      created_at: "2026-09-01T12:00:00+00:00",
      value: 0,
      campos: { utm_source: "meta", estranho: 3 },
      trajeto: [],
    });
    expect(lida?.campos).toEqual({ utm_source: "meta" });
  });

  it("linha sem identidade, com valor inválido ou passo sem instante é descartada", () => {
    const base = { pipeline_id: FUNIL, stage_id: "lead", created_at: "2026-09-01T12:00:00+00:00", value: 0, trajeto: [] };
    expect(lerLinha({ ...base })).toBeNull();
    expect(lerLinha({ ...base, deal_id: "d1", value: "abc" })).toBeNull();
    expect(lerLinha({ ...base, deal_id: "d1", trajeto: [{ etapa: "lead" }] })).toBeNull();
    expect(lerLinha({ ...base, deal_id: "d1", contact_id: 42 })).toBeNull();
    expect(lerLinha("nada")).toBeNull();
  });
});

describe("fatosDoNegocio — regras 1, 3, 4, 5", () => {
  it("nascido numa etapa de lead: entra na criação e fica 'sem avanço'", () => {
    const f = fatosDoNegocio(linha({ deal_id: "a" }), FUNIL, CLASSIFICACAO);
    expect(f.entradaEm?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(f.degrauMaximo).toBe(0);
    expect(f.situacao).toBe("sem_avanco");
    expect(f.naEtapaDesde!.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(f.noFunil).toBe(true);
    expect(f.transferidoPara).toBeNull();
  });

  it("nascido em etapa SEM degrau e movido depois: a entrada é o movimento", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "b",
        stage_id: "lead",
        trajeto: [
          passo("parking", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
          passo("lead", "2026-09-05T09:00:00+00:00"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.entradaEm?.toISOString()).toBe("2026-09-05T09:00:00.000Z");
    expect(f.situacao).toBe("sem_avanco");
  });

  it("parado em etapa sem degrau: fora do funil, sem entrada", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "g",
        stage_id: "parking",
        trajeto: [passo("parking", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created")],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.entradaEm).toBeNull();
    expect(f.degrauMaximo).toBeNull();
    expect(f.situacao).toBe("fora_do_funil");
  });

  it("regra 3: pular de Lead para Proposta alcança MQL e Reunião por construção", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "d",
        stage_id: "proposta",
        trajeto: [
          passo("lead", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
          passo("proposta", "2026-09-02T10:00:00+00:00"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.degrauMaximo).toBe(3);
    expect(f.situacao).toBe("andamento");
    expect(f.classeAtual).toBe("proposta");
    expect(f.alcancouContrato).toBe(false);
  });

  it("entrar direto em perda É entrada no funil (regra 1) e conta como perdido", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "f",
        stage_id: "desq",
        trajeto: [
          passo("parking", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
          passo("desq", "2026-09-02T08:00:00+00:00"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.entradaEm?.toISOString()).toBe("2026-09-02T08:00:00.000Z");
    expect(f.degrauMaximo).toBeNull();
    expect(f.situacao).toBe("perdido");
    expect(f.etapaAtual).toBe("desq");
  });

  it("perda depois de avançar: perdido, mas o alcance fica (No Show depois de Reunião)", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "e",
        stage_id: "noshow",
        trajeto: [
          passo("lead", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
          passo("mql1", "2026-09-01T13:00:00+00:00"),
          passo("reuniao", "2026-09-02T13:00:00+00:00"),
          passo("noshow", "2026-09-03T13:00:00+00:00"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.situacao).toBe("perdido");
    expect(f.degrauMaximo).toBe(2);
    expect(f.naEtapaDesde!.toISOString()).toBe("2026-09-03T13:00:00.000Z");
  });

  it("voltar para Lead depois de MQL não é 'sem avanço' — é andamento", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "j",
        stage_id: "lead",
        trajeto: [
          passo("lead", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
          passo("mql1", "2026-09-01T13:00:00+00:00"),
          passo("lead", "2026-09-02T13:00:00+00:00"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.situacao).toBe("andamento");
    expect(f.naEtapaDesde!.toISOString()).toBe("2026-09-02T13:00:00.000Z");
  });

  it("chegou a contrato: fechado, alcançou contrato", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "c",
        stage_id: "contrato",
        value: 24000,
        trajeto: [
          passo("lead", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
          passo("contrato", "2026-09-03T12:00:00+00:00"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.situacao).toBe("fechado");
    expect(f.alcancouContrato).toBe(true);
    expect(f.degrauMaximo).toBe(4);
  });

  it("⚠️ regra 6: transferido para outro funil continua aqui, com a última etapa que teve", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "h",
        pipeline_id: OUTRO,
        stage_id: "cliente-ativo",
        value: 18000,
        trajeto: [
          passo("lead", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
          passo("contrato", "2026-09-03T12:00:00+00:00"),
          passo("cliente-ativo", "2026-09-04T12:00:00+00:00", OUTRO, "pipeline_changed"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.noFunil).toBe(false);
    expect(f.transferidoPara).toBe(OUTRO);
    expect(f.etapaAtual).toBe("contrato");
    expect(f.situacao).toBe("fechado");
    expect(f.alcancouContrato).toBe(true);
    expect(f.naEtapaDesde!.toISOString()).toBe("2026-09-03T12:00:00.000Z");
  });

  it("transferido PARA cá: a entrada é a chegada, não a criação no outro funil", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "i",
        stage_id: "lead",
        created_at: "2026-08-20T12:00:00+00:00",
        trajeto: [
          passo("triagem", "2026-08-20T12:00:00+00:00", OUTRO, "deal_created"),
          passo("lead", "2026-09-03T12:00:00+00:00", FUNIL, "pipeline_changed"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.entradaEm?.toISOString()).toBe("2026-09-03T12:00:00.000Z");
    expect(f.situacao).toBe("sem_avanco");
  });

  it("trajeto fora de ordem é ordenado pelo instante", () => {
    const f = fatosDoNegocio(
      linha({
        deal_id: "k",
        stage_id: "mql1",
        trajeto: [
          passo("mql1", "2026-09-02T12:00:00+00:00"),
          passo("lead", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
        ],
      }),
      FUNIL,
      CLASSIFICACAO,
    );
    expect(f.entradaEm?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(f.naEtapaDesde!.toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });
});

describe("aplicarMudancaDeEtapa — estado otimista", () => {
  it("carimba a etapa e acrescenta o passo no formato do gatilho", () => {
    const antes = linha({ deal_id: "a" });
    const em = new Date("2026-09-04T10:00:00.000Z");
    const depois = aplicarMudancaDeEtapa(antes, "mql1", em);
    expect(depois.stage_id).toBe("mql1");
    expect(depois.trajeto).toHaveLength(2);
    expect(depois.trajeto[1]).toEqual({
      etapa: "mql1",
      funil: FUNIL,
      em: "2026-09-04T10:00:00.000Z",
      origem: "usuario",
      tipo: "stage_changed",
    });
    expect(antes.trajeto).toHaveLength(1);
    const f = fatosDoNegocio(depois, FUNIL, CLASSIFICACAO);
    expect(f.situacao).toBe("andamento");
    expect(f.naEtapaDesde).toEqual(em);
  });
});

describe("created_at nulo não derruba a carga", () => {
  it("a linha é aceita e `naEtapaDesde` cai para nulo quando não há passo aqui", () => {
    // `deals.created_at` é DEFAULT now() mas NULLABLE. Uma linha assim
    // fazia `lerLinha` devolver null, e `carregarTrajetorias` descarta a
    // carga INTEIRA no primeiro inválido — as três vistas ficavam em
    // "falhou" para sempre por causa de um carimbo de data (revisão do
    // PR #123).
    const linha = lerLinha({
      deal_id: "d1",
      pipeline_id: "p1",
      stage_id: "s1",
      created_at: null,
      value: 0,
      trajeto: [],
    });
    expect(linha).not.toBeNull();
    expect(linha?.created_at).toBeNull();
  });

  it("forma errada de verdade continua sendo recusada", () => {
    expect(lerLinha({ deal_id: 1, pipeline_id: "p1", stage_id: "s1", value: 0 })).toBeNull();
    expect(lerLinha({ deal_id: "d1", pipeline_id: "p1", stage_id: "s1", value: "muito" })).toBeNull();
  });
});

describe("alcancouEm — a data de cada degrau (regra 7, contagem por período)", () => {
  const datas = (l: LinhaDeTrajetoria) =>
    fatosDoNegocio(l, FUNIL, CLASSIFICACAO).alcancouEm.map((d) => d?.toISOString() ?? null);

  it("um item por degrau; nunca alcançado = nulo", () => {
    expect(datas(linha({ deal_id: "a" }))).toEqual([
      "2026-09-01T12:00:00.000Z",
      null,
      null,
      null,
      null,
    ]);
  });

  it("o PULO dá ao degrau pulado a data de quem o alcançou", () => {
    const l = linha({
      deal_id: "b",
      stage_id: "proposta",
      trajeto: [
        passo("avulso", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
        passo("proposta", "2026-09-05T12:00:00+00:00"),
      ],
    });
    expect(datas(l)).toEqual([
      "2026-09-01T12:00:00.000Z",
      "2026-09-05T12:00:00.000Z",
      "2026-09-05T12:00:00.000Z",
      "2026-09-05T12:00:00.000Z",
      null,
    ]);
  });

  it("REENTRAR na etapa não muda a data: vale a primeira vez", () => {
    const l = linha({
      deal_id: "c",
      stage_id: "reuniao",
      trajeto: [
        passo("avulso", "2026-08-01T12:00:00+00:00", FUNIL, "deal_created"),
        passo("reuniao", "2026-08-10T12:00:00+00:00"),
        passo("desq", "2026-08-20T12:00:00+00:00"),
        passo("reuniao", "2026-09-15T12:00:00+00:00"),
      ],
    });
    expect(datas(l)[2]).toBe("2026-08-10T12:00:00.000Z");
  });

  it("perda e etapa sem degrau não dão data a ninguém; entrar direto em perda deixa tudo nulo", () => {
    const l = linha({
      deal_id: "d",
      stage_id: "desq",
      trajeto: [passo("desq", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created")],
    });
    expect(datas(l)).toEqual([null, null, null, null, null]);
    const estacionado = linha({
      deal_id: "e",
      stage_id: "parking",
      trajeto: [passo("parking", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created")],
    });
    expect(datas(estacionado)).toEqual([null, null, null, null, null]);
  });

  it("só contam os passos DESTE funil; trajeto fora de ordem é ordenado antes", () => {
    const l = linha({
      deal_id: "f",
      stage_id: "mql1",
      trajeto: [
        passo("mql1", "2026-09-09T12:00:00+00:00"),
        passo("contrato", "2026-09-02T12:00:00+00:00", OUTRO),
        passo("avulso", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
      ],
    });
    expect(datas(l)).toEqual([
      "2026-09-01T12:00:00.000Z",
      "2026-09-09T12:00:00.000Z",
      null,
      null,
      null,
    ]);
  });

  it("monotônica: a data do degrau k nunca é posterior à do degrau k+1", () => {
    const l = linha({
      deal_id: "g",
      stage_id: "contrato",
      trajeto: [
        passo("avulso", "2026-09-01T12:00:00+00:00", FUNIL, "deal_created"),
        passo("contrato", "2026-09-03T12:00:00+00:00"),
        passo("mql1", "2026-09-04T12:00:00+00:00"),
        passo("contrato", "2026-09-08T12:00:00+00:00"),
      ],
    });
    const d = fatosDoNegocio(l, FUNIL, CLASSIFICACAO).alcancouEm.map((x) => x?.getTime() ?? null);
    for (let k = 0; k + 1 < d.length; k++) {
      if (d[k] !== null && d[k + 1] !== null) expect(d[k]!).toBeLessThanOrEqual(d[k + 1]!);
    }
    // voltar para MQL depois do contrato não "desalcança" nem redata nada
    expect(d[1]).toBe(new Date("2026-09-03T12:00:00Z").getTime());
  });
});
