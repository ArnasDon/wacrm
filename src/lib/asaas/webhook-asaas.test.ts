import { describe, expect, it } from "vitest";

import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { AsaasError } from "./cliente";
import { dubleDoAsaas, dubleDoSupabase, type EstadoDoDuble, type PedidosAoAsaas, type RespostasDoAsaas } from "./duble.test-helper";
import { apagarWebhook, ativarWebhook, conferirWebhook, criarSemaforo, cuidarDoWebhook, garantirWebhook, lerConfigDoWebhook, processarEvento, religarWebhook, RETENTAR_ERRO_MS } from "./webhook-asaas";

const CONTA = "conta-1";
const ORIGEM = "https://crm.exemplo.com";
const AGORA = new Date("2026-09-14T12:00:00Z");

function estado(config: Record<string, unknown> = {}, extra: Partial<Record<string, unknown[]>> = {}): EstadoDoDuble {
  return {
    tabelas: {
      accounts: [{ id: CONTA, owner_user_id: "dono-1" }],
      profiles: [
        { user_id: "admin-1", email: "admin@exemplo.com" },
        { user_id: "dono-1", email: "dono@exemplo.com" },
      ],
      // As colunas do webhook NULAS por escrito: a linha do banco as tem como
      // NULL, e o dublê só aplica DEFAULTS em INSERT — sem isto viriam `undefined`.
      cb_asaas_config: [
        {
          account_id: CONTA,
          api_key: encrypt("$aact_prod_x"),
          ambiente: "producao",
          status: "conectado",
          chave_nome: "CRM — produção",
          created_by: "admin-1",
          webhook_token: null,
          webhook_auth_token: null,
          webhook_asaas_id: null,
          webhook_email: null,
          webhook_state: null,
          webhook_erro: null,
          webhook_religado_em: null,
          webhook_conferido_em: null,
          ...config,
        },
      ],
      cb_asaas_clientes: [],
      cb_asaas_cobrancas: [],
      cb_asaas_eventos: [],
      ...extra,
    },
    escritas: [],
  };
}

const webhookDoAsaas = (id: string, extra: Record<string, unknown> = {}) => ({ id, url: `${ORIGEM}/api/cb/asaas/webhook/tok_antigo_0000000000000000`, enabled: true, interrupted: false, penalizedRequestsCount: 0, hasAuthToken: true, ...extra });

function rodar(respostas: RespostasDoAsaas) {
  const registro: PedidosAoAsaas = { pedidos: [], envios: [] };
  return { registro, cliente: dubleDoAsaas(respostas, registro) };
}

describe("garantirWebhook — cria, reaproveita, e grava o token cifrado", () => {
  it("sem webhook nenhum: lista, não acha, CRIA com os eventos assinados e grava tudo", async () => {
    const e = estado();
    const { registro, cliente } = rodar({ listas: { "/webhooks": [] }, recursos: {}, envios: { "POST /webhooks": webhookDoAsaas("wh_novo") } });
    const r = await garantirWebhook(dubleDoSupabase(e), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA);
    expect(r).toEqual({ ok: true, estado: "ativo" });
    const envio = registro.envios![0];
    expect(envio.chave).toBe("POST /webhooks");
    const corpo = envio.corpo as Record<string, unknown>;
    expect(corpo.sendType).toBe("NON_SEQUENTIALLY");
    expect(corpo.apiVersion).toBe(3);
    expect(corpo.email).toBe("admin@exemplo.com");
    expect(String(corpo.url)).toMatch(/^https:\/\/crm\.exemplo\.com\/api\/cb\/asaas\/webhook\/[A-Za-z0-9_-]{32}$/);
    expect(String(corpo.authToken)).toHaveLength(48);
    const config = e.tabelas.cb_asaas_config[0];
    expect(config.webhook_asaas_id).toBe("wh_novo");
    expect(config.webhook_state).toBe("ativo");
    expect(config.webhook_email).toBe("admin@exemplo.com");
    // o token de autenticação vai CIFRADO e é o mesmo que foi ao Asaas
    expect(decrypt(config.webhook_auth_token as string)).toBe(corpo.authToken);
    expect(String(corpo.url).endsWith(`/${config.webhook_token}`)).toBe(true);
  });

  it("com um webhook do Asaas apontando para a MESMA URL (chave trocada, config refeita), REAPROVEITA com PUT — nunca dobra as entregas", async () => {
    const e = estado({ webhook_token: "tok_antigo_0000000000000000" });
    const { registro, cliente } = rodar({
      listas: { "/webhooks": [webhookDoAsaas("wh_outro", { url: "https://outro.sistema/hook" }), webhookDoAsaas("wh_nosso")] },
      recursos: {},
      envios: { "PUT /webhooks/wh_nosso": webhookDoAsaas("wh_nosso") },
    });
    const r = await garantirWebhook(dubleDoSupabase(e), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA);
    expect(r).toEqual({ ok: true, estado: "ativo" });
    expect(registro.envios!.map((x) => x.chave)).toEqual(["PUT /webhooks/wh_nosso"]);
    expect(e.tabelas.cb_asaas_config[0].webhook_asaas_id).toBe("wh_nosso");
  });

  it("com id guardado e o webhook ainda lá, atualiza por PUT (token novo) sem listar", async () => {
    const e = estado({ webhook_token: "tok_antigo_0000000000000000", webhook_asaas_id: "wh_nosso", webhook_state: "desligado" });
    const { registro, cliente } = rodar({ listas: {}, recursos: { "/webhooks/wh_nosso": webhookDoAsaas("wh_nosso", { enabled: false }) }, envios: { "PUT /webhooks/wh_nosso": webhookDoAsaas("wh_nosso") } });
    expect(await garantirWebhook(dubleDoSupabase(e), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: true, estado: "ativo" });
    expect(registro.pedidos).toEqual(["/webhooks/wh_nosso", "PUT /webhooks/wh_nosso"]);
    expect((registro.envios![0].corpo as Record<string, unknown>).enabled).toBe(true);
  });

  it("PUT que volta sem `id` continua sendo o webhook de sempre — relê e nunca cai para o POST (dobraria as entregas)", async () => {
    const e = estado({ webhook_token: "tok_antigo_0000000000000000", webhook_asaas_id: "wh_nosso" });
    const { registro, cliente } = rodar({ listas: {}, recursos: { "/webhooks/wh_nosso": webhookDoAsaas("wh_nosso") }, envios: { "PUT /webhooks/wh_nosso": { object: "webhook" } } });
    expect(await garantirWebhook(dubleDoSupabase(e), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: true, estado: "ativo" });
    expect(registro.pedidos).toEqual(["/webhooks/wh_nosso", "PUT /webhooks/wh_nosso", "/webhooks/wh_nosso"]);
    expect(e.tabelas.cb_asaas_config[0].webhook_asaas_id).toBe("wh_nosso");
  });

  it("a criação passa pelo CADEADO do ciclo: com um ciclo em curso responde em_curso sem falar com o Asaas, e solta o cadeado ao terminar", async () => {
    const ocupado = estado({ sincronizando_desde: new Date(AGORA.getTime() - 30_000).toISOString(), last_sync_attempt_at: new Date(AGORA.getTime() - 30_000).toISOString() });
    const { registro, cliente } = rodar({ listas: { "/webhooks": [] }, recursos: {}, envios: { "POST /webhooks": webhookDoAsaas("wh_novo") } });
    expect(await garantirWebhook(dubleDoSupabase(ocupado), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: false, codigo: "em_curso" });
    expect(registro.pedidos).toEqual([]);
    const livre = estado({ sincronizando_desde: null, last_sync_attempt_at: null });
    expect(await garantirWebhook(dubleDoSupabase(livre), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: true, estado: "ativo" });
    expect(livre.tabelas.cb_asaas_config[0].sincronizando_desde).toBeNull();
  });

  it("o Asaas não registrou o token de autenticação (`hasAuthToken: false`): é falha, estado `erro` — senão toda entrega viraria 401", async () => {
    const e = estado();
    const { cliente } = rodar({ listas: { "/webhooks": [] }, recursos: {}, envios: { "POST /webhooks": webhookDoAsaas("wh_novo", { hasAuthToken: false }) } });
    expect(await garantirWebhook(dubleDoSupabase(e), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: false, codigo: "asaas_error" });
    expect(e.tabelas.cb_asaas_config[0].webhook_state).toBe("erro");
    expect(e.tabelas.cb_asaas_config[0].webhook_asaas_id).toBeNull();
  });

  it("sem a permissão Webhooks: estado `sem_permissao` (o cron para de tentar) e o ciclo de 15 min segue", async () => {
    const e = estado();
    const { cliente } = rodar({ listas: {}, recursos: {}, erro: new AsaasError("sem_permissao", "403") });
    expect(await garantirWebhook(dubleDoSupabase(e), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: false, codigo: "sem_permissao" });
    expect(e.tabelas.cb_asaas_config[0].webhook_state).toBe("sem_permissao");
    expect(e.tabelas.cb_asaas_config[0].webhook_erro).toBe("sem_permissao");
    expect(e.tabelas.cb_asaas_config[0].webhook_asaas_id).toBeNull();
  });

  it("rede ou cota: o estado fica como estava (NULO = o cron tenta de novo), só o erro é anotado — e o token da URL JÁ ficou gravado", async () => {
    const e = estado();
    const { cliente } = rodar({ listas: {}, recursos: {}, erro: new AsaasError("rede", "timeout") });
    expect(await garantirWebhook(dubleDoSupabase(e), CONTA, cliente, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: false, codigo: "rede" });
    expect(e.tabelas.cb_asaas_config[0].webhook_state).toBeNull();
    expect(e.tabelas.cb_asaas_config[0].webhook_erro).toBe("rede");
    // o endereço é determinístico: a próxima tentativa (ou um concorrente) usa a MESMA URL e reencontra o que o Asaas já tem
    const token = e.tabelas.cb_asaas_config[0].webhook_token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const { registro: r2, cliente: c2 } = rodar({ listas: { "/webhooks": [webhookDoAsaas("wh_orfao", { url: `${ORIGEM}/api/cb/asaas/webhook/${token}` })] }, recursos: {}, envios: { "PUT /webhooks/wh_orfao": webhookDoAsaas("wh_orfao") } });
    expect(await garantirWebhook(dubleDoSupabase(e), CONTA, c2, ORIGEM, "admin@exemplo.com", AGORA)).toEqual({ ok: true, estado: "ativo" });
    expect(r2.envios!.map((x) => x.chave)).toEqual(["PUT /webhooks/wh_orfao"]);
    expect(e.tabelas.cb_asaas_config[0].webhook_token).toBe(token);
  });
});

describe("conferirWebhook — o que o cron faz a cada ciclo", () => {
  const config = () => ({ webhook_token: "tok_antigo_0000000000000000", webhook_asaas_id: "wh_nosso", webhook_state: "ativo", webhook_religado_em: null });

  it("apagado no painel (404): `ausente`, id limpo — o cartão oferece recriar; o cron não recria sozinho", async () => {
    const e = estado(config());
    const { cliente } = rodar({ listas: {}, recursos: { "/webhooks/wh_nosso": null } });
    const c = (await lerConfigDoWebhook(dubleDoSupabase(e), CONTA)) as Exclude<Awaited<ReturnType<typeof lerConfigDoWebhook>>, null | "db_error">;
    expect(await conferirWebhook(dubleDoSupabase(e), CONTA, cliente, c, AGORA)).toEqual({ ok: true, estado: "ausente" });
    expect(e.tabelas.cb_asaas_config[0].webhook_asaas_id).toBeNull();
    // e o ciclo seguinte não recria: o estado saiu de NULL
    const { registro: r2, cliente: c2 } = rodar({ listas: {}, recursos: {} });
    expect(await cuidarDoWebhook(dubleDoSupabase(e), CONTA, { origem: ORIGEM, cliente: c2, agora: AGORA })).toEqual({ ok: true, estado: "ausente" });
    expect(r2.pedidos).toEqual([]);
  });

  it("fila interrompida: religa UMA vez e carimba; na segunda vez vira `interrompido` (precisa de atenção)", async () => {
    const e = estado(config());
    const admin = dubleDoSupabase(e);
    const interrompido = webhookDoAsaas("wh_nosso", { interrupted: true });
    const { registro, cliente } = rodar({ listas: {}, recursos: { "/webhooks/wh_nosso": interrompido }, envios: { "PUT /webhooks/wh_nosso": webhookDoAsaas("wh_nosso") } });
    let c = (await lerConfigDoWebhook(admin, CONTA)) as Exclude<Awaited<ReturnType<typeof lerConfigDoWebhook>>, null | "db_error">;
    expect(await conferirWebhook(admin, CONTA, cliente, c, AGORA)).toEqual({ ok: true, estado: "ativo" });
    expect(registro.envios!.map((x) => x.chave)).toEqual(["PUT /webhooks/wh_nosso"]);
    expect(registro.envios![0].corpo).toEqual({ interrupted: false });
    expect(e.tabelas.cb_asaas_config[0].webhook_religado_em).toBe(AGORA.toISOString());

    // interrompida de novo: nada de PUT, estado `interrompido`
    const { registro: r2, cliente: c2 } = rodar({ listas: {}, recursos: { "/webhooks/wh_nosso": interrompido } });
    c = (await lerConfigDoWebhook(admin, CONTA)) as typeof c;
    expect(await conferirWebhook(admin, CONTA, c2, c, AGORA)).toEqual({ ok: true, estado: "interrompido" });
    expect(r2.envios ?? []).toEqual([]);

    // o "Religar" de GENTE religa e zera o marcador — o CRM volta a poder religar uma vez
    const { registro: r3, cliente: c3 } = rodar({ listas: {}, recursos: {}, envios: { "PUT /webhooks/wh_nosso": webhookDoAsaas("wh_nosso") } });
    expect(await religarWebhook(admin, CONTA, { cliente: c3, agora: AGORA })).toEqual({ ok: true, estado: "ativo" });
    expect(r3.envios![0].corpo).toEqual({ interrupted: false, enabled: true });
    expect(e.tabelas.cb_asaas_config[0].webhook_religado_em).toBeNull();
  });

  it("penalizado e desligado no painel são lidos como tal", async () => {
    const e = estado(config());
    const admin = dubleDoSupabase(e);
    const c = (await lerConfigDoWebhook(admin, CONTA)) as Exclude<Awaited<ReturnType<typeof lerConfigDoWebhook>>, null | "db_error">;
    const { cliente } = rodar({ listas: {}, recursos: { "/webhooks/wh_nosso": webhookDoAsaas("wh_nosso", { penalizedRequestsCount: 4 }) } });
    expect(await conferirWebhook(admin, CONTA, cliente, c, AGORA)).toEqual({ ok: true, estado: "penalizado" });
    const { cliente: c2 } = rodar({ listas: {}, recursos: { "/webhooks/wh_nosso": webhookDoAsaas("wh_nosso", { enabled: false }) } });
    expect(await conferirWebhook(admin, CONTA, c2, c, AGORA)).toEqual({ ok: true, estado: "desligado" });
  });

  it("rede na conferência não grava nada — o estado anterior fica", async () => {
    const e = estado(config());
    const admin = dubleDoSupabase(e);
    const c = (await lerConfigDoWebhook(admin, CONTA)) as Exclude<Awaited<ReturnType<typeof lerConfigDoWebhook>>, null | "db_error">;
    const { cliente } = rodar({ listas: {}, recursos: {}, erro: new AsaasError("rede", "timeout") });
    expect(await conferirWebhook(admin, CONTA, cliente, c, AGORA)).toEqual({ ok: false, codigo: "rede" });
    expect(e.tabelas.cb_asaas_config[0].webhook_state).toBe("ativo");
    expect(e.escritas.filter((w) => w.tabela === "cb_asaas_config")).toEqual([]);
  });
});

describe("cuidarDoWebhook — o passo do cron", () => {
  it("estado NULO e endereço público: cria, com o e-mail do administrador que conectou", async () => {
    const e = estado();
    const { registro, cliente } = rodar({ listas: { "/webhooks": [] }, recursos: {}, envios: { "POST /webhooks": webhookDoAsaas("wh_novo") } });
    expect(await cuidarDoWebhook(dubleDoSupabase(e), CONTA, { origem: ORIGEM, cliente, agora: AGORA })).toEqual({ ok: true, estado: "ativo" });
    expect((registro.envios![0].corpo as Record<string, unknown>).email).toBe("admin@exemplo.com");
  });

  it("sem e-mail no perfil de quem conectou, cai no dono da conta", async () => {
    const e = estado({ created_by: "sumido" });
    const { registro, cliente } = rodar({ listas: { "/webhooks": [] }, recursos: {}, envios: { "POST /webhooks": webhookDoAsaas("wh_novo") } });
    await cuidarDoWebhook(dubleDoSupabase(e), CONTA, { origem: ORIGEM, cliente, agora: AGORA });
    expect((registro.envios![0].corpo as Record<string, unknown>).email).toBe("dono@exemplo.com");
  });

  it("sem endereço público não cria e não mexe no estado (o preview, ou env sem URL)", async () => {
    const e = estado();
    const { registro, cliente } = rodar({ listas: {}, recursos: {} });
    expect(await cuidarDoWebhook(dubleDoSupabase(e), CONTA, { origem: null, cliente, agora: AGORA })).toEqual({ ok: false, codigo: "url_inalcancavel" });
    expect(registro.pedidos).toEqual([]);
    expect(e.tabelas.cb_asaas_config[0].webhook_state).toBeNull();
  });

  it("estado `erro` é retentado pelo cron só depois de um dia (R1: a lista de eventos recusada no primeiro ciclo não trava para sempre)", async () => {
    const recente = estado({ webhook_state: "erro", webhook_erro: "asaas_error", webhook_conferido_em: new Date(AGORA.getTime() - 60 * 60_000).toISOString() });
    const { registro, cliente } = rodar({ listas: { "/webhooks": [] }, recursos: {}, envios: { "POST /webhooks": webhookDoAsaas("wh_novo") } });
    expect(await cuidarDoWebhook(dubleDoSupabase(recente), CONTA, { origem: ORIGEM, cliente, agora: AGORA })).toEqual({ ok: true, estado: "erro" });
    expect(registro.pedidos).toEqual([]);
    const velho = estado({ webhook_state: "erro", webhook_erro: "asaas_error", webhook_conferido_em: new Date(AGORA.getTime() - RETENTAR_ERRO_MS - 1000).toISOString() });
    expect(await cuidarDoWebhook(dubleDoSupabase(velho), CONTA, { origem: ORIGEM, cliente, agora: AGORA })).toEqual({ ok: true, estado: "ativo" });
    expect(registro.pedidos).toEqual(["/webhooks", "POST /webhooks"]);
  });

  it("`desligado` por decisão de gente: o cron não recria; o `ativar` do cartão sim", async () => {
    const e = estado({ webhook_state: "desligado", webhook_token: "tok_antigo_0000000000000000" });
    const { registro, cliente } = rodar({ listas: { "/webhooks": [] }, recursos: {}, envios: { "POST /webhooks": webhookDoAsaas("wh_novo") } });
    expect(await cuidarDoWebhook(dubleDoSupabase(e), CONTA, { origem: ORIGEM, cliente, agora: AGORA })).toEqual({ ok: true, estado: "desligado" });
    expect(registro.pedidos).toEqual([]);
    expect(await ativarWebhook(dubleDoSupabase(e), CONTA, { origem: ORIGEM, cliente, agora: AGORA })).toEqual({ ok: true, estado: "ativo" });
    expect(registro.envios!.map((x) => x.chave)).toEqual(["POST /webhooks"]);
  });
});

describe("apagarWebhook", () => {
  it("apaga no Asaas e marca `desligado`; 404 lá conta como apagado", async () => {
    const e = estado({ webhook_asaas_id: "wh_nosso", webhook_state: "ativo" });
    const { registro, cliente } = rodar({ listas: {}, recursos: {}, envios: { "DELETE /webhooks/wh_nosso": new AsaasError("nao_encontrado", "404") } });
    expect(await apagarWebhook(dubleDoSupabase(e), CONTA, { cliente, agora: AGORA })).toEqual({ ok: true, estado: "desligado" });
    expect(registro.pedidos).toEqual(["DELETE /webhooks/wh_nosso"]);
    expect(e.tabelas.cb_asaas_config[0].webhook_asaas_id).toBeNull();
  });

  it("chave inválida: NÃO marca desligado — o cartão manda apagar no painel", async () => {
    const e = estado({ webhook_asaas_id: "wh_nosso", webhook_state: "ativo" });
    const { cliente } = rodar({ listas: {}, recursos: {}, envios: { "DELETE /webhooks/wh_nosso": new AsaasError("chave_invalida", "401") } });
    expect(await apagarWebhook(dubleDoSupabase(e), CONTA, { cliente, agora: AGORA })).toEqual({ ok: false, codigo: "chave_invalida" });
    expect(e.tabelas.cb_asaas_config[0].webhook_asaas_id).toBe("wh_nosso");
    expect(e.tabelas.cb_asaas_config[0].webhook_state).toBe("ativo");
  });
});

describe("processarEvento — a cobrança é RELIDA e aplicada ao espelho", () => {
  const cobranca = (id: string, extra: Record<string, unknown> = {}) => ({ id, customer: "cus_1", status: "OVERDUE", value: 100, dueDate: "2026-09-01", ...extra });
  const evento = (id = "ev-1") => ({ id, account_id: CONTA, asaas_event_id: "evt_1", evento: "PAYMENT_RECEIVED" });

  it("pagou: a linha que o espelho conhece vira RECEIVED (o aviso some) — `aplicada`", async () => {
    const e = estado({}, {
      cb_asaas_clientes: [{ id: "l-1", account_id: CONTA, asaas_customer_id: "cus_1", deleted: false }],
      cb_asaas_cobrancas: [{ id: "c-1", account_id: CONTA, asaas_payment_id: "pay_1", asaas_customer_id: "cus_1", status: "OVERDUE", vencimento: "2026-09-01", visto_em: "2026-09-13T00:00:00Z", vista_vencida_em: "2026-09-02T00:00:00Z" }],
      cb_asaas_eventos: [evento()],
    });
    const { cliente } = rodar({ listas: {}, recursos: { "/payments/pay_1": cobranca("pay_1", { status: "RECEIVED", paymentDate: "2026-09-14" }) } });
    const r = await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "cobranca", eventoId: "evt_1", evento: "PAYMENT_RECEIVED", paymentId: "pay_1", criadoEm: null }, { eventoId: "ev-1", cliente, agora: AGORA });
    expect(r).toBe("aplicada");
    const linha = e.tabelas.cb_asaas_cobrancas[0];
    expect(linha.status).toBe("RECEIVED");
    expect(linha.pago_em).toBe("2026-09-14");
    // `vista_vencida_em` NUNCA é reescrito
    expect(linha.vista_vencida_em).toBe("2026-09-02T00:00:00Z");
    expect(e.tabelas.cb_asaas_eventos[0].resultado).toBe("aplicada");
    expect(e.tabelas.cb_asaas_eventos[0].processado_em).toBeTruthy();
  });

  it("venceu (PAYMENT_OVERDUE) uma cobrança que o espelho não conhecia, de cliente desconhecido: lê o cliente, grava e carimba `vista_vencida_em`", async () => {
    const e = estado({}, { cb_asaas_eventos: [evento()] });
    const { registro, cliente } = rodar({ listas: {}, recursos: { "/payments/pay_2": cobranca("pay_2", { customer: "cus_novo" }), "/customers/cus_novo": { id: "cus_novo", name: "Novo" } } });
    const r = await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "cobranca", eventoId: "evt_1", evento: "PAYMENT_OVERDUE", paymentId: "pay_2", criadoEm: "2026-09-14 00:05:00" }, { eventoId: "ev-1", cliente, agora: AGORA });
    expect(r).toBe("aplicada");
    expect(registro.pedidos).toEqual(["/payments/pay_2", "/customers/cus_novo"]);
    expect(e.tabelas.cb_asaas_clientes.map((c) => c.asaas_customer_id)).toEqual(["cus_novo"]);
    expect(e.tabelas.cb_asaas_cobrancas[0].vista_vencida_em).toBe(AGORA.toISOString());
  });

  it("paga que o espelho NÃO conhece é `ignorada` — o espelho não vira cópia do Asaas", async () => {
    const e = estado({}, { cb_asaas_eventos: [evento()] });
    const { cliente } = rodar({ listas: {}, recursos: { "/payments/pay_3": cobranca("pay_3", { status: "RECEIVED" }) } });
    expect(await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "cobranca", eventoId: "evt_1", evento: "PAYMENT_RECEIVED", paymentId: "pay_3", criadoEm: null }, { eventoId: "ev-1", cliente, agora: AGORA })).toBe("ignorada");
    expect(e.tabelas.cb_asaas_cobrancas).toEqual([]);
  });

  it("404 na cobrança: marca `deleted` se a linha existe E o cliente responde (`apagada`); sem linha `ignorada`; cliente também 404 = chave de outra conta (`falhou`)", async () => {
    const e = estado({}, {
      cb_asaas_clientes: [{ id: "l-1", account_id: CONTA, asaas_customer_id: "cus_1", deleted: false }, { id: "l-2", account_id: CONTA, asaas_customer_id: "cus_2", deleted: false }],
      cb_asaas_cobrancas: [
        { id: "c-1", account_id: CONTA, asaas_payment_id: "pay_1", asaas_customer_id: "cus_1", status: "OVERDUE", vencimento: "2026-09-01", visto_em: "2026-09-13T00:00:00Z", deleted: false },
        { id: "c-2", account_id: CONTA, asaas_payment_id: "pay_2", asaas_customer_id: "cus_2", status: "OVERDUE", vencimento: "2026-09-01", visto_em: "2026-09-13T00:00:00Z", deleted: false },
      ],
      cb_asaas_eventos: [evento("ev-1"), { ...evento("ev-2"), asaas_event_id: "evt_2" }, { ...evento("ev-3"), asaas_event_id: "evt_3" }],
    });
    const { cliente } = rodar({ listas: {}, recursos: { "/payments/pay_1": null, "/customers/cus_1": { id: "cus_1" }, "/payments/pay_x": null, "/payments/pay_2": null, "/customers/cus_2": null } });
    expect(await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "cobranca", eventoId: "evt_1", evento: "PAYMENT_DELETED", paymentId: "pay_1", criadoEm: null }, { eventoId: "ev-1", cliente, agora: AGORA })).toBe("apagada");
    expect(e.tabelas.cb_asaas_cobrancas[0].deleted).toBe(true);
    expect(await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "cobranca", eventoId: "evt_2", evento: "PAYMENT_DELETED", paymentId: "pay_x", criadoEm: null }, { eventoId: "ev-2", cliente, agora: AGORA })).toBe("ignorada");
    expect(await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "cobranca", eventoId: "evt_3", evento: "PAYMENT_DELETED", paymentId: "pay_2", criadoEm: null }, { eventoId: "ev-3", cliente, agora: AGORA })).toBe("falhou");
    expect(e.tabelas.cb_asaas_cobrancas[1].deleted).toBe(false);
    expect(e.tabelas.cb_asaas_eventos[2].detalhe).toBe("conta_trocada");
  });

  it("evento de chave só conta quando o nome é o da NOSSA chave — e aí a conexão vira erro com o código", async () => {
    const e = estado({}, { cb_asaas_eventos: [evento("ev-1"), { ...evento("ev-2"), asaas_event_id: "evt_2" }] });
    const { cliente } = rodar({ listas: {}, recursos: {} });
    expect(await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "chave", eventoId: "evt_1", evento: "ACCESS_TOKEN_DISABLED", nome: "chave do contador", criadoEm: null }, { eventoId: "ev-1", cliente, agora: AGORA })).toBe("ignorada");
    expect(e.tabelas.cb_asaas_config[0].status).toBe("conectado");
    expect(await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "chave", eventoId: "evt_2", evento: "ACCESS_TOKEN_EXPIRED", nome: "CRM — produção", criadoEm: null }, { eventoId: "ev-2", cliente, agora: AGORA })).toBe("chave");
    expect(e.tabelas.cb_asaas_config[0].status).toBe("erro");
    expect(e.tabelas.cb_asaas_config[0].last_error).toBe("chave_expirada");
  });

  it("falha no Asaas (cota) vira `falhou` com o código, sem derrubar nada", async () => {
    const e = estado({}, { cb_asaas_eventos: [evento()] });
    const { cliente } = rodar({ listas: {}, recursos: {}, erro: new AsaasError("limite", "429") });
    expect(await processarEvento(dubleDoSupabase(e), CONTA, { tipo: "cobranca", eventoId: "evt_1", evento: "PAYMENT_RECEIVED", paymentId: "pay_1", criadoEm: null }, { eventoId: "ev-1", cliente, agora: AGORA })).toBe("falhou");
    expect(e.tabelas.cb_asaas_eventos[0].detalhe).toBe("limite");
  });
});

describe("criarSemaforo", () => {
  it("nunca passa de `max` trabalhos ao mesmo tempo, e os demais esperam na ordem", async () => {
    const s = criarSemaforo(2);
    let ativos = 0;
    let pico = 0;
    const ordem: number[] = [];
    const trabalho = (n: number) =>
      s.com(async () => {
        ativos++;
        pico = Math.max(pico, ativos);
        await new Promise((r) => setTimeout(r, 5));
        ordem.push(n);
        ativos--;
        return n;
      });
    const r = await Promise.all([trabalho(1), trabalho(2), trabalho(3), trabalho(4)]);
    expect(r).toEqual([1, 2, 3, 4]);
    expect(pico).toBe(2);
    expect(ordem).toEqual([1, 2, 3, 4]);
  });

  it("um chamador NOVO chegando no instante em que um trabalho termina não fura a fila: quem espera herda a vaga", async () => {
    const s = criarSemaforo(1);
    let ativos = 0;
    let pico = 0;
    const ordem: string[] = [];
    let liberarA: () => void = () => {};
    const a = s.com(async () => {
      ativos++;
      pico = Math.max(pico, ativos);
      await new Promise<void>((r) => (liberarA = r));
      ordem.push("a");
      ativos--;
    });
    const b = s.com(async () => {
      ativos++;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 5));
      ordem.push("b");
      ativos--;
    });
    // "a" termina; no MESMO tique um chamador novo ("c") tenta entrar
    liberarA();
    await Promise.resolve();
    const c = s.com(async () => {
      ativos++;
      pico = Math.max(pico, ativos);
      ordem.push("c");
      ativos--;
    });
    await Promise.all([a, b, c]);
    expect(pico).toBe(1);
    expect(ordem).toEqual(["a", "b", "c"]);
  });
});
