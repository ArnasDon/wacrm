import { describe, expect, it } from "vitest";

import type { ParcelaDoEspelho } from "./inadimplencia";
import { casaComABusca, ehNomeDeLista, mascararDocumento, montarListas, paginar, type ClienteDoEspelho, type FichaResumida } from "./listas";

const AGORA = new Date("2026-09-12T15:00:00Z");
const LISTAGEM = "2026-09-12T11:00:00Z";

function cliente(extra: Partial<ClienteDoEspelho>): ClienteDoEspelho {
  return {
    id: extra.id ?? "l1",
    asaas_customer_id: extra.asaas_customer_id ?? "cus_1",
    nome: "Maria Aparecida Silva",
    cpf_cnpj: "12345678901",
    email: null,
    celular: "5583980000016",
    telefone: null,
    contact_id: null,
    vinculo_origem: null,
    vinculado_por_nome: null,
    vinculado_em: null,
    contatos_recusados: [],
    candidatos: [],
    deleted: false,
    notificacoes_desligadas: false,
    ...extra,
  };
}

function parcela(extra: Partial<ParcelaDoEspelho>): ParcelaDoEspelho {
  return {
    id: extra.id ?? "p1",
    asaas_payment_id: "pay_1",
    asaas_customer_id: "cus_1",
    status: "OVERDUE",
    deleted: false,
    valor: 100,
    juros_e_multa: null,
    vencimento: "2026-09-01",
    vencimento_original: null,
    vista_vencida_em: null,
    pago_em: null,
    forma: null,
    pode_pagar_apos_vencimento: null,
    dias_ate_cancelar_registro: null,
    descricao: null,
    parcelamento_id: null,
    parcela_numero: null,
    parcela_total: null,
    link_fatura: null,
    link_boleto: null,
    visto_em: "2026-09-12T11:00:00Z",
    ...extra,
  };
}

describe("mascararDocumento", () => {
  it("CPF e CNPJ saem mascarados; tamanho estranho não sai", () => {
    expect(mascararDocumento("12345678901")).toBe("***.456.789-**");
    expect(mascararDocumento("11.222.333/0001-81")).toBe("**.222.333/0001-**");
    expect(mascararDocumento("12345")).toBeNull();
    expect(mascararDocumento(null)).toBeNull();
  });
});

describe("montarListas", () => {
  const fichas = new Map<string, FichaResumida>([
    ["c-maria", { id: "c-maria", nome: "Maria Silva", telefone: "5583980000016" }],
    ["c-outra", { id: "c-outra", nome: "Outra Pessoa", telefone: "5521980000016" }],
  ]);

  it("reparte os clientes nas quatro listas e conta os inadimplentes com e sem ficha", () => {
    const listas = montarListas(
      [
        cliente({ id: "l1", asaas_customer_id: "cus_1", contact_id: "c-maria", vinculo_origem: "telefone" }),
        cliente({ id: "l2", asaas_customer_id: "cus_2", nome: "Ana Souza", candidatos: [{ contact_id: "c-outra", motivo: "sufixo" }] }),
        cliente({ id: "l3", asaas_customer_id: "cus_3", nome: "Carlos", celular: null, candidatos: [{ contact_id: "c-maria", motivo: "nome_aproximado", pontuacao: 0.5 }] }),
        cliente({ id: "l4", asaas_customer_id: "cus_4", nome: "Fornecedor", vinculo_origem: "desvinculado" }),
        cliente({ id: "l5", asaas_customer_id: "cus_5", nome: "Apagado", deleted: true }),
      ],
      [
        parcela({ id: "p1", asaas_customer_id: "cus_1", vencimento: "2026-08-01", valor: 200 }),
        parcela({ id: "p2", asaas_customer_id: "cus_1", vencimento: "2026-09-01", valor: 100, parcela_numero: 2, parcela_total: 12 }),
        parcela({ id: "p3", asaas_customer_id: "cus_2", vencimento: "2026-09-10", valor: 50 }),
        parcela({ id: "p4", asaas_customer_id: "cus_2", status: "NOVO_STATUS" }),
      ],
      fichas,
      AGORA,
      LISTAGEM,
    );
    expect(listas.resumo).toMatchObject({
      clientes: 4,
      ligados: 1,
      ligadosPorOrigem: { telefone: 1 },
      confirmar: 1,
      semFicha: 1,
      ignorados: 1,
      inadimplentes: 2,
      inadimplentesSemFicha: 1,
      parcelasVencidas: 3,
      valorVencido: 350,
      statusDesconhecidos: 1,
      comMaisDeTresParcelas: 0,
    });
    expect(listas.ligados.map((i) => i.id)).toEqual(["l1"]);
    expect(listas.confirmar.map((i) => i.id)).toEqual(["l2"]);
    expect(listas.sem_ficha.map((i) => i.id)).toEqual(["l3"]);
    expect(listas.ignorados.map((i) => i.id)).toEqual(["l4"]);
    // o ligado: contato resolvido, documento mascarado, telefone formatado, dívida
    expect(listas.ligados[0]).toMatchObject({ documento: "***.456.789-**", telefone: "(83) 98000-0016", contato: { id: "c-maria", nome: "Maria Silva" } });
    expect(listas.ligados[0].divida).toMatchObject({ parcelas: 2, rotulos: "cobrança e 2/12", total: 300, desde: "2026-08-01", dias: 42 });
    // candidatos com o nome da ficha e a pontuação
    expect(listas.sem_ficha[0].candidatos[0]).toMatchObject({ id: "c-maria", nome: "Maria Silva", motivo: "nome_aproximado", pontuacao: 0.5 });
    // inadimplentes ordenados pelos dias, maior primeiro; o sem ficha marcado
    expect(listas.inadimplentes.map((i) => i.id)).toEqual(["l1", "l2"]);
    expect(listas.inadimplentes[1]).toMatchObject({ situacao: "confirmar", contato: null, faixa: "ate_5" });
    expect(listas.inadimplentes[0].faixa).toBe("mais_de_30");
  });

  it("a contagem de status desconhecidos vinda do banco vence a contagem local (a leitura das devidas nunca os traz)", () => {
    const listas = montarListas([], [parcela({ status: "NOVO" })], fichas, AGORA, LISTAGEM, { statusDesconhecidos: 7 });
    expect(listas.resumo.statusDesconhecidos).toBe(7);
    expect(montarListas([], [parcela({ status: "NOVO" })], fichas, AGORA, LISTAGEM).resumo.statusDesconhecidos).toBe(1);
  });

  it("origem `criada` e `manual` sem ficha ganham as marcas, e vão para as listas certas", () => {
    const listas = montarListas(
      [cliente({ id: "l1", vinculo_origem: "criada" }), cliente({ id: "l2", asaas_customer_id: "cus_2", vinculo_origem: "manual" })],
      [],
      fichas,
      AGORA,
      LISTAGEM,
    );
    expect(listas.sem_ficha[0]).toMatchObject({ id: "l1", fichaCriadaApagada: true, manualOrfao: false });
    expect(listas.confirmar[0]).toMatchObject({ id: "l2", fichaCriadaApagada: false, manualOrfao: true });
  });

  it("parcela que não voltou na última listagem fica fora da dívida — e CONTADA como 'em conferência'", () => {
    const listas = montarListas([cliente({ contact_id: "c-maria", vinculo_origem: "telefone" })], [parcela({ visto_em: "2026-09-11T10:00:00Z", valor: 350 })], fichas, AGORA, LISTAGEM);
    expect(listas.resumo.inadimplentes).toBe(0);
    expect(listas.ligados[0].divida).toBeNull();
    expect(listas.resumo).toMatchObject({ parcelasEmConferencia: 1, valorEmConferencia: 350 });
  });

  it("a ficha apagada de origem telefone/cpf/email ganha a marca `fichaApagada` e vai para 'Sem ficha'", () => {
    const listas = montarListas([cliente({ id: "l1", vinculo_origem: "telefone" })], [], fichas, AGORA, LISTAGEM);
    expect(listas.sem_ficha[0]).toMatchObject({ id: "l1", fichaApagada: true, fichaCriadaApagada: false });
  });
});

describe("busca e paginação", () => {
  const item = montarListas([cliente({ contact_id: "c-maria", vinculo_origem: "telefone", email: "maria@x.com" })], [], new Map([["c-maria", { id: "c-maria", nome: "Maria Silva", telefone: "5583980000016" }]]), AGORA, LISTAGEM).ligados[0];

  it("casa por nome, e-mail, telefone (dígitos) e nome da ficha", () => {
    expect(casaComABusca(item, "aparecida")).toBe(true);
    expect(casaComABusca(item, "maria@x")).toBe(true);
    expect(casaComABusca(item, "(83) 98000")).toBe(true);
    expect(casaComABusca(item, "silva")).toBe(true);
    expect(casaComABusca(item, "joão")).toBe(false);
    expect(casaComABusca(item, "")).toBe(true);
  });

  it("pagina com teto e página fora da faixa cai na última", () => {
    const itens = Array.from({ length: 45 }, (_, i) => i);
    expect(paginar(itens, 1, 20)).toMatchObject({ total: 45, pagina: 1, paginas: 3 });
    expect(paginar(itens, 3, 20).itens).toEqual([40, 41, 42, 43, 44]);
    expect(paginar(itens, 99, 20).pagina).toBe(3);
    expect(paginar([], 1, 20)).toMatchObject({ total: 0, pagina: 1, paginas: 1, itens: [] });
  });

  it("reconhece os nomes das listas", () => {
    expect(ehNomeDeLista("inadimplentes")).toBe(true);
    expect(ehNomeDeLista("tudo")).toBe(false);
  });
});
