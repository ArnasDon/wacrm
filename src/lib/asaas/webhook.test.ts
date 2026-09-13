import { describe, expect, it } from "vitest";

import {
  CODIGO_DO_EVENTO_DE_CHAVE,
  decisaoDoCron,
  deveEntrarNoEspelho,
  EVENTOS_ASSINADOS,
  gerarTokenDaUrl,
  gerarTokenDeAutenticacao,
  lerAviso,
  lerWebhookDoAsaas,
  podeCriarDaqui,
  RE_TOKEN,
  tokenConfere,
  urlDoWebhook,
} from "./webhook";
import type { CobrancaDoAsaas } from "./leitura";

describe("lerAviso — o corpo é AVISO, não dado (D8)", () => {
  it("de evento de cobrança lê só o id do evento, o tipo, o id da cobrança e o dateCreated cru", () => {
    const aviso = lerAviso({
      id: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
      event: "PAYMENT_RECEIVED",
      dateCreated: "2024-06-12 16:45:03",
      account: { id: "47ed0d25" },
      payment: { object: "payment", id: "pay_080225913252", customer: "cus_G7Dvo4iphUNk", status: "RECEIVED", value: 100, campoNovo: true },
    });
    expect(aviso).toEqual({
      tipo: "cobranca",
      eventoId: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
      evento: "PAYMENT_RECEIVED",
      paymentId: "pay_080225913252",
      criadoEm: "2024-06-12 16:45:03",
    });
  });

  it("evento de chave lê só o NOME da chave — os eventos de chave são da conta inteira", () => {
    expect(lerAviso({ id: "evt_1", event: "ACCESS_TOKEN_DISABLED", accessToken: { id: "x", name: "CRM — produção" } })).toEqual({
      tipo: "chave",
      eventoId: "evt_1",
      evento: "ACCESS_TOKEN_DISABLED",
      nome: "CRM — produção",
      criadoEm: null,
    });
    expect(CODIGO_DO_EVENTO_DE_CHAVE.ACCESS_TOKEN_EXPIRED).toBe("chave_expirada");
  });

  it("evento de cobrança sem payment.id vira `outro` (registrado, não processado); evento desconhecido idem", () => {
    expect(lerAviso({ id: "evt_2", event: "PAYMENT_OVERDUE" })?.tipo).toBe("outro");
    expect(lerAviso({ id: "evt_3", event: "SUBSCRIPTION_CREATED", subscription: { id: "sub_1" } })?.tipo).toBe("outro");
  });

  it("sem id ou sem event não é uma entrega do Asaas", () => {
    expect(lerAviso({ event: "PAYMENT_RECEIVED" })).toBeNull();
    expect(lerAviso({ id: "evt_1" })).toBeNull();
    expect(lerAviso("texto")).toBeNull();
    expect(lerAviso(null)).toBeNull();
  });
});

describe("os tokens", () => {
  it("o token da URL tem a forma da rota; o de autenticação tem 48 caracteres (o Asaas exige 32 a 255)", () => {
    const url = gerarTokenDaUrl();
    expect(RE_TOKEN.test(url)).toBe(true);
    expect(url).toHaveLength(32);
    const auth = gerarTokenDeAutenticacao();
    expect(auth).toHaveLength(48);
    expect(/\s/.test(auth)).toBe(false);
    expect(gerarTokenDeAutenticacao()).not.toBe(auth);
  });

  it("tokenConfere é igualdade exata; ausente ou de outro tamanho não confere", () => {
    expect(tokenConfere("abc", "abc")).toBe(true);
    expect(tokenConfere("abd", "abc")).toBe(false);
    expect(tokenConfere("ab", "abc")).toBe(false);
    expect(tokenConfere(null, "abc")).toBe(false);
    expect(tokenConfere("", "")).toBe(false);
  });

  it("a URL do webhook sai da origem sem barra dupla", () => {
    expect(urlDoWebhook("https://crm.exemplo.com/", "tok")).toBe("https://crm.exemplo.com/api/cb/asaas/webhook/tok");
  });
});

describe("podeCriarDaqui — só a partir do próprio host público", () => {
  it("o mesmo host cria; o preview (localhost) com a URL da produção no env NÃO cria", () => {
    expect(podeCriarDaqui("https://crm.exemplo.com", "https://crm.exemplo.com/api/cb/asaas/webhook")).toBe(true);
    expect(podeCriarDaqui("https://crm.exemplo.com", "http://localhost:3000/api/cb/asaas/webhook")).toBe(false);
    expect(podeCriarDaqui(null, "https://crm.exemplo.com/api")).toBe(false);
    expect(podeCriarDaqui("https://crm.exemplo.com", "lixo")).toBe(false);
  });
});

describe("deveEntrarNoEspelho — o espelho não é cópia do Asaas", () => {
  const base: CobrancaDoAsaas = {
    id: "pay_1",
    clienteId: "cus_1",
    status: "RECEIVED",
    valor: 10,
    jurosEMulta: null,
    vencimento: "2026-09-01",
    vencimentoOriginal: null,
    pagoEm: "2026-09-13",
    forma: "PIX",
    descricao: null,
    parcelamentoId: null,
    parcelaNumero: null,
    assinaturaId: null,
    linkFatura: null,
    linkBoleto: null,
    podePagarAposVencimento: null,
    diasAteCancelarRegistro: null,
    apagado: false,
  };

  it("paga que o espelho NÃO conhece fica de fora; paga que ele conhece entra (é o 'pagou, some do aviso')", () => {
    expect(deveEntrarNoEspelho(base, false, "2026-09-13")).toBe(false);
    expect(deveEntrarNoEspelho(base, true, "2026-09-13")).toBe(true);
  });

  it("vencida e negativada entram sempre; a que vence HOJE entra (D17), a de amanhã não", () => {
    expect(deveEntrarNoEspelho({ ...base, status: "OVERDUE" }, false, "2026-09-13")).toBe(true);
    expect(deveEntrarNoEspelho({ ...base, status: "DUNNING_REQUESTED" }, false, "2026-09-13")).toBe(true);
    expect(deveEntrarNoEspelho({ ...base, status: "PENDING", vencimento: "2026-09-13" }, false, "2026-09-13")).toBe(true);
    expect(deveEntrarNoEspelho({ ...base, status: "PENDING", vencimento: "2026-09-14" }, false, "2026-09-13")).toBe(false);
  });
});

describe("o webhook lido do Asaas e a decisão do cron", () => {
  it("lê id, url, enabled, interrupted e penalizados; sem id é null", () => {
    expect(lerWebhookDoAsaas({ id: "wh_1", url: "https://x/y", enabled: true, interrupted: false, penalizedRequestsCount: 2, hasAuthToken: true })).toEqual({
      id: "wh_1",
      url: "https://x/y",
      enabled: true,
      interrupted: false,
      penalizados: 2,
      temToken: true,
    });
    expect(lerWebhookDoAsaas({ url: "https://x/y" })).toBeNull();
  });

  it("religa UMA vez: interrompida sem religar → religar; interrompida depois de religar → precisa de atenção", () => {
    const w = { id: "wh_1", url: null, enabled: true, interrupted: true, penalizados: 0, temToken: true };
    expect(decisaoDoCron(w, false)).toBe("religar");
    expect(decisaoDoCron(w, true)).toBe("interrompido");
  });

  it("desligada no painel é `desligado`; penalizada é `penalizado`; o resto é `ativo`", () => {
    expect(decisaoDoCron({ id: "wh_1", url: null, enabled: false, interrupted: false, penalizados: 0, temToken: true }, false)).toBe("desligado");
    expect(decisaoDoCron({ id: "wh_1", url: null, enabled: true, interrupted: false, penalizados: 3, temToken: true }, false)).toBe("penalizado");
    expect(decisaoDoCron({ id: "wh_1", url: null, enabled: true, interrupted: false, penalizados: 0, temToken: true }, true)).toBe("ativo");
  });

  it("os eventos assinados cobrem o ciclo da vencida (vence, paga, apaga, restaura, estorna, negativa) e os três de chave", () => {
    for (const e of ["PAYMENT_OVERDUE", "PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "PAYMENT_DUNNING_REQUESTED", "ACCESS_TOKEN_DISABLED", "ACCESS_TOKEN_EXPIRED", "ACCESS_TOKEN_DELETED"]) {
      expect(EVENTOS_ASSINADOS).toContain(e);
    }
    // PAYMENT_CREATED fica de fora de propósito: cobrança nova não é dívida.
    expect(EVENTOS_ASSINADOS).not.toContain("PAYMENT_CREATED");
  });
});
