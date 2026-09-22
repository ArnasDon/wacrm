import { afterEach, describe, expect, it, vi } from "vitest";

import type { DispatchInput, ResultadoDoDisparo } from "@/lib/automations/engine";

import { AsaasError } from "./cliente";
import { dubleDoAsaas, dubleDoSupabase, type EstadoDoDuble, type PedidosAoAsaas, type RespostasDoAsaas } from "./duble.test-helper";
import { varrerRegua, vivaParaEnviar, type DependenciasDaVarredura } from "./varrer-regua";

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
      cb_channels: [{ id: CANAL, account_id: CONTA, status: "connected", kind: "evolution" }],
      contacts: [{ id: "ct-a", account_id: CONTA, phone: "5583980000016" }, { id: "ct-b", account_id: CONTA, phone: "5583980000017" }],
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
function motorFalso(e: EstadoDoDuble, disparos: Disparos, desfecho: "concluida" | "barrada" | "falhou" | "na_fila" = "concluida") {
  return async (input: DispatchInput): Promise<ResultadoDoDisparo> => {
    disparos.chamadas.push(input);
    // `na_fila`: o provedor recusou (4xx) e o motor reenfileirou o passo (PR
    // #205) — o log fica sem desfecho, com o passo `failed`, e o disparo
    // volta com `emEspera`.
    e.tabelas.automation_logs.push({
      id: `log-${disparos.chamadas.length}`,
      automation_id: input.context?.automation_id,
      contact_id: input.contactId,
      created_at: new Date().toISOString(),
      desfecho: desfecho === "na_fila" ? null : desfecho,
      steps_executed: desfecho === "concluida" ? [{ step_type: "send_message", status: "success" }] : desfecho === "falhou" || desfecho === "na_fila" ? [{ step_type: "send_message", status: "failed" }] : [],
      error_message: desfecho === "falhou" ? "WhatsApp not configured" : desfecho === "na_fila" ? "Evolution 400 — tentativa 1 de 3; nova tentativa em 30s" : null,
    });
    return { candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: desfecho === "falhou" ? 1 : 0, emEspera: desfecho === "na_fila" ? 1 : 0 };
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function deps(e: EstadoDoDuble, respostas: RespostasDoAsaas, extra: Partial<DependenciasDaVarredura> = {}, disparos: Disparos = { chamadas: [] }, registro: PedidosAoAsaas = { pedidos: [] }): { d: DependenciasDaVarredura; disparos: Disparos; registro: PedidosAoAsaas } {
  // ⚠️ O relógio do SISTEMA também segue o carimbo do teste: o `now()` da
  // trava no dublê, o `created_at` do log no motor falso e os carimbos da
  // própria varredura leem `new Date()`. Com o relógio real o resultado
  // dependia do calendário: em 15/09/2026 a trava do ciclo de 14/09 nascia
  // com a data do relógio (15/09), a varredura do "dia seguinte" (15/09) a
  // lia como cobrança de HOJE e pulava o cliente antes do intervalo mínimo —
  // e o CI de todo PR reprovou naquele dia.
  vi.setSystemTime(extra.agora ?? AGORA);
  return {
    disparos,
    registro,
    d: {
      agora: AGORA,
      // o relógio vivo segue o carimbo do teste (o padrão da varredura é `new Date()`)
      relogio: () => extra.agora ?? AGORA,
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

  it("conexão do passo que não é por QR Code (Instagram/Meta): a automação é pulada como conexão inválida — o robô não fala no Direct, e a Meta não manda texto livre fora das 24 h (Codex, 2ª rodada)", async () => {
    const e = estado({ cb_channels: [{ id: CANAL, account_id: CONTA, status: "connected", kind: "instagram" }] });
    const { d, disparos } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    // as DUAS automações (cobrança e lembrete) apontam para a mesma conexão
    expect(r.conexaoInvalida).toBe(2);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
  });

  it("ficha ligada SEM telefone (só Instagram): pulada sem travar, contada em semTelefone (Codex, 2ª rodada)", async () => {
    const e = estado({ contacts: [{ id: "ct-a", account_id: CONTA, phone: null, instagram_id: "1780" }] });
    const { d, disparos } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.semTelefone).toBe(1);
    expect(r.candidatos).toBe(0);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
  });

  it("telefone que o remetente do robô recusa (zero na frente, 18 dígitos de JID de grupo): pulado sem travar — senão a trava fechava `falhou` sem nova chance (Codex, 4ª rodada do PR #206)", async () => {
    const e = estado({
      contacts: [{ id: "ct-a", account_id: CONTA, phone: "0800123456789" }, { id: "ct-b", account_id: CONTA, phone: "120363025246125486" }, { id: "ct-c", account_id: CONTA, phone: "(83) 98000-0016" }],
      cb_asaas_clientes: [cliente("cus_a", "ct-a"), cliente("cus_b", "ct-b"), cliente("cus_c", "ct-c")],
      cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c2", "cus_b"), cobranca("c3", "cus_c")],
    });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c3": noAsaas("c3", "cus_c") } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.semTelefone).toBe(2);
    // o número bom continua candidato
    expect(r.candidatos).toBe(1);
    expect(disparos.chamadas.map((c) => c.contactId)).toEqual(["ct-c"]);
    expect(e.tabelas.cb_asaas_regua_envios.map((t) => t.cobranca_id)).toEqual(["c3"]);
  });

  it("a janela FECHA entre a seleção e a trava (a varredura começou 17:59, as releituras cruzaram as 18:00): nada é travado nem disparado (Codex, 3ª rodada)", async () => {
    const e = estado();
    const comeco = new Date("2026-09-14T20:59:30Z"); // 17:59:30 em São Paulo
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } }, { agora: comeco, relogio: () => new Date("2026-09-14T21:00:10Z") });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.candidatos).toBe(1);
    expect(r.janelaFechou).toBe(1);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
  });

  it("a linha FRESCA passa pelas cercas de novo: o Asaas passou a dizer que o boleto não pode mais ser pago depois do vencimento → nada é travado (Codex, 3ª rodada)", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a", { canBePaidAfterDueDate: false }) } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.candidatos).toBe(1);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
    expect(e.tabelas.cb_asaas_cobrancas[0]).toMatchObject({ pode_pagar_apos_vencimento: false });
  });

  it("a SONDA das conexões falha: nada sai, nada é travado, e o resultado diz que foi a sonda (não a conexão)", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: {} }, { saudeDasConexoes: async () => null });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.sondaFalhou).toBe(true);
    expect(r.semConexao).toBe(1);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
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

  it("a releitura dá 404 na cobrança e o CLIENTE dela responde: a parcela é marcada apagada e nada sai — a mesma cerca da reconciliação", async () => {
    const e = estado();
    const { d, disparos, registro } = deps(e, { listas: {}, recursos: { "/customers/cus_a": { id: "cus_a", name: "Cliente cus_a" } } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(registro.pedidos).toContain("/customers/cus_a");
    expect(r.interrompida).toBeNull();
    expect(r.enviados).toBe(0);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
    expect(e.tabelas.cb_asaas_cobrancas[0]).toMatchObject({ deleted: true });
  });

  it("a releitura dá 404 na cobrança E no cliente (a chave é de OUTRA conta): a varredura para como `conta_trocada` e o espelho NÃO é marcado apagado", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.interrompida).toBe("conta_trocada");
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
    expect(e.tabelas.cb_asaas_cobrancas[0]).toMatchObject({ deleted: false });
  });

  it("TODAS as parcelas da mensagem são relidas no Asaas antes da trava: a antiga paga entre a sincronização e o disparo sai do texto e o espelho é atualizado (Codex, 2ª rodada)", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c-ago", "cus_a", { asaas_payment_id: "pay_ago", vencimento: "2026-08-11", vista_vencida_em: "2026-08-12T03:00:00Z" })] });
    const { d, disparos, registro } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_ago": noAsaas("ago", "cus_a", { status: "RECEIVED", dueDate: "2026-08-11" }) } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(registro.pedidos.join(" ")).toMatch(/pay_ago/);
    const vars = disparos.chamadas[0].context?.vars as Record<string, string>;
    expect(vars.cobranca_quantidade).toBe("1");
    expect(vars.cobranca_detalhe).not.toMatch(/11\/08/);
    expect(e.tabelas.cb_asaas_cobrancas.find((c) => c.id === "c-ago")).toMatchObject({ status: "RECEIVED" });
  });

  it("a mensagem lista TODAS as vencidas do cliente (D11) e só a que cruzou o marco é travada", async () => {
    const e = estado({
      cb_asaas_cobrancas: [
        cobranca("c1", "cus_a"), // venceu 11/09, cruza o marco de 1 hoje
        cobranca("c0", "cus_a", { vencimento: "2026-08-11", vista_vencida_em: "2026-09-02T03:00:00Z", parcela_numero: 0 }), // antiga, dentro da régua, sem marco hoje
      ],
    });
    // as duas são relidas no Asaas antes da trava (a mensagem lista as duas)
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c0": noAsaas("c0", "cus_a", { dueDate: "2026-08-11" }) } });
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
    // `dias_de_atraso` é o da parcela do marco que MANDA a mensagem, não o da
    // primeira da lista (a ordem das parcelas vem do UUID no banco — Codex, 4ª rodada do PR #206)
    expect(disparos.chamadas[0].context?.vars?.dias_de_atraso).toBe("30");
  });

  it("a parcela do MAIOR marco é paga entre a sincronização e o disparo: a mensagem sai pela automação do marco que SOBROU — e o marco menor não fica travado como absorvido para sempre (Codex, 4ª rodada do PR #206)", async () => {
    const e = estado({
      automations: [automacao("a-1", "asaas_cobranca_vencida", { dias_de_atraso: 1 }, "Cobrança · 1 dia"), automacao("a-30", "asaas_cobranca_vencida", { dias_de_atraso: 30 }, "Cobrança · 30 dias")],
      cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c30", "cus_a", { vencimento: "2026-08-15", vista_vencida_em: "2026-09-02T03:00:00Z" })],
    });
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c30": noAsaas("c30", "cus_a", { status: "RECEIVED", dueDate: "2026-08-15", paymentDate: "2026-09-14" }) } };
    const { d, disparos } = deps(e, respostas);
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(r.absorvidos).toBe(0);
    expect(disparos.chamadas).toHaveLength(1);
    expect(disparos.chamadas[0].context?.automation_id).toBe("a-1");
    expect(disparos.chamadas[0].context?.vars?.cobranca_quantidade).toBe("1");
    expect(e.tabelas.cb_asaas_regua_envios).toHaveLength(1);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ cobranca_id: "c1", tipo: "atraso", marco: 1, automation_id: "a-1", automation_nome: "Cobrança · 1 dia", resultado: "enviado", detalhe: null });
    expect(e.tabelas.cb_asaas_cobrancas.find((c) => c.id === "c30")).toMatchObject({ status: "RECEIVED" });
    // o ciclo seguinte do mesmo dia não manda de novo
    const { d: d2 } = deps(e, respostas, {}, disparos);
    await varrerRegua(dubleDoSupabase(e), CONTA, d2);
    expect(disparos.chamadas).toHaveLength(1);
  });

  it("a automação escolhida DEPOIS da releitura usa outra conexão: a saúde, o canal da conversa e o do disparo são os DELA; a pré-checagem não gasta GET com todas as conexões caídas (Codex, 4ª rodada do PR #206)", async () => {
    const montar = () =>
      estado({
        cb_channels: [
          { id: CANAL, account_id: CONTA, status: "connected", kind: "evolution" },
          { id: "canal-2", account_id: CONTA, status: "connected", kind: "evolution" },
        ],
        automations: [automacao("a-1", "asaas_cobranca_vencida", { dias_de_atraso: 1 }, "Cobrança · 1 dia"), automacao("a-30", "asaas_cobranca_vencida", { dias_de_atraso: 30 }, "Cobrança · 30 dias")],
        cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c30", "cus_a", { vencimento: "2026-08-15", vista_vencida_em: "2026-09-02T03:00:00Z" })],
      });
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c30": noAsaas("c30", "cus_a", { status: "RECEIVED", dueDate: "2026-08-15", paymentDate: "2026-09-14" }) } };
    const lerPassos = async (id: string) => [{ step_type: "send_message", step_config: { text: "x", channel_id: id === "a-30" ? "canal-2" : CANAL } }];

    // A: a conexão da automação de 30 dias está caída, a de 1 dia viva — sai pela de 1 dia
    const eA = montar();
    const a = deps(eA, respostas, { lerPassos, saudeDasConexoes: async () => new Map([[CANAL, true], ["canal-2", false]]) });
    const rA = await varrerRegua(dubleDoSupabase(eA), CONTA, a.d);
    expect(rA.enviados).toBe(1);
    expect(a.disparos.chamadas[0].context?.channel_id).toBe(CANAL);
    expect(eA.tabelas.conversations[0]).toMatchObject({ channel_id: CANAL });

    // B: a de 30 viva (a pré-checagem passa e relê), a de 1 caída — a escolhida não tem conexão: nada travado
    const eB = montar();
    const b = deps(eB, respostas, { lerPassos, saudeDasConexoes: async () => new Map([[CANAL, false], ["canal-2", true]]) });
    const rB = await varrerRegua(dubleDoSupabase(eB), CONTA, b.d);
    expect(rB.semConexao).toBe(1);
    expect(b.registro.pedidos).toContain("/payments/pay_c30");
    expect(eB.tabelas.cb_asaas_regua_envios).toEqual([]);
    expect(b.disparos.chamadas).toEqual([]);

    // C: as duas caídas — a pré-checagem pula sem falar com o Asaas
    const eC = montar();
    const c = deps(eC, respostas, { lerPassos, saudeDasConexoes: async () => new Map([[CANAL, false], ["canal-2", false]]) });
    const rC = await varrerRegua(dubleDoSupabase(eC), CONTA, c.d);
    expect(rC.semConexao).toBe(1);
    expect(c.registro.pedidos).toEqual([]);
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

  it("o provedor recusou e o motor reenfileirou (PR #205): a trava fica `na_fila` com o id do log, conta como cobrada para o intervalo, e a varredura seguinte a fecha pelo log", async () => {
    const e = estado();
    const disparos: Disparos = { chamadas: [] };
    const { d } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } }, { disparar: motorFalso(e, disparos, "na_fila") }, disparos);
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.naFila).toBe(1);
    expect(r.enviados).toBe(0);
    expect(r.falhas).toBe(0);
    const trava = e.tabelas.cb_asaas_regua_envios[0] as Record<string, unknown>;
    expect(trava).toMatchObject({ resultado: "na_fila", automation_log_id: "log-1", finalizado_em: null });

    // o motor rodou de novo e concluiu: o log ganha desfecho
    const log = e.tabelas.automation_logs[0] as Record<string, unknown>;
    log.desfecho = "concluida";
    log.steps_executed = [{ step_type: "send_message", status: "failed" }, { step_type: "send_message", status: "success" }];
    // um segundo marco do MESMO cliente no dia seguinte (terça 15/09: venceu 11/09 + 4) cai no
    // intervalo mínimo de 3 dias: a cobrança de segunda conta, mesmo tendo saído pela fila do motor
    e.tabelas.automations.push(automacao("a-2", "asaas_cobranca_vencida", { dias_de_atraso: 4 }, "Cobrança · 4 dias"));
    const amanha = new Date(AGORA.getTime() + 86_400_000);
    const { d: d2 } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } }, { agora: amanha }, disparos);
    const r2 = await varrerRegua(dubleDoSupabase(e), CONTA, d2);
    expect(r2.reconciliadas).toBe(1);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ resultado: "enviado", automation_log_id: "log-1" });
    expect((e.tabelas.cb_asaas_regua_envios[0] as Record<string, unknown>).finalizado_em).toEqual(expect.any(String));
    expect(r2.absorvidos).toBe(1);
    expect(disparos.chamadas).toHaveLength(1);
  });

  it("`na_fila` cujo log continua sem desfecho depois de 1 h vira `incerto`; antes disso a varredura espera o motor", async () => {
    const e = estado({
      cb_asaas_regua_envios: [
        { id: "t-1", account_id: CONTA, cobranca_id: "c1", asaas_customer_id: "cus_a", tipo: "atraso", marco: 1, vencimento: "2026-09-11", automation_id: "a-1", automation_nome: "Cobrança · 1 dia", contact_id: "ct-a", automation_log_id: "log-x", resultado: "na_fila", detalhe: null, criado_em: new Date(AGORA.getTime() - 20 * 60_000).toISOString(), finalizado_em: null },
      ],
      automation_logs: [{ id: "log-x", automation_id: "a-1", contact_id: "ct-a", created_at: new Date(AGORA.getTime() - 20 * 60_000).toISOString(), desfecho: null, steps_executed: [{ step_type: "send_message", status: "failed" }], error_message: null }],
    });
    const { d } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.reconciliadas).toBe(0);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ resultado: "na_fila" });

    const depois = new Date(AGORA.getTime() + 61 * 60_000);
    const { d: d2 } = deps(e, { listas: {}, recursos: {} }, { agora: depois });
    const r2 = await varrerRegua(dubleDoSupabase(e), CONTA, d2);
    expect(r2.reconciliadas).toBe(1);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ resultado: "incerto", detalhe: "retentativa sem desfecho registrado" });
  });

  it("`na_fila` cujo log fechou `falhou` depois de uma MÍDIA entregue ao contato: a trava fecha `enviado` — o cliente recebeu (Codex, 4ª rodada do PR #206)", async () => {
    const e = estado({
      cb_asaas_regua_envios: [
        { id: "t-1", account_id: CONTA, cobranca_id: "c1", asaas_customer_id: "cus_a", tipo: "atraso", marco: 1, vencimento: "2026-09-11", automation_id: "a-1", automation_nome: "Cobrança · 1 dia", contact_id: "ct-a", automation_log_id: "log-x", resultado: "na_fila", detalhe: null, criado_em: new Date(AGORA.getTime() - 20 * 60_000).toISOString(), finalizado_em: null },
      ],
      automation_logs: [{ id: "log-x", automation_id: "a-1", contact_id: "ct-a", created_at: new Date(AGORA.getTime() - 20 * 60_000).toISOString(), desfecho: "falhou", steps_executed: [{ step_type: "send_media", status: "success" }, { step_type: "send_message", status: "failed" }], error_message: "Evolution 500" }],
    });
    const { d } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.reconciliadas).toBe(1);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ resultado: "enviado" });
  });

  it("o `send_message` DENTRO de um ramo de condição é encontrado: a automação não é pulada como 'conexão inválida' (Codex, PR #206)", async () => {
    const e = estado();
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } }, {
      lerPassos: async () => [{ step_type: "condition", step_config: {}, branches: { yes: [{ step_type: "send_message", step_config: { text: "x", channel_id: CANAL } }], no: [] } }],
    });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.conexaoInvalida).toBe(0);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas[0].context?.channel_id).toBe(CANAL);
  });

  it("cobrança absorvida pelo intervalo mínimo + parcela vencendo hoje: o LEMBRETE sai (o intervalo não o conta), e nada é travado como 'absorvida pela cobrança' (Codex, PR #206)", async () => {
    const e = estado({
      cb_asaas_regua_envios: [{ id: "t-old", account_id: CONTA, cobranca_id: "c-old", asaas_customer_id: "cus_a", tipo: "atraso", marco: 5, vencimento: "2026-09-07", automation_nome: "x", resultado: "enviado", criado_em: "2026-09-12T13:00:00Z" }],
      cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c2", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null })],
    });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c2": noAsaas("c2", "cus_a", { status: "PENDING", dueDate: "2026-09-14" }) } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.absorvidos).toBe(1);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas.map((c) => c.triggerType)).toEqual(["asaas_cobranca_vence_hoje"]);
    const travas = e.tabelas.cb_asaas_regua_envios.filter((t) => t.id !== "t-old").map((t) => ({ c: t.cobranca_id, tipo: t.tipo, r: t.resultado }));
    expect(travas).toEqual(expect.arrayContaining([{ c: "c1", tipo: "atraso", r: "absorvida" }, { c: "c2", tipo: "vence_hoje", r: "enviado" }]));
    expect(travas).toHaveLength(2);
  });

  it("dois clientes do Asaas ligados ao MESMO contato: o log do primeiro disparo não responde pelo segundo — sem log próprio, a segunda trava fica `sem_automacao`, sem id de log (Codex, 3ª rodada)", async () => {
    const e = estado({
      cb_asaas_clientes: [cliente("cus_a", "ct-a"), cliente("cus_b", "ct-a")],
      cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("c2", "cus_b")],
    });
    const disparos: Disparos = { chamadas: [] };
    const comLog = motorFalso(e, disparos);
    // o segundo disparo não deixa log (a automação foi desligada entre a seleção e o disparo)
    const disparar = async (input: DispatchInput): Promise<ResultadoDoDisparo> => {
      if (disparos.chamadas.length === 0) return comLog(input);
      disparos.chamadas.push(input);
      return { candidatas: 1, foraDoEscopo: 0, executadas: 0, comFalha: 0, emEspera: 0 };
    };
    const { d } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c2": noAsaas("c2", "cus_b") } }, { disparar }, disparos);
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(disparos.chamadas).toHaveLength(2);
    expect(r.enviados).toBe(1);
    const travas = e.tabelas.cb_asaas_regua_envios.map((t) => ({ c: t.cobranca_id, r: t.resultado, log: t.automation_log_id }));
    expect(travas).toEqual(expect.arrayContaining([{ c: "c1", r: "enviado", log: "log-1" }, { c: "c2", r: "sem_automacao", log: null }]));
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

  it("o Asaas PRORROGOU a PENDING de hoje (a sincronização só a relê amanhã): o lembrete não sai nem é travado, e no vencimento novo ele sai (Codex, 4ª rodada do PR #206)", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null })] });
    const respostas = { listas: {}, recursos: { "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "PENDING", dueDate: "2026-09-30" }) } };
    const { d, disparos } = deps(e, respostas, { agora: as8h });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(0);
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios).toEqual([]);
    expect(e.tabelas.cb_asaas_cobrancas[0]).toMatchObject({ vencimento: "2026-09-30" });

    const quarta30 = new Date("2026-09-30T11:10:00Z"); // quarta, 08:10 em São Paulo
    const { d: d2 } = deps(e, respostas, { agora: quarta30 }, disparos);
    const r2 = await varrerRegua(dubleDoSupabase(e), CONTA, d2);
    expect(r2.enviados).toBe(1);
    expect(disparos.chamadas).toHaveLength(1);
    expect(disparos.chamadas[0].triggerType).toBe("asaas_cobranca_vence_hoje");
    expect(disparos.chamadas[0].context?.vars?.vencimento_texto).toBe("vence hoje");
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ cobranca_id: "h1", tipo: "vence_hoje", marco: 0, vencimento: "2026-09-30", resultado: "enviado" });
  });

  it("o Asaas moveu o vencimento do sábado para a própria segunda (ainda nos dias do lembrete): sai, travado com o vencimento NOVO", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-12", vista_vencida_em: null })] });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "PENDING", dueDate: "2026-09-14" }) } }, { agora: as8h });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas).toHaveLength(1);
    expect(e.tabelas.cb_asaas_regua_envios[0]).toMatchObject({ cobranca_id: "h1", tipo: "vence_hoje", vencimento: "2026-09-14", resultado: "enviado" });
  });

  it("segunda com marco de cobrança e parcela PENDING do sábado: o lembrete cede a vez, e a cobrança leva a parcela do sábado na linha 'venceu no sábado' — nada some do dia (Codex, 4ª rodada do PR #206)", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("s1", "cus_a", { status: "PENDING", vencimento: "2026-09-12", vista_vencida_em: null, parcela_numero: 2 })] });
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_s1": noAsaas("s1", "cus_a", { status: "PENDING", dueDate: "2026-09-12" }) } };
    const { d: d8, disparos, registro } = deps(e, respostas, { agora: as8h });
    await varrerRegua(dubleDoSupabase(e), CONTA, d8);
    expect(disparos.chamadas).toEqual([]);
    const { d: d9 } = deps(e, respostas, {}, disparos, registro);
    const r9 = await varrerRegua(dubleDoSupabase(e), CONTA, d9);
    expect(r9.enviados).toBe(1);
    expect(disparos.chamadas).toHaveLength(1);
    expect(disparos.chamadas[0].triggerType).toBe("asaas_cobranca_vencida");
    const vars = disparos.chamadas[0].context?.vars as Record<string, string>;
    expect(vars.vence_hoje_detalhe).toContain("Parcela 2/3");
    expect(vars.vence_hoje_detalhe).toContain("venceu em 12/09/2026");
    expect(vars.vencimento_texto).toBe("venceu no sábado, 12/09 — o boleto pode ser pago hoje sem juros");
    expect(registro.pedidos).toContain("/payments/pay_s1");
    const travas = e.tabelas.cb_asaas_regua_envios.map((t) => ({ c: t.cobranca_id, tipo: t.tipo, v: t.vencimento, r: t.resultado }));
    expect(travas).toEqual(expect.arrayContaining([{ c: "c1", tipo: "atraso", v: "2026-09-11", r: "enviado" }, { c: "s1", tipo: "vence_hoje", v: "2026-09-12", r: "absorvida" }]));
  });

  it("lembrete configurado para dias CORRIDOS (`somente_dias_uteis: false`): na segunda, a PENDING do sábado (já lembrada no sábado) NÃO entra na cobrança nem ganha trava nova — senão a trava repetida recusava o grupo inteiro por 23505 e a cobrança do marco não saía (revisão do PR #206, 4ª rodada)", async () => {
    const e = estado({
      automations: [automacao("a-1", "asaas_cobranca_vencida", { dias_de_atraso: 1 }, "Cobrança · 1 dia"), automacao("a-0", "asaas_cobranca_vence_hoje", { somente_dias_uteis: false }, "Lembrete")],
      cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("s1", "cus_a", { status: "PENDING", vencimento: "2026-09-12", vista_vencida_em: null, parcela_numero: 2 })],
      cb_asaas_regua_envios: [{ id: "t-sab", account_id: CONTA, cobranca_id: "s1", asaas_customer_id: "cus_a", tipo: "vence_hoje", marco: 0, vencimento: "2026-09-12", automation_id: "a-0", automation_nome: "Lembrete", contact_id: "ct-a", resultado: "enviado", criado_em: "2026-09-12T11:10:00Z", finalizado_em: "2026-09-12T11:10:05Z" }],
    });
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_s1": noAsaas("s1", "cus_a", { status: "PENDING", dueDate: "2026-09-12" }) } };
    const { d, disparos } = deps(e, respostas);
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas.map((c) => c.triggerType)).toEqual(["asaas_cobranca_vencida"]);
    expect(disparos.chamadas[0].context?.vars?.vence_hoje_detalhe ?? "").not.toContain("Parcela 2/3");
    const lembretes = e.tabelas.cb_asaas_regua_envios.filter((t) => t.tipo === "vence_hoje");
    expect(lembretes.map((t) => t.id)).toEqual(["t-sab"]);
  });

  // O sábado foi lembrado com o lembrete em dias CORRIDOS, e antes de segunda
  // alguém ligou "só dias úteis": agora a segunda cobre sábado e domingo, e a
  // configuração ATUAL não sabe que o sábado já saiu — quem sabe é a trava.
  const travaDoSabado = { id: "t-sab", account_id: CONTA, cobranca_id: "s1", asaas_customer_id: "cus_a", tipo: "vence_hoje", marco: 0, vencimento: "2026-09-12", automation_id: "a-0", automation_nome: "Lembrete", contact_id: "ct-a", resultado: "enviado", criado_em: "2026-09-12T11:10:00Z", finalizado_em: "2026-09-12T11:10:05Z" };

  it("o lembrete do sábado já saiu e a configuração virou 'só dias úteis' antes de segunda: a cobrança de segunda NÃO leva a parcela do sábado nem repete a trava dela — senão o 23505 recusava o grupo e o marco se perdia (Codex, PR #212)", async () => {
    const e = estado({
      cb_asaas_cobrancas: [cobranca("c1", "cus_a"), cobranca("s1", "cus_a", { status: "PENDING", vencimento: "2026-09-12", vista_vencida_em: null, parcela_numero: 2 })],
      cb_asaas_regua_envios: [travaDoSabado],
    });
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_s1": noAsaas("s1", "cus_a", { status: "PENDING", dueDate: "2026-09-12" }) } };
    const { d, disparos } = deps(e, respostas);
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas.map((c) => c.triggerType)).toEqual(["asaas_cobranca_vencida"]);
    expect(disparos.chamadas[0].context?.vars?.vence_hoje_detalhe ?? "").not.toContain("Parcela 2/3");
    const lembretes = e.tabelas.cb_asaas_regua_envios.filter((t) => t.tipo === "vence_hoje");
    expect(lembretes.map((t) => t.id)).toEqual(["t-sab"]);
  });

  it("o mesmo no LEMBRETE: a parcela do sábado já lembrada não entra no lembrete de segunda (nem é relida no Asaas), e o da parcela de segunda sai (Codex, PR #212)", async () => {
    const e = estado({
      cb_asaas_cobrancas: [cobranca("s1", "cus_a", { status: "PENDING", vencimento: "2026-09-12", vista_vencida_em: null, parcela_numero: 2 }), cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null, parcela_numero: 3 })],
      cb_asaas_regua_envios: [travaDoSabado],
    });
    const respostas = { listas: {}, recursos: { "/payments/pay_s1": noAsaas("s1", "cus_a", { status: "PENDING", dueDate: "2026-09-12" }), "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "PENDING", dueDate: "2026-09-14" }) } };
    const { d, disparos, registro } = deps(e, respostas, { agora: as8h });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.enviados).toBe(1);
    expect(disparos.chamadas.map((c) => c.triggerType)).toEqual(["asaas_cobranca_vence_hoje"]);
    const vars = disparos.chamadas[0].context?.vars as Record<string, string>;
    expect(vars.cobranca_detalhe).toContain("Parcela 3/3");
    expect(vars.cobranca_detalhe).not.toContain("Parcela 2/3");
    expect(registro.pedidos).not.toContain("/payments/pay_s1");
    const lembretes = e.tabelas.cb_asaas_regua_envios.filter((t) => t.tipo === "vence_hoje").map((t) => ({ c: t.cobranca_id, r: t.resultado }));
    expect(lembretes).toEqual(expect.arrayContaining([{ c: "s1", r: "enviado" }, { c: "h1", r: "enviado" }]));
    expect(lembretes).toHaveLength(2);
  });

  it("paga por Pix de manhã: a releitura tira a parcela e o lembrete não sai", async () => {
    const e = estado({ cb_asaas_cobrancas: [cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null })] });
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "RECEIVED", dueDate: "2026-09-14", paymentDate: "2026-09-14" }) } }, { agora: as8h });
    expect((await varrerRegua(dubleDoSupabase(e), CONTA, d)).enviados).toBe(0);
    expect(disparos.chamadas).toEqual([]);
  });
});

describe("varrerRegua — travas órfãs", () => {
  it("leitura do log que FALHA não recolhe: a trava fica `reservado` (apagá-la deixaria o ciclo seguinte mandar de novo — Codex, PR #206)", async () => {
    const e = estado({
      cb_asaas_regua_envios: [{ id: "t-1", account_id: CONTA, cobranca_id: "c1", asaas_customer_id: "cus_a", tipo: "atraso", marco: 1, vencimento: "2026-09-11", automation_id: "a-1", automation_nome: "x", contact_id: "ct-a", resultado: "reservado", criado_em: new Date(AGORA.getTime() - 15 * 60_000).toISOString() }],
    });
    e.falhasDeLeitura = { automation_logs: "connection reset" };
    const { d, disparos } = deps(e, { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a") } });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.orfasRecolhidas).toBe(0);
    expect(e.tabelas.cb_asaas_regua_envios.map((t) => [t.id, t.resultado])).toEqual([["t-1", "reservado"]]);
    // e a trava viva continua barrando o marco: nada disparado
    expect(disparos.chamadas).toEqual([]);
  });

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

  it("a órfã SEM log leva junto as `absorvida` do MESMO grupo (o mesmo INSERT): senão o ciclo seguinte batia 23505 nelas o dia inteiro e nenhuma cobrança nem lembrete saía (revisão do PR #206, 4ª rodada)", async () => {
    const e = estado({
      automations: [automacao("a-1", "asaas_cobranca_vencida", { dias_de_atraso: 1 }), automacao("a-30", "asaas_cobranca_vencida", { dias_de_atraso: 30 }), automacao("a-0", "asaas_cobranca_vence_hoje", {})],
      cb_asaas_cobrancas: [
        cobranca("c1", "cus_a"),
        cobranca("c30", "cus_a", { vencimento: "2026-08-15", vista_vencida_em: "2026-09-02T03:00:00Z" }),
        cobranca("h1", "cus_a", { status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null, parcela_numero: 2 }),
      ],
    });
    const respostas = { listas: {}, recursos: { "/payments/pay_c1": noAsaas("c1", "cus_a"), "/payments/pay_c30": noAsaas("c30", "cus_a", { dueDate: "2026-08-15" }), "/payments/pay_h1": noAsaas("h1", "cus_a", { status: "PENDING", dueDate: "2026-09-14" }) } };

    // ciclo 1: a conversa estoura DEPOIS da trava (soluço do banco, ou o processo morto no rollout)
    e.falhasDeLeitura = { conversations: "connection reset" };
    const { d, disparos } = deps(e, respostas);
    const r1 = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r1.interrompida).toBe("conversa: connection reset");
    expect(disparos.chamadas).toEqual([]);
    expect(e.tabelas.cb_asaas_regua_envios.map((t) => [t.cobranca_id, t.tipo, t.resultado])).toEqual(
      expect.arrayContaining([["c30", "atraso", "reservado"], ["c1", "atraso", "absorvida"], ["h1", "vence_hoje", "absorvida"]]),
    );
    // o `now()` do INSERT: o mesmo instante para as três linhas, no começo do ciclo
    for (const t of e.tabelas.cb_asaas_regua_envios) t.criado_em = AGORA.toISOString();

    // ciclo 2, 11 min depois: a órfã é recolhida COM o grupo, e a cobrança sai
    delete e.falhasDeLeitura;
    const { d: d2 } = deps(e, respostas, { agora: new Date(AGORA.getTime() + 11 * 60_000) }, disparos);
    const r2 = await varrerRegua(dubleDoSupabase(e), CONTA, d2);
    expect(r2.orfasRecolhidas).toBe(1);
    expect(r2.enviados).toBe(1);
    expect(disparos.chamadas.map((c) => c.context?.automation_id)).toEqual(["a-30"]);
    expect(e.tabelas.cb_asaas_regua_envios.map((t) => [t.cobranca_id, t.tipo, t.resultado])).toEqual(
      expect.arrayContaining([["c30", "atraso", "enviado"], ["c1", "atraso", "absorvida"], ["h1", "vence_hoje", "absorvida"]]),
    );
    expect(e.tabelas.cb_asaas_regua_envios).toHaveLength(3);
  });

  it("a órfã recolhida NÃO leva as `absorvida` de OUTRO grupo (outro INSERT = outro instante, ou outro cliente)", async () => {
    const velha = new Date(AGORA.getTime() - 15 * 60_000).toISOString();
    const outroInstante = new Date(AGORA.getTime() - 20 * 60_000).toISOString();
    const linha = (id: string, cobrancaId: string, resultado: string, criado_em: string, extra: Record<string, unknown> = {}) => ({ id, account_id: CONTA, cobranca_id: cobrancaId, asaas_customer_id: "cus_x", tipo: "atraso", marco: 1, vencimento: "2026-09-01", automation_id: "a-1", automation_nome: "x", contact_id: "ct-x", resultado, criado_em, finalizado_em: null, ...extra });
    const e = estado({
      cb_asaas_regua_envios: [
        linha("t-orfa", "c-1", "reservado", velha),
        linha("t-irma", "c-2", "absorvida", velha),
        linha("t-outra", "c-3", "absorvida", outroInstante),
        linha("t-outro-cliente", "c-4", "absorvida", velha, { asaas_customer_id: "cus_y", contact_id: "ct-y" }),
        // a órfã COM log (pode ter saído → `incerto`) mantém as irmãs: a mensagem pode ter levado as parcelas delas
        linha("t-orfa-y", "c-5", "reservado", velha, { asaas_customer_id: "cus_y", contact_id: "ct-y", tipo: "atraso", marco: 30 }),
        linha("t-irma-y", "c-6", "absorvida", velha, { asaas_customer_id: "cus_y", contact_id: "ct-y" }),
      ],
      automation_logs: [{ id: "log-y", automation_id: "a-1", contact_id: "ct-y", created_at: new Date(AGORA.getTime() - 14 * 60_000).toISOString(), desfecho: null, steps_executed: [] }],
      cb_asaas_cobrancas: [],
    });
    const { d } = deps(e, { listas: {}, recursos: {} });
    const r = await varrerRegua(dubleDoSupabase(e), CONTA, d);
    expect(r.orfasRecolhidas).toBe(2);
    expect(e.tabelas.cb_asaas_regua_envios.map((t) => [t.id, t.resultado]).sort()).toEqual([["t-irma-y", "absorvida"], ["t-orfa-y", "incerto"], ["t-outra", "absorvida"], ["t-outro-cliente", "absorvida"]]);
  });
});

describe("vivaParaEnviar — o que a sonda tem de provar (Codex, 2ª rodada do PR #206)", () => {
  it("só `ok`, ou `warn` por causa do WEBHOOK (a instância está aberta); pairing, stale, lastError, down e unknown não provam envio", () => {
    expect(vivaParaEnviar({ tone: "ok", detail: null })).toBe(true);
    expect(vivaParaEnviar({ tone: "warn", detail: "webhook" })).toBe(true);
    expect(vivaParaEnviar({ tone: "warn", detail: "pairing" })).toBe(false);
    expect(vivaParaEnviar({ tone: "warn", detail: "stale" })).toBe(false);
    expect(vivaParaEnviar({ tone: "warn", detail: "lastError" })).toBe(false);
    expect(vivaParaEnviar({ tone: "down", detail: "closed" })).toBe(false);
    expect(vivaParaEnviar({ tone: "unknown", detail: "incomplete" })).toBe(false);
  });

  it("⚠️ ATRASO DE ENTREGA não impede ENVIAR (Codex, PR #220)", () => {
    // `lagging` (1002) descreve a ENTRADA: quanto o WhatsApp demorou para
    // passar a mensagem do cliente à Evolution. O envio é a outra direção e
    // não espera aquela fila. Sem isto, o episódio de 16/09/2026 — uma manhã
    // inteira de conexão `warn`/`lagging` — teria adiado em silêncio todas as
    // cobranças do dia daquela conexão.
    expect(vivaParaEnviar({ tone: "warn", detail: "lagging" })).toBe(true);
  });
});
