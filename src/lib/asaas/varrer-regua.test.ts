import { describe, expect, it } from "vitest";

import type { DispatchInput, ResultadoDoDisparo } from "@/lib/automations/engine";

import { AsaasError } from "./cliente";
import { dubleDoAsaas, dubleDoSupabase, type EstadoDoDuble, type PedidosAoAsaas, type RespostasDoAsaas } from "./duble.test-helper";
import { varrerRegua, type DependenciasDaVarredura } from "./varrer-regua";

const CONTA = "conta-1";
const DONO = "dono-1";
const CANAL = "canal-1";
const FUSO = "America/Sao_Paulo";
const ATIVADA = "2026-09-01T12:00:00Z";
const LISTAGEM = "2026-09-14T11:50:00Z";
/** segunda 14/09/2026, 09:30 em São Paulo */
const AGORA = new Date("2026-09-14T12:30:00Z");

const automacao = (id: string, tipo: "asaas_cobranca_vencida" | "asaas_cobranca_vence_hoje", cfg: Record<string, unknown>, name = id) => ({ id, account_id: CONTA, name, trigger_type: tipo, trigger_config: cfg, is_active: true, user_id: DONO });
const cliente = (customer: string, contact: string | null, extra: Record<string, unknown> = {}) => ({ id: `l-${customer}`, account_id: CONTA, asaas_customer_id: customer, contact_id: contact, nome: `Cliente ${customer}`, deleted: false, regua_desligada: false, ...extra });
const cobranca = (id: string, customer: string, extra: Record<string, unknown> = {}) => ({
  id,
  account_id: CONTA,
  asaas_payment_id: `pay_${id}`,
  asaas_customer_id: customer,
  status: "OVERDUE",
  deleted: false,
  valor: 100,
  juros_e_multa: null,
  vencimento: "2026-09-11",
  vencimento_original: null,
  vista_vencida_em: "2026-09-12T03:00:00Z",
  pago_em: null,
  forma: "BOLETO",
  pode_pagar_apos_vencimento: true,
  dias_ate_cancelar_registro: null,
  descricao: null,
  parcelamento_id: null,
  parcela_numero: 1,
  parcela_total: 3,
  link_fatura: "https://asaas/i/x",
  link_boleto: null,
  visto_em: LISTAGEM,
  ...extra,
});
/** a resposta do Asaas para a releitura: a mesma cobrança, no estado que se quer */
const noAsaas = (id: string, customer: string, extra: Record<string, unknown> = {}) => ({ id: `pay_${id}`, customer, status: "OVERDUE", value: 100, dueDate: "2026-09-11", invoiceUrl: "https://asaas/i/x", ...extra });

function estado(extra: Partial<Record<string, unknown[]>> = {}, config: Record<string, unknown> = {}): EstadoDoDuble {
  return {
    tabelas: {
      accounts: [{ id: CONTA, owner_user_id: DONO, name: "CB Advogados" }],
      cb_asaas_config: [{ account_id: CONTA, regua_ativa: true, regua_ativada_em: ATIVADA, regua_intervalo_dias: 3, vencidas_listadas_em: LISTAGEM, ...config }],
      cb_channels: [{ id: CANAL, account_id: CONTA, status: "connected" }],
      automations: [automacao("a-1", "asaas_cobranca_vencida", { dias_de_atraso: 1 }, "Cobrança · 1 dia"), automacao("a-0", "asaas_cobranca_vence_hoje", {}, "Lembrete")],
      cb_asaas_clientes: [cliente("cus_a", "ct-a")],
      cb_asaas_cobrancas: [cobranca("c1", "cus_a")],
      cb_asaas_regua_envios: [],
      conversations: [],
      automation_logs: [],
      ...extra,
    },
    escritas: [],
  };
}

interface Disparos {
  chamadas: DispatchInput[];
}

/** O motor falso: registra o disparo e grava o log como o motor de verdade gravaria. */
function motorFalso(e: EstadoDoDuble, disparos: Disparos, desfecho: "concluida" | "barrada" | "falhou" = "concluida") {
  return async (input: DispatchInput): Promise<ResultadoDoDisparo> => {
    disparos.chamadas.push(input);
    e.tabelas.automation_logs.push({
      id: `log-${disparos.chamadas.length}`,
      automation_id: input.context?.automation_id,
      contact_id: input.contactId,
      created_at: new Date().toISOString(),
      desfecho,
      steps_executed: desfecho === "concluida" ? [{ step_type: "send_message", status: "success" }] : desfecho === "falhou" ? [{ step_type: "send_message", status: "failed" }] : [],
      error_message: desfecho === "falhou" ? "WhatsApp not configured" : null,
    });
    return { candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: desfecho === "falhou" ? 1 : 0, emEspera: 0 };
  };
}

function deps(e: EstadoDoDuble, respostas: RespostasDoAsaas, extra: Partial<DependenciasDaVarredura> = {}, disparos: Disparos = { chamadas: [] }, registro: PedidosAoAsaas = { pedidos: [] }): { d: DependenciasDaVarredura; disparos: Disparos; registro: PedidosAoAsaas } {
  return {
    disparos,
    registro,
    d: {
      agora: AGORA,
      fuso: FUSO,
      cliente: dubleDoAsaas(respostas, registro),
      lerPassos: async () => [{ step_type: "send_message", step_config: { text: "{{vars.cobranca_detalhe}}", channel_id: CANAL } }],
      disparar: motorFalso(e, disparos),
      saudeDasConexoes: async () => new Map([[CANAL, true]]),
      ...extra,
    },
  };
}

describe("varrerRegua — o interruptor e as cercas", () => {
  it("com a régua DESLIGADA (D20) não lê candidata nenhuma nem fala com o Asaas", async () => {
    const e = estado({}, { regua_ativa: false });
    const { d, registro, disparos } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.ativa).toBe(false);
    expect(registro.pedidos).toEqual([]);
    expect(disparos.chamadas).toEqual([]);
  });

  it("cliente na lista de exceção (D21) e cliente sem ficha ficam fora", async () => {
    const e = estado({ cb_asaas_clientes: [cliente("cus_a", "ct-a", { regua_desligada: true }), cliente("cus_b", null)], cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c2", "cus_b")] });
    const { d, disparos } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.candidatos).toBe(0);
    expect(disparos.chamadas).toEqual([]);
  });

  it("parcela vista ANTES de ligar a régua (o atrasado antigo, D13) não é candidata", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("c1", "cus_a", { vista_vencida_em: "2026-08-20T03:00:00Z" })] });
    const { d, disparos } = deps(e, { listas: {}, recursos: {} });
    expect((await varrerRegua(dubleDoSupabase(e), CONTA, d)).candidatos).toBe(0);
    expect(disparos.chamadas).toEqual([]);
  });

  it("conexão do passo que não existe na conta: a automação inteira é pulada, contada em conexaoInvalida", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: {} }, { lerPassos: async () => [{ step_type: "send_message", step_config: { text: "x", channel_id: "canal-apagado" } }] });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.conexaoInvalida).toBe(2);
    expect(disparos.chamadas).toEqual([]);
  });

  it("conexão desconectada: a candidata é pulada SEM travar (o ciclo seguinte tenta)", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: {} }, { saudeDasConexoes: async () => new Map([[CANAL, false]]) });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.semConexao).toBe(1);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
    expect(disparos.chamadas).toEqual([]);
  });

  it("fora da janela (antes das 9h) nada sai", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: {} }, { agora: new Date("2026-09-14T11:30:00Z") /* 08:30 */ });
    expect((await varrerRegua(dubleDoSupabase(e), CONTA, d)).candidatos).toBe(0);
    expect(disparos.chamadas).toEqual([]);
  });
});

describe("varrerRegua — a cobrança do marco", () => {
  it("cruzou o marco de 1 dia: reconfirma no Asaas, trava, cria a conversa com o canal do passo, dispara SÓ a automação carimbada e mede `enviado`", async () => {
    const e = estado();
    const { d, disparos, registro } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r).toMatchObject({ ativa: true, automacoes: 2, candidatos: 1, enviados: 1, absorvidos: 0, falhas: 0, interrompida: null });
    expect(registro.pedidos).toEqual(["/payments/pay_c1"]);
    expect(disparos.chamadas).toHaveLength(1);
    const ch = disparos.chamadas[0];
    expect(ch.triggerType).toBe("asaas_cobranca_vencida");
    expect(ch.contactId).toBe("ct-a");
    expect(ch.context?.automation_id).toBe("a-1");
    expect(ch.context?.channel_id).toBe(CANAL);
    expect(ch.context?.vars?.cobranca_quantidade).toBe("1");
    expect(ch.context?.vars?.dias_de_atraso).toBe("3");
    // a conversa nasceu com o dono da conta e o canal do passo, sem pino
    const conversa = e.tabelas.conversations[0];
    expect(conversa).toMatchObject({ account_id: CONTA, user_id: DONO, contact_id: "ct-a", channel_id: CANAL, channel_pinned: false });
    expect(ch.context?.conversation_id).toBe(conversa.id);
    // a trava é do marco, com o desfecho
    expect(e.tabelas.cb_asaas_regua_envios).toHaveLength(1);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ cobranca_id: "c1", tipo: "atraso", marco: 1, vencimento: "2026-09-11", automation_id: "a-1", contact_id: "ct-a", resultado: "enviado" });
  });

  it("o ciclo seguinte no mesmo dia NÃO manda de novo: a trava do marco recusa o grupo", async () => {
    const e = estado();
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } };
    const { d, disparos } = deps(e, respostas);
    await varrerRegua(dubleDoSupabase(e), CONTA, d);
    const { d: d2 } = deps(e, respostas, {}, disparos);
    const r2 = await varrerRegua(dubleDoSupabase(e), CONTA, d2);
    expect(r2.enviados).toBe(0);
    expect(disparos.chamadas).toHaveLength(1);
    expect(e.tabelas.cb_asaas_regua_envios).toHaveLength(1);
  });

  it("pagou há três minutos: a releitura no Asaas tira a parcela, nada é travado nem disparado, e o espelho é atualizado", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a", { status: "RECEIVED", paymentDate: "2026-09-14" }) } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(0);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
    expect(e.tabelas.cb_asaas_cobrancas[0].status).toBe("RECEIVED");
  });

  it("a mensagem lista TODAS as vencidas do cliente (D11) e só a que cruzou o marco é travada", async () => {
    const e = estado({
      cb_asaas_cobrancas: [
        cobranca("c1", "cus_a"), // venceu 11/09, cruza o marco de 1 hoje
        cobranca("c0", "cus_a", { vencimento: "2026-08-11", vista_vencida_em: "2026-09-02T03:00:00Z", parcela_numero: 0 }), // antiga, dentro da régua, sem marco hoje
      ],
    });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } });
    await varrerRegua(dubleDoSupabase(e), CONTA, d);
    const vars = disparos.chamadas[0].context?.vars ?? {};
    expect(vars.cobranca_quantidade).toBe("2");
    expect(vars.cobranca_vencimento).toBe("11/08/2026");
    expect(e.tabelas.cb_asaas_regua_envios.map((t) => t.cobranca_id)).toEqual(["c1"]);
  });

  it("dois marcos do mesmo cliente no mesmo dia: UMA mensagem (o maior marco) e a trava de cada parcela com o seu marco, a outra `absorvida`", async () => {
    const e = estado({
      automations: [automacao("a-1", "asaas_cobranca_vencida", { dias_de_atraso: 1 }), automacao("a-30", "asaas_cobranca_vencida", { dias_de_atraso: 30 })],
      cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c30", "cus_a", { vencimento: "2026-08-15", vista_vencida_em: "2026-09-02T03:00:00Z" })],
    });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c30": noAsaas("c30", "cus_a", { dueDate: "2026-08-15" }) } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas).toHaveLength(1);
    expect(disparos.chamadas[0].context?.automation_id).toBe("a-30");
    const travas = e.tabelas.cb_asaas_regua_envios.map((t) => ({ c: t.cobranca_id, m: t.marco, r: t.resultado }));
    expect(travas).toEqual(expect.arrayContaining([{ c: "c1", m: 1, r: "absorvida" }, { c: "c30", m: 30, r: "enviado" }]));
  });

  it("intervalo mínimo (D11, 13/09): cobrança enviada anteontem → o marco de hoje é travado como `absorvida`, sem mensagem", async () => {
    const e = estado({ cb_asaas_regua_envios: [{ id: "t-old", account_id: CONTA, cobranca_id: "c-old", asaas_customer_id: "cus_a", tipo: "atraso", marco: 5, vencimento: "2026-09-07", automation_nome: "x", resultado: "enviado", criado_em: "2026-09-12T13:00:00Z" }] });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.absorvidos).toBe(1);
    expect(r.enviados).toBe(0);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios.find((t) => t.cobranca_id === "c1")).toMatchObject({ resultado: "absorvida", detalhe: "intervalo mínimo de 3 dias" });
  });

  it("falha no envio: a trava registra `falhou` e NÃO é tentada de novo no ciclo seguinte", async () => {
    const e = estado();
    const disparos: Disparos = { chamadas: [] };
    const { d } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } }, { disparar: motorFalso(e, disparos, "falhou") }, disparos);
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.falhas).toBe(1);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ resultado: "falhou", detalhe: "WhatsApp not configured" });
    const { d: d2 } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } }, {}, disparos);
    await varrerRegua(dubleDoSupabase(e), CONTA, d2);
    expect(disparos.chamadas).toHaveLength(1);
  });

  it("o interruptor desligado NO MEIO do ciclo: o grupo é descartado sem travar e a varredura para", async () => {
    const e = estado({ cb_asaas_clientes: [cliente("cus_a", "ct-a"), cliente("cus_b", "ct-b")], cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c2", "cus_b")] });
    const admin = dubleDoSupabase(e);
    let releituras = 0;
    const respostas: RespostasDoAsaas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c2": noAsaas("c2", "cus_b") } };
    const { d, disparos } = deps(e, respostas, {
      cliente: {
        ...dubleDoAsaas(respostas),
        async obter<T>(caminho: string): Promise<T | null> {
          releituras++;
          // depois da primeira releitura, alguém desliga o interruptor
          if (releituras === 1) e.tabelas.cb_asaas_config[0].regua_ativa = false;
          return (respostas.recursos[caminho] ?? null) as T | null;
        },
      },
    });
    const r = await varrerRegua(admin, CONTA, d);
    expect(r.desligadaNoMeio).toBe(true);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
  });

  it("cota do Asaas (429) na releitura: a varredura para sem travar nada", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: {}, erro: new AsaasError("limite", "429") });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.interrompida).toBe("429");
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
  });
});

describe("varrerRegua — o lembrete do vencimento (D17)", () => {
  const as8h = new Date("2026-09-14T11:10:00Z"); // 08:10 em São Paulo

  it("PENDING vencendo hoje: lembrete às 8h, com o detalhe só do que vence hoje", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null })] });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "PENDING", dueDate: "2026-09-14" }) } }, { agora: as8h });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas[0].triggerType).toBe("asaas_cobranca_vence_hoje");
    expect(disparos.chamadas[0].context?.automation_id).toBe("a-0");
    expect(disparos.chamadas[0].context?.vars?.vencimento_texto).toBe("vence hoje");
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ tipo: "vence_hoje", marco: 0, resultado: "enviado" });
  });

  it("cliente com marco às 9h NÃO recebe o lembrete às 8h; às 9h a cobrança leva a linha 'e hoje vence…' e trava o lembrete como absorvido (uma mensagem só)", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null, parcela_numero: 2 })] });
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "PENDING", dueDate: "2026-09-14" }) } };
    const { d: d8, disparos } = deps(e, respostas, { agora: as8h });
    const r8 = await varrerRegua(dubleDoSupabase(e), CONTA, d8);
    expect(r8.enviados).toBe(0);
    expect(disparos.chamadas).toEqual([]);
    const { d: d9 } = deps(e, respostas, {}, disparos);
    const r9 = await varrerRegua(dubleDoSupabase(e), CONTA, d9);
    expect(r9.enviados).toBe(1);
    expect(disparos.chamadas).toHaveLength(1);
    expect(disparos.chamadas[0].triggerType).toBe("asaas_cobranca_vencida");
    expect(disparos.chamadas[0].context?.vars?.vence_hoje_detalhe).toContain("Parcela 2/3");
    const travas = e.tabelas.cb_asaas_regua_envios.map((t) => ({ c: t.cobranca_id, tipo: t.tipo, r: t.resultado }));
    expect(travas).toEqual(expect.arrayContaining([{ c: "c1", tipo: "atraso", r: "enviado" }, { c: "h1", tipo: "vence_hoje", r: "absorvida" }]));
  });

  it("paga por Pix de manhã: a releitura tira a parcela e o lembrete não sai", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null })] });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "RECEIVED", dueDate: "2026-09-14", paymentDate: "2026-09-14" }) } }, { agora: as8h });
    expect((await varrerRegua(dubleDoSupabase(e), CONTA, d)).enviados).toBe(0);
    expect(disparos.chamadas).toEqual([]);
  });
});

describe("varrerRegua — travas órfãs", () => {
  it("`reservado` há mais de 10 min sem log é apagada; com log vira `incerto`", async () => {
    const velha = new Date(AGORA.getTime() - 15 * 60_000).toISOString();
    const e = estado({
      cb_asaas_regua_envios: [
        { id: "t-1", account_id: CONTA, cobranca_id: "c-x", asaas_customer_id: "cus_x", tipo: "atraso", marco: 1, vencimento: "2026-09-01", automation_id: "a-1", automation_nome: "x", contact_id: "ct-x", resultado: "reservado", criado_em: velha },
        { id: "t-2", account_id: CONTA, cobranca_id: "c-y", asaas_customer_id: "cus_y", tipo: "atraso", marco: 1, vencimento: "2026-09-01", automation_id: "a-1", automation_nome: "x", contact_id: "ct-y", resultado: "reservado", criado_em: velha },
      ],
      automation_logs: [{ id: "log-y", automation_id: "a-1", contact_id: "ct-y", created_at: new Date(AGORA.getTime() - 14 * 60_000).toISOString(), desfecho: null, steps_executed: [] }],
      cb_asaas_cobrancas: [],
    });
    const { d } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.orfasRecolhidas).toBe(2);
    expect(e.tabelas.cb_asaas_regua_envios.map((t) => [t.id, t.resultado])).toEqual([["t-2", "incerto"]]);
  });
});
