import { describe, expect, it } from "vitest";

import {
  classificar,
  diaPorExtenso,
  diasDeAtraso,
  ehDevida,
  faixaDeAtraso,
  resumirDivida,
  rotuloDaParcela,
  rotulosDasParcelas,
  valorAtualizado,
  type ParcelaDoEspelho,
} from "./inadimplencia";

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
    vista_vencida_em: "2026-09-02T12:00:00Z",
    pago_em: null,
    forma: "BOLETO",
    pode_pagar_apos_vencimento: true,
    dias_ate_cancelar_registro: null,
    descricao: null,
    parcelamento_id: null,
    parcela_numero: null,
    parcela_total: null,
    link_fatura: null,
    link_boleto: null,
    visto_em: "2026-09-12T12:00:00Z",
    ...extra,
  };
}

describe("classificar", () => {
  it("lê o enum do Asaas — e status desconhecido não derruba nada", () => {
    expect(classificar("OVERDUE", false)).toBe("vencida");
    expect(classificar("DUNNING_REQUESTED", false)).toBe("negativada");
    expect(classificar("RECEIVED", false)).toBe("paga");
    expect(classificar("CONFIRMED", false)).toBe("paga");
    expect(classificar("RECEIVED_IN_CASH", false)).toBe("paga");
    expect(classificar("DUNNING_RECEIVED", false)).toBe("paga");
    expect(classificar("REFUNDED", false)).toBe("estornada");
    expect(classificar("CHARGEBACK_DISPUTE", false)).toBe("contestada");
    expect(classificar("AWAITING_RISK_ANALYSIS", false)).toBe("em_analise");
    expect(classificar("PENDING", false)).toBe("a_vencer");
    expect(classificar("ALGO_NOVO", false)).toBe("desconhecida");
  });

  it("apagada vence qualquer status", () => {
    expect(classificar("OVERDUE", true)).toBe("apagada");
    expect(ehDevida("apagada")).toBe(false);
  });

  it("negativada conta como devida (D6)", () => {
    expect(ehDevida("vencida")).toBe(true);
    expect(ehDevida("negativada")).toBe(true);
    expect(ehDevida("a_vencer")).toBe(false);
  });
});

describe("diasDeAtraso", () => {
  // ⚠️ O pino é a armadilha da coluna DATE: 23:30 de 12/09 em Brasília já é
  // 13/09 em UTC. Contar em UTC daria um dia a mais em toda leitura noturna.
  it("conta em dias de calendário no fuso do escritório, não em UTC", () => {
    const noite = new Date("2026-09-13T02:30:00Z"); // 12/09 23:30 em São Paulo
    expect(diasDeAtraso("2026-09-12", noite)).toBe(0);
    expect(diasDeAtraso("2026-09-01", noite)).toBe(11);
  });

  it("vencimento prorrogado para a frente dá negativo", () => {
    expect(diasDeAtraso("2026-09-20", new Date("2026-09-12T15:00:00Z"))).toBe(-8);
  });

  it("texto que não é dia devolve null", () => {
    expect(diasDeAtraso("12/09/2026", new Date())).toBeNull();
  });

  it("diaPorExtenso não passa por Date", () => {
    expect(diaPorExtenso("2026-09-01")).toBe("01/09/2026");
    expect(diaPorExtenso("lixo")).toBe("lixo");
  });
});

describe("rótulos das parcelas", () => {
  it("3/12; parcela 3 sem o total; a descrição da avulsa; e 'cobrança' sem nada", () => {
    expect(rotuloDaParcela({ parcela_numero: 3, parcela_total: 12, descricao: null })).toBe("3/12");
    expect(rotuloDaParcela({ parcela_numero: 3, parcela_total: null, descricao: "Honorários" })).toBe("parcela 3");
    expect(rotuloDaParcela({ parcela_numero: null, parcela_total: null, descricao: " Honorários iniciais " })).toBe("Honorários iniciais");
    expect(rotuloDaParcela({ parcela_numero: null, parcela_total: null, descricao: "" })).toBe("cobrança");
  });

  it("lista com 'e' e corta em 'e mais N'", () => {
    const p = (n: number) => ({ parcela_numero: n, parcela_total: 12, descricao: null });
    expect(rotulosDasParcelas([])).toBe("");
    expect(rotulosDasParcelas([p(3)])).toBe("3/12");
    expect(rotulosDasParcelas([p(3), p(4)])).toBe("3/12 e 4/12");
    expect(rotulosDasParcelas([p(3), p(4), p(5)])).toBe("3/12, 4/12 e 5/12");
    expect(rotulosDasParcelas([p(3), p(4), p(5), p(6), p(7)])).toBe("3/12, 4/12, 5/12 e mais 2");
  });
});

describe("resumirDivida", () => {
  const agora = new Date("2026-09-12T15:00:00Z");
  const listagem = "2026-09-12T11:00:00Z";

  it("só as devidas entram, ordenadas pelo vencimento, com o 'desde' na mais antiga", () => {
    const r = resumirDivida(
      [
        parcela({ id: "b", vencimento: "2026-09-01", valor: 620 }),
        parcela({ id: "a", vencimento: "2026-08-01", valor: 620, juros_e_multa: 28.2 }),
        parcela({ id: "paga", vencimento: "2026-07-01", status: "RECEIVED" }),
        parcela({ id: "futura", vencimento: "2026-10-01", status: "PENDING" }),
      ],
      agora,
      listagem,
    );
    expect(r.vencidas.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r.total).toBe(1240);
    expect(r.totalAtualizado).toBe(1268.2);
    expect(r.desde).toBe("2026-08-01");
    expect(r.dias).toBe(42);
    expect(r.negativada).toBe(false);
  });

  it("devida que NÃO voltou na última listagem completa fica em conferência e fora do total", () => {
    const r = resumirDivida(
      [
        parcela({ id: "velha", visto_em: "2026-09-11T10:00:00Z", valor: 300 }),
        parcela({ id: "nova", visto_em: "2026-09-12T11:00:01Z", valor: 100 }),
      ],
      agora,
      listagem,
    );
    expect(r.vencidas.map((p) => p.id)).toEqual(["nova"]);
    expect(r.emConferencia.map((p) => p.id)).toEqual(["velha"]);
    expect(r.total).toBe(100);
  });

  it("sem listagem completa ainda, nada fica em conferência", () => {
    const r = resumirDivida([parcela({ visto_em: "2026-01-01T00:00:00Z" })], agora, null);
    expect(r.vencidas).toHaveLength(1);
    expect(r.emConferencia).toHaveLength(0);
  });

  it("marca a negativada e mantém a apagada fora", () => {
    const r = resumirDivida([parcela({ status: "DUNNING_REQUESTED" }), parcela({ id: "x", deleted: true })], agora, listagem);
    expect(r.vencidas).toHaveLength(1);
    expect(r.negativada).toBe(true);
  });

  it("sem vencida, total zero e dias nulo — nunca '0 dias'", () => {
    const r = resumirDivida([parcela({ status: "RECEIVED" })], agora, listagem);
    expect(r.total).toBe(0);
    expect(r.desde).toBeNull();
    expect(r.dias).toBeNull();
  });
});

describe("valorAtualizado e faixa", () => {
  it("soma juros quando informado, em centavos exatos", () => {
    expect(valorAtualizado({ valor: 620, juros_e_multa: 28.2 })).toBe(648.2);
    expect(valorAtualizado({ valor: 0.1, juros_e_multa: 0.2 })).toBe(0.3);
    expect(valorAtualizado({ valor: 620, juros_e_multa: null })).toBe(620);
  });

  it("as três faixas da lista de inadimplentes", () => {
    expect(faixaDeAtraso(1)).toBe("ate_5");
    expect(faixaDeAtraso(5)).toBe("ate_5");
    expect(faixaDeAtraso(6)).toBe("de_6_a_30");
    expect(faixaDeAtraso(30)).toBe("de_6_a_30");
    expect(faixaDeAtraso(31)).toBe("mais_de_30");
  });
});
