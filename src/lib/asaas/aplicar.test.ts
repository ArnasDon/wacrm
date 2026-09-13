import { describe, expect, it } from "vitest";

import { aplicarCobranca, aplicarCobrancas, linhaDaCobranca } from "./aplicar";
import { dubleDoSupabase, type EstadoDoDuble } from "./duble.test-helper";
import { lerCobranca, type CobrancaDoAsaas } from "./leitura";

const CONTA = "conta-1";

function cobranca(extra: Record<string, unknown> = {}): CobrancaDoAsaas {
  return lerCobranca({ id: "pay_1", customer: "cus_1", status: "OVERDUE", value: 620, dueDate: "2026-09-01", ...extra })!;
}

function estado(cobrancas: Record<string, unknown>[] = []): EstadoDoDuble {
  return { tabelas: { cb_asaas_cobrancas: cobrancas }, escritas: [] };
}

describe("linhaDaCobranca", () => {
  it("sem cliente ou sem vencimento não há linha (a FK e o NOT NULL recusariam)", () => {
    expect(linhaDaCobranca(CONTA, cobranca({ customer: null }), "2026-09-12T10:00:00Z")).toBeNull();
    expect(linhaDaCobranca(CONTA, cobranca({ dueDate: null }), "2026-09-12T10:00:00Z")).toBeNull();
  });

  it("leva o estado atual, o visto_em da listagem e NUNCA vista_vencida_em", () => {
    const l = linhaDaCobranca(CONTA, cobranca({ interestValue: 28.2, installment: "ins_1", installmentNumber: 3 }), "2026-09-12T10:00:00Z")!;
    expect(l).toMatchObject({ asaas_payment_id: "pay_1", asaas_customer_id: "cus_1", status: "OVERDUE", valor: 620, juros_e_multa: 28.2, parcelamento_id: "ins_1", parcela_numero: 3, visto_em: "2026-09-12T10:00:00Z" });
    expect("vista_vencida_em" in l).toBe(false);
  });
});

describe("aplicarCobrancas", () => {
  it("carimba vista_vencida_em na primeira vez e nunca mais", async () => {
    const e = estado();
    const admin = dubleDoSupabase(e);
    await aplicarCobrancas(admin, CONTA, [cobranca()], "2026-09-12T10:00:00Z");
    expect(e.tabelas.cb_asaas_cobrancas[0].vista_vencida_em).toBe("2026-09-12T10:00:00Z");
    await aplicarCobrancas(admin, CONTA, [cobranca({ interestValue: 5 })], "2026-09-13T10:00:00Z");
    expect(e.tabelas.cb_asaas_cobrancas).toHaveLength(1);
    expect(e.tabelas.cb_asaas_cobrancas[0]).toMatchObject({ vista_vencida_em: "2026-09-12T10:00:00Z", visto_em: "2026-09-13T10:00:00Z", juros_e_multa: 5 });
  });

  it("a que vence hoje (PENDING) entra SEM o carimbo; quando virar OVERDUE, ganha", async () => {
    const e = estado();
    const admin = dubleDoSupabase(e);
    await aplicarCobranca(admin, CONTA, cobranca({ status: "PENDING", dueDate: "2026-09-12" }), "2026-09-12T10:00:00Z");
    expect(e.tabelas.cb_asaas_cobrancas[0].vista_vencida_em).toBeNull();
    await aplicarCobranca(admin, CONTA, cobranca({ status: "OVERDUE", dueDate: "2026-09-12" }), "2026-09-13T10:00:00Z");
    expect(e.tabelas.cb_asaas_cobrancas[0].vista_vencida_em).toBe("2026-09-13T10:00:00Z");
  });

  it("conta o que descartou e grava em lotes", async () => {
    const e = estado();
    const muitas = Array.from({ length: 205 }, (_, i) => cobranca({ id: `pay_${i}` }));
    const r = await aplicarCobrancas(dubleDoSupabase(e), CONTA, [...muitas, cobranca({ id: "x", customer: null })], "2026-09-12T10:00:00Z");
    expect(r).toEqual({ gravadas: 205, descartadas: 1 });
    expect(e.tabelas.cb_asaas_cobrancas).toHaveLength(205);
    expect(e.escritas.filter((w) => w.op === "upsert")).toHaveLength(3);
  });

  it("a mesma cobrança duas vezes na listagem (paginação por offset) vira UMA linha — a última vence", async () => {
    const e = estado();
    const r = await aplicarCobrancas(dubleDoSupabase(e), CONTA, [cobranca({ value: 100 }), cobranca({ value: 120 })], "2026-09-12T10:00:00Z");
    expect(r.gravadas).toBe(1);
    expect(e.tabelas.cb_asaas_cobrancas).toHaveLength(1);
    expect(e.tabelas.cb_asaas_cobrancas[0].valor).toBe(120);
  });

  it("a paga NÃO recebe carimbo", async () => {
    const e = estado();
    await aplicarCobranca(dubleDoSupabase(e), CONTA, cobranca({ status: "RECEIVED" }), "2026-09-12T10:00:00Z");
    expect(e.tabelas.cb_asaas_cobrancas[0].vista_vencida_em).toBeNull();
  });
});
