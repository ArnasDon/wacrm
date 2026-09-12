import { describe, expect, it } from "vitest";

import { conectarAsaas, desconectarAsaas, RECOLHER_CICLO_MS } from "./conexao";
import { dubleDoAsaas, dubleDoSupabase, type EstadoDoDuble, type RespostasDoAsaas } from "./duble.test-helper";

const CONTA = "conta-1";
const CHAVE = "$aact_prod_chave_de_teste_0000";

function estado(extra: Partial<Record<string, unknown[]>> = {}): EstadoDoDuble {
  return { tabelas: { cb_asaas_config: [], cb_asaas_clientes: [], cb_asaas_cobrancas: [], ...extra }, escritas: [] };
}

const cliente = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra });

describe("conectarAsaas — a chave é da MESMA conta?", () => {
  const espelho = [
    { id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", deleted: false, visto_em: "2026-09-12T10:00:00Z" },
    { id: "l-b", account_id: CONTA, asaas_customer_id: "cus_B", deleted: false, visto_em: "2026-09-11T10:00:00Z" },
    { id: "l-c", account_id: CONTA, asaas_customer_id: "cus_C", deleted: false, visto_em: "2026-09-10T10:00:00Z" },
    { id: "l-d", account_id: CONTA, asaas_customer_id: "cus_D", deleted: false, visto_em: "2026-09-09T10:00:00Z" },
  ];

  it("sem espelho, conecta direto", async () => {
    const e = estado();
    const r = await conectarAsaas(dubleDoSupabase(e), CONTA, "u1", CHAVE, { cliente: () => dubleDoAsaas({ listas: { "/customers": [cliente("cus_X")] }, recursos: {} }) });
    expect(r).toEqual({ ok: true });
    expect(e.tabelas.cb_asaas_config).toHaveLength(1);
  });

  it("uma sonda respondendo basta", async () => {
    const e = estado({ cb_asaas_clientes: espelho });
    const respostas: RespostasDoAsaas = { listas: { "/customers": [cliente("cus_A")] }, recursos: { "/customers/cus_A": cliente("cus_A") } };
    expect(await conectarAsaas(dubleDoSupabase(e), CONTA, "u1", CHAVE, { cliente: () => dubleDoAsaas(respostas) })).toEqual({ ok: true });
  });

  it("as três sondas apagadas no Asaas, mas a listagem cruza com o espelho: é a mesma conta (chave rotacionada)", async () => {
    const e = estado({ cb_asaas_clientes: espelho });
    // cus_A/B/C foram apagados no Asaas depois da última listagem; cus_D continua lá
    const respostas: RespostasDoAsaas = { listas: { "/customers": [cliente("cus_D"), cliente("cus_novo")] }, recursos: {} };
    const registro = { pedidos: [] as string[] };
    const r = await conectarAsaas(dubleDoSupabase(e), CONTA, "u1", CHAVE, { cliente: () => dubleDoAsaas(respostas, registro) });
    expect(r).toEqual({ ok: true });
    expect(registro.pedidos).toEqual(["/customers", "/customers/cus_A", "/customers/cus_B", "/customers/cus_C", "/customers"]);
  });

  it("nada cruza: a chave é de OUTRA conta e é recusada, sem gravar", async () => {
    const e = estado({ cb_asaas_clientes: espelho });
    const respostas: RespostasDoAsaas = { listas: { "/customers": [cliente("cus_de_outro_cnpj")] }, recursos: {} };
    expect(await conectarAsaas(dubleDoSupabase(e), CONTA, "u1", CHAVE, { cliente: () => dubleDoAsaas(respostas) })).toEqual({ ok: false, codigo: "conta_trocada" });
    expect(e.tabelas.cb_asaas_config).toHaveLength(0);
  });
});

describe("desconectarAsaas — respeita o cadeado do ciclo", () => {
  it("com um ciclo em curso (batimento recente), recusa com em_curso e não apaga nada", async () => {
    const e = estado({
      cb_asaas_config: [{ account_id: CONTA, sincronizando_desde: new Date(Date.now() - 30_000).toISOString(), last_sync_attempt_at: new Date(Date.now() - 30_000).toISOString() }],
      cb_asaas_clientes: [{ id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", deleted: false }],
    });
    expect(await desconectarAsaas(dubleDoSupabase(e), CONTA, { apagarEspelho: true })).toEqual({ ok: false, codigo: "em_curso" });
    expect(e.tabelas.cb_asaas_config).toHaveLength(1);
    expect(e.tabelas.cb_asaas_clientes).toHaveLength(1);
  });

  it("ciclo morto (sem batimento há mais de 10 min) não segura: toma o cadeado e apaga", async () => {
    const e = estado({
      cb_asaas_config: [{ account_id: CONTA, sincronizando_desde: new Date(Date.now() - 3 * RECOLHER_CICLO_MS).toISOString(), last_sync_attempt_at: new Date(Date.now() - RECOLHER_CICLO_MS - 1000).toISOString() }],
      cb_asaas_clientes: [{ id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", deleted: false }],
    });
    expect(await desconectarAsaas(dubleDoSupabase(e), CONTA, { apagarEspelho: true })).toEqual({ ok: true });
    expect(e.tabelas.cb_asaas_config).toHaveLength(0);
    expect(e.tabelas.cb_asaas_clientes).toHaveLength(0);
  });

  it("sem config (já desconectado), apagar o espelho segue direto", async () => {
    const e = estado({ cb_asaas_clientes: [{ id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", deleted: false }] });
    expect(await desconectarAsaas(dubleDoSupabase(e), CONTA, { apagarEspelho: true })).toEqual({ ok: true });
    expect(e.tabelas.cb_asaas_clientes).toHaveLength(0);
  });

  it("desconectar comum mantém o espelho", async () => {
    const e = estado({
      cb_asaas_config: [{ account_id: CONTA, sincronizando_desde: null, last_sync_attempt_at: null }],
      cb_asaas_clientes: [{ id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", deleted: false }],
    });
    expect(await desconectarAsaas(dubleDoSupabase(e), CONTA)).toEqual({ ok: true });
    expect(e.tabelas.cb_asaas_config).toHaveLength(0);
    expect(e.tabelas.cb_asaas_clientes).toHaveLength(1);
  });
});
