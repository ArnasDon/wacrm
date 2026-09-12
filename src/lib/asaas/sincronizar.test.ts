import { describe, expect, it } from "vitest";

import { encrypt } from "@/lib/whatsapp/encryption";

import { AsaasError } from "./cliente";
import { dubleDoAsaas, dubleDoSupabase, type EstadoDoDuble, type PedidosAoAsaas, type RespostasDoAsaas } from "./duble.test-helper";
import { FICHAS_POR_CICLO, listagemDiariaDevida, listagemSuspeita, RECOLHER_CICLO_MS, sincronizarAsaas } from "./sincronizar";

const CONTA = "conta-1";
const DONO = "dono-1";
const AGORA = new Date("2026-09-14T12:00:00Z"); // segunda, 09:00 em São Paulo

function estadoInicial(extra: Partial<Record<string, unknown[]>> = {}, config: Record<string, unknown> = {}): EstadoDoDuble {
  return {
    tabelas: {
      accounts: [{ id: CONTA, owner_user_id: DONO }],
      cb_asaas_config: [
        {
          account_id: CONTA,
          api_key: encrypt("$aact_prod_chave_de_teste_0000"),
          ambiente: "producao",
          status: "conectado",
          last_sync_at: null,
          last_sync_attempt_at: null,
          vencidas_listadas_em: null,
          last_full_sync_at: null,
          last_error: null,
          ...config,
        },
      ],
      cb_channels: [{ account_id: CONTA, display_phone: "+55 83 3000-0000" }],
      contacts: [],
      cb_asaas_clientes: [],
      cb_asaas_cobrancas: [],
      cb_calendly_eventos: [],
      tags: [],
      contact_tags: [],
      ...extra,
    },
    escritas: [],
  };
}

/** Documento DIFERENTE por cliente: o mesmo documento em dois clientes é o "cadastro duplicado", que liga pelo CPF. */
const clienteAsaas = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: nome,
  cpfCnpj: String(id.charCodeAt(id.length - 1)).padStart(11, "9"),
  ...extra,
});
const cobranca = (id: string, customer: string, extra: Record<string, unknown> = {}) => ({
  id,
  customer,
  status: "OVERDUE",
  value: 100,
  dueDate: "2026-09-01",
  billingType: "BOLETO",
  installment: null,
  installmentNumber: null,
  ...extra,
});

const LISTA_VENCIDAS = "/payments?status=OVERDUE%2CDUNNING_REQUESTED";
const LISTA_VENCE_HOJE = "/payments?status=PENDING&dueDate%5Bge%5D=2026-09-14&dueDate%5Ble%5D=2026-09-14";

function rodar(estado: EstadoDoDuble, respostas: RespostasDoAsaas, opcoes: Parameters<typeof sincronizarAsaas>[2] = {}) {
  const registro: PedidosAoAsaas = { pedidos: [] };
  const admin = dubleDoSupabase(estado);
  return {
    registro,
    resultado: sincronizarAsaas(admin, CONTA, { agora: AGORA, cliente: () => dubleDoAsaas(respostas, registro), ...opcoes }),
  };
}

describe("listagemDiariaDevida", () => {
  it("devida sem listagem anterior, e depois das 03:00 de um dia novo", () => {
    expect(listagemDiariaDevida(null, AGORA, "America/Sao_Paulo")).toBe(true);
    expect(listagemDiariaDevida("2026-09-13T20:00:00Z", AGORA, "America/Sao_Paulo")).toBe(true);
    expect(listagemDiariaDevida("2026-09-14T10:00:00Z", AGORA, "America/Sao_Paulo")).toBe(false);
    // dia novo, mas ainda 01:00 em São Paulo: espera as 03:00
    expect(listagemDiariaDevida("2026-09-13T20:00:00Z", new Date("2026-09-14T04:00:00Z"), "America/Sao_Paulo")).toBe(false);
  });
});

describe("sincronizarAsaas — o primeiro ciclo", () => {
  const respostas: RespostasDoAsaas = {
    listas: {
      "/customers": [
        clienteAsaas("cus_A", "Maria Silva", { mobilePhone: "83988745316" }),
        clienteAsaas("cus_B", "João Pedro Souza", { mobilePhone: "84999990000", email: "joao@x.com" }),
        clienteAsaas("cus_C", "Carlos Sem Telefone", {}),
        clienteAsaas("cus_D", "Escritório Mesmo", { mobilePhone: "8330000000" }),
      ],
      [LISTA_VENCIDAS]: [cobranca("pay_A1", "cus_A"), cobranca("pay_B1", "cus_B", { installment: "ins_1", installmentNumber: "3" })],
      [LISTA_VENCE_HOJE]: [cobranca("pay_C1", "cus_C", { status: "PENDING", dueDate: "2026-09-14" })],
    },
    recursos: { "/installments/ins_1": { installmentCount: 12 } },
  };

  it("lista clientes, grava as vencidas e a que vence hoje, liga pelo telefone, cria a ficha (D2) e deixa quem não tem telefone para gente", async () => {
    const estado = estadoInicial({ contacts: [{ id: "c-maria", account_id: CONTA, user_id: DONO, name: "Maria Silva", phone: "5583988745316", email: null }] });
    const { resultado, registro } = rodar(estado, respostas);
    const r = await resultado;
    expect(r).toMatchObject({ ok: true, clientesListados: 4, cobrancasGravadas: 3, ligados: 1, fichasCriadas: 1 });

    // as duas listagens de cobrança pedidas com os filtros certos (C3 e D17)
    expect(registro.pedidos).toContain(LISTA_VENCIDAS);
    expect(registro.pedidos).toContain(LISTA_VENCE_HOJE);

    const clientes = estado.tabelas.cb_asaas_clientes;
    const porId = new Map(clientes.map((c) => [c.asaas_customer_id, c]));
    expect(porId.get("cus_A")).toMatchObject({ contact_id: "c-maria", vinculo_origem: "telefone", celular: "5583988745316" });
    // B: ficha nova, com o dono da conta, o 55 na frente e a etiqueta
    const b = porId.get("cus_B")!;
    expect(b.vinculo_origem).toBe("criada");
    const fichaB = estado.tabelas.contacts.find((c) => c.id === b.contact_id)!;
    expect(fichaB).toMatchObject({ user_id: DONO, phone: "5584999990000", name: "João Pedro Souza" });
    expect(estado.tabelas.tags.map((t) => t.name)).toEqual(["asaas"]);
    expect(estado.tabelas.contact_tags).toHaveLength(1);
    // C: sem telefone, sem ficha, nada criado
    expect(porId.get("cus_C")).toMatchObject({ contact_id: null, vinculo_origem: null });
    // D: o telefone é o da própria conexão da conta — nada de ficha
    expect(porId.get("cus_D")).toMatchObject({ contact_id: null, vinculo_origem: null });
    expect(estado.tabelas.contacts).toHaveLength(2);

    // cobranças: as duas vencidas carimbadas; a de hoje sem carimbo
    const cobrancas = new Map(estado.tabelas.cb_asaas_cobrancas.map((c) => [c.asaas_payment_id, c]));
    expect(cobrancas.get("pay_A1")!.vista_vencida_em).toBe(AGORA.toISOString());
    expect(cobrancas.get("pay_C1")!.vista_vencida_em).toBeNull();
    expect(cobrancas.get("pay_C1")).toMatchObject({ status: "PENDING", vencimento: "2026-09-14" });
    // o total do parcelamento veio na mesma passada
    expect(cobrancas.get("pay_B1")).toMatchObject({ parcela_numero: 3, parcela_total: 12 });

    const config = estado.tabelas.cb_asaas_config[0];
    expect(config).toMatchObject({ status: "conectado", last_error: null, last_sync_at: AGORA.toISOString(), vencidas_listadas_em: AGORA.toISOString(), last_full_sync_at: AGORA.toISOString() });
    // a TENTATIVA é o batimento do cadeado: carimbada no claim (= agora) e
    // avançada com o relógio real a cada passo — por isso não é `AGORA`
    expect(typeof config.last_sync_attempt_at).toBe("string");
    expect(config.sincronizando_desde).toBeNull();
  });

  it("o teto de fichas por ciclo adia o que não coube", async () => {
    const estado = estadoInicial();
    const r = await rodar(estado, respostas, { tetoDeFichas: 0 }).resultado;
    // A e B têm telefone e nenhuma ficha: as duas criações ficam para o ciclo seguinte
    expect(r).toMatchObject({ ok: true, fichasCriadas: 0, adiadas: 2 });
    expect(estado.tabelas.contacts).toHaveLength(0);
    expect(FICHAS_POR_CICLO).toBeGreaterThan(0);
  });
});

describe("sincronizarAsaas — os ciclos seguintes", () => {
  it("no mesmo dia não relista clientes; a vencida que sumiu é relida (paga) e a ficha criada não é recriada", async () => {
    const estado = estadoInicial(
      {
        contacts: [{ id: "c-joao", account_id: CONTA, user_id: DONO, name: "João", phone: "5584999990000", email: null }],
        cb_asaas_clientes: [
          { id: "l-b", account_id: CONTA, asaas_customer_id: "cus_B", nome: "João Pedro Souza", cpf_cnpj: "1", celular: "5584999990000", contact_id: "c-joao", vinculo_origem: "criada", contatos_recusados: [], candidatos: [], deleted: false, visto_em: "2026-09-14T06:00:00Z" },
        ],
        cb_asaas_cobrancas: [
          { id: "p-b1", account_id: CONTA, asaas_payment_id: "pay_B1", asaas_customer_id: "cus_B", status: "OVERDUE", deleted: false, valor: 100, vencimento: "2026-09-01", vista_vencida_em: "2026-09-02T12:00:00Z", visto_em: "2026-09-14T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z", last_sync_at: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = {
      listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] },
      recursos: { "/customers/cus_B": clienteAsaas("cus_B", "João Pedro Souza"), "/payments/pay_B1": cobranca("pay_B1", "cus_B", { status: "RECEIVED", paymentDate: "2026-09-13" }) },
    };
    const { resultado, registro } = rodar(estado, respostas);
    const r = await resultado;
    expect(r).toMatchObject({ ok: true, clientesListados: 0, reconciliadas: 1, fichasCriadas: 0, ligados: 0 });
    expect(registro.pedidos).not.toContain("/customers");
    expect(registro.pedidos).toContain("/payments/pay_B1");
    const p = estado.tabelas.cb_asaas_cobrancas[0];
    // o estado novo entrou; a PRIMEIRA vez que foi vista vencida NÃO foi reescrita
    expect(p).toMatchObject({ status: "RECEIVED", pago_em: "2026-09-13", vista_vencida_em: "2026-09-02T12:00:00Z", visto_em: AGORA.toISOString() });
    expect(estado.tabelas.contacts).toHaveLength(1);
  });

  it("cobrança que o Asaas não devolve mais vira apagada — quando o cliente ainda responde", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: [{ id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", nome: "Maria", contatos_recusados: [], candidatos: [], deleted: false, vinculo_origem: "desvinculado", contact_id: null }],
        cb_asaas_cobrancas: [{ id: "p-a1", account_id: CONTA, asaas_payment_id: "pay_A1", asaas_customer_id: "cus_A", status: "OVERDUE", deleted: false, valor: 100, vencimento: "2026-09-01", visto_em: "2026-09-14T06:00:00Z" }],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: { "/customers/cus_A": clienteAsaas("cus_A", "Maria") } };
    const r = await rodar(estado, respostas).resultado;
    expect(r).toMatchObject({ ok: true, reconciliadas: 1 });
    expect(estado.tabelas.cb_asaas_cobrancas[0].deleted).toBe(true);
  });

  it("a chave de OUTRA conta é detectada antes de gravar qualquer coisa (conta_trocada)", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: [{ id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", nome: "Maria", contatos_recusados: [], candidatos: [], deleted: false, vinculo_origem: null, contact_id: null, visto_em: "2026-09-14T06:00:00Z" }],
        cb_asaas_cobrancas: [{ id: "p-a1", account_id: CONTA, asaas_payment_id: "pay_A1", asaas_customer_id: "cus_A", status: "OVERDUE", deleted: false, valor: 100, vencimento: "2026-09-01", visto_em: "2026-09-14T06:00:00Z" }],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [cobranca("pay_X", "cus_X")] }, recursos: {} };
    const r = await rodar(estado, respostas).resultado;
    expect(r).toEqual({ ok: false, codigo: "conta_trocada" });
    expect(estado.tabelas.cb_asaas_config[0]).toMatchObject({ status: "erro", last_error: "conta_trocada" });
    // nada do espelho foi tocado
    expect(estado.tabelas.cb_asaas_cobrancas).toHaveLength(1);
    expect(estado.tabelas.cb_asaas_cobrancas[0].deleted).toBe(false);
    expect(estado.escritas.filter((e) => e.tabela !== "cb_asaas_config")).toHaveLength(0);
  });

  it("429 encerra o ciclo com `limite`, sem retentar", async () => {
    const estado = estadoInicial();
    const respostas: RespostasDoAsaas = { listas: {}, recursos: {}, erro: new AsaasError("limite", "429") };
    const { resultado, registro } = rodar(estado, respostas);
    expect(await resultado).toEqual({ ok: false, codigo: "limite" });
    expect(estado.tabelas.cb_asaas_config[0]).toMatchObject({ status: "erro", last_error: "limite" });
    expect(registro.pedidos).toHaveLength(1);
  });

  it("contato DESLIGADO por gente não volta: nem pela regra, nem pela criação (o número é o mesmo)", async () => {
    const estado = estadoInicial(
      {
        contacts: [{ id: "c-maria", account_id: CONTA, user_id: DONO, name: "Maria Silva", phone: "5583988745316", email: null }],
        cb_asaas_clientes: [
          { id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", nome: "Maria Silva", cpf_cnpj: "1", celular: "5583988745316", contact_id: null, vinculo_origem: null, contatos_recusados: ["c-maria"], candidatos: [], deleted: false, visto_em: "2026-09-14T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: { "/customers/cus_A": clienteAsaas("cus_A", "Maria Silva") } };
    const r = await rodar(estado, respostas).resultado;
    expect(r).toMatchObject({ ok: true, ligados: 0, fichasCriadas: 0 });
    expect(estado.tabelas.cb_asaas_clientes[0]).toMatchObject({ contact_id: null, candidatos: [] });
    expect(estado.tabelas.contacts).toHaveLength(1);
  });

  it("vínculo feito à mão no meio do ciclo vence a regra (o UPDATE é cercado)", async () => {
    const estado = estadoInicial(
      {
        contacts: [{ id: "c-maria", account_id: CONTA, user_id: DONO, name: "Maria Silva", phone: "5583988745316", email: null }],
        cb_asaas_clientes: [
          { id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", nome: "Maria Silva", cpf_cnpj: "1", celular: "5583988745316", contact_id: null, vinculo_origem: "manual", contatos_recusados: [], candidatos: [], deleted: false, visto_em: "2026-09-14T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: { "/customers/cus_A": clienteAsaas("cus_A", "Maria Silva") } };
    const r = await rodar(estado, respostas).resultado;
    // origem `manual` (órfã) não é elegível: a regra não toca
    expect(r).toMatchObject({ ok: true, ligados: 0 });
    expect(estado.tabelas.cb_asaas_clientes[0]).toMatchObject({ contact_id: null, vinculo_origem: "manual" });
  });

  it("vínculo manual feito entre a foto do ciclo e a criação: a ficha NÃO nasce (reconferência)", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: [
          { id: "l-b", account_id: CONTA, asaas_customer_id: "cus_B", nome: "João Pedro Souza", cpf_cnpj: "1", celular: "5584999990000", contact_id: null, vinculo_origem: null, contatos_recusados: [], candidatos: [], deleted: false, visto_em: "2026-09-14T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: { "/customers/cus_B": clienteAsaas("cus_B", "João Pedro Souza") } };
    const admin = dubleDoSupabase(estado);
    // O administrador ignora o cliente DEPOIS de o ciclo ler a lista: o dublê
    // muda a linha na primeira leitura de `contacts` (a busca da criação).
    const original = admin.from.bind(admin);
    let lidas = 0;
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "contacts" && ++lidas === 1) estado.tabelas.cb_asaas_clientes[0].vinculo_origem = "desvinculado";
      return original(t);
    };
    const r = await sincronizarAsaas(admin, CONTA, { agora: AGORA, cliente: () => dubleDoAsaas(respostas) });
    expect(r).toMatchObject({ ok: true, fichasCriadas: 0 });
    expect(estado.tabelas.contacts).toHaveLength(0);
    expect(estado.tabelas.cb_asaas_clientes[0]).toMatchObject({ contact_id: null, vinculo_origem: "desvinculado" });
  });

  it("com ninguém elegível, a etiqueta PENDENTE de uma ficha criada ainda é refeita", async () => {
    const estado = estadoInicial(
      {
        contacts: [{ id: "c-joao", account_id: CONTA, user_id: DONO, name: "João", phone: "5584999990000", email: null }],
        cb_asaas_clientes: [
          { id: "l-b", account_id: CONTA, asaas_customer_id: "cus_B", nome: "João Pedro Souza", cpf_cnpj: "1", celular: "5584999990000", contact_id: "c-joao", vinculo_origem: "criada", contatos_recusados: [], candidatos: [], deleted: false, visto_em: "2026-09-14T06:00:00Z", etiqueta_pendente: true },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: { "/customers/cus_B": clienteAsaas("cus_B", "João Pedro Souza") } };
    const r = await rodar(estado, respostas).resultado;
    expect(r).toMatchObject({ ok: true, ligados: 0, fichasCriadas: 0 });
    expect(estado.tabelas.tags.map((t) => t.name)).toEqual(["asaas"]);
    expect(estado.tabelas.contact_tags).toEqual([expect.objectContaining({ contact_id: "c-joao" })]);
    expect(estado.tabelas.cb_asaas_clientes[0].etiqueta_pendente).toBe(false);
  });

  it("ficha criada que perde a corrida para gente FICA — nunca é apagada pelo ciclo", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: [
          { id: "l-b", account_id: CONTA, asaas_customer_id: "cus_B", nome: "João Pedro Souza", cpf_cnpj: "1", celular: "5584999990000", contact_id: null, vinculo_origem: null, contatos_recusados: [], candidatos: [], deleted: false, visto_em: "2026-09-14T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: { "/customers/cus_B": clienteAsaas("cus_B", "João Pedro Souza") } };
    const admin = dubleDoSupabase(estado);
    // O administrador ignora o cliente DEPOIS da reconferência: o dublê muda a
    // linha na primeira escrita em `contacts` (o insert da ficha).
    const original = admin.from.bind(admin);
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as Record<string, unknown> & { insert: (...a: unknown[]) => unknown };
      if (t === "contacts") {
        const insert = q.insert;
        q.insert = (...a: unknown[]) => {
          estado.tabelas.cb_asaas_clientes[0].vinculo_origem = "desvinculado";
          return insert.apply(q, a);
        };
      }
      return q;
    };
    const r = await sincronizarAsaas(admin, CONTA, { agora: AGORA, cliente: () => dubleDoAsaas(respostas) });
    expect(r).toMatchObject({ ok: true, fichasCriadas: 0, ligados: 0 });
    // a ficha existe, com a etiqueta, e nada foi apagado
    expect(estado.tabelas.contacts).toHaveLength(1);
    expect(estado.escritas.filter((w) => w.tabela === "contacts" && w.op === "delete")).toHaveLength(0);
    expect(estado.tabelas.cb_asaas_clientes[0]).toMatchObject({ contact_id: null, vinculo_origem: "desvinculado" });
  });

  it("ficha órfã cuja etiqueta falhou na criação ganha uma segunda tentativa antes de perder a associação", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: [
          { id: "l-b", account_id: CONTA, asaas_customer_id: "cus_B", nome: "João Pedro Souza", cpf_cnpj: "1", celular: "5584999990000", contact_id: null, vinculo_origem: null, contatos_recusados: [], candidatos: [], deleted: false, visto_em: "2026-09-14T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = { listas: { [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: { "/customers/cus_B": clienteAsaas("cus_B", "João Pedro Souza") } };
    const admin = dubleDoSupabase(estado);
    const original = admin.from.bind(admin);
    let upsertsDeEtiqueta = 0;
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as Record<string, unknown> & { insert: (...a: unknown[]) => unknown; upsert: (...a: unknown[]) => unknown };
      if (t === "contacts") {
        // o administrador ignora o cliente no instante do insert da ficha
        const insert = q.insert;
        q.insert = (...a: unknown[]) => {
          estado.tabelas.cb_asaas_clientes[0].vinculo_origem = "desvinculado";
          return insert.apply(q, a);
        };
      }
      if (t === "contact_tags") {
        // o PRIMEIRO upsert da etiqueta falha (o Supabase devolve `{ error }`); o segundo passa
        const upsert = q.upsert;
        q.upsert = (...a: unknown[]) => {
          if (++upsertsDeEtiqueta === 1) return { then: (r: (x: unknown) => unknown) => r({ data: null, error: { message: "boom" } }) };
          return upsert.apply(q, a);
        };
      }
      return q;
    };
    const r = await sincronizarAsaas(admin, CONTA, { agora: AGORA, cliente: () => dubleDoAsaas(respostas) });
    expect(r).toMatchObject({ ok: true, fichasCriadas: 0 });
    expect(estado.tabelas.contacts).toHaveLength(1);
    expect(upsertsDeEtiqueta).toBe(2);
    expect(estado.tabelas.contact_tags).toEqual([expect.objectContaining({ contact_id: estado.tabelas.contacts[0].id })]);
  });

  it("o CADEADO: com um ciclo em curso, o segundo volta `em_curso` sem tocar em nada; recolhido depois de 10 min", async () => {
    const respostas: RespostasDoAsaas = { listas: { "/customers": [], [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: {} };
    const emCurso = estadoInicial({}, { sincronizando_desde: new Date(Date.now() - 60_000).toISOString(), last_sync_attempt_at: new Date(Date.now() - 60_000).toISOString() });
    const { resultado, registro } = rodar(emCurso, respostas);
    expect(await resultado).toEqual({ ok: false, codigo: "em_curso" });
    expect(registro.pedidos).toHaveLength(0);
    expect(emCurso.tabelas.cb_asaas_config[0].status).toBe("conectado");
    // cadeado de processo MORTO (sem batimento há mais de 10 min) é recolhido —
    // mesmo que o ciclo tenha começado há muito mais tempo, o que conta é o batimento
    const morto = estadoInicial({}, { sincronizando_desde: new Date(Date.now() - 3 * RECOLHER_CICLO_MS).toISOString(), last_sync_attempt_at: new Date(Date.now() - RECOLHER_CICLO_MS - 1000).toISOString() });
    const r = await rodar(morto, respostas).resultado;
    expect(r).toMatchObject({ ok: true });
    expect(morto.tabelas.cb_asaas_config[0].sincronizando_desde).toBeNull();
  });

  it("ciclo VIVO e demorado não é recolhido: o batimento mantém o cadeado (começou há 30 min, bateu há 1)", async () => {
    const vivo = estadoInicial({}, { sincronizando_desde: new Date(Date.now() - 3 * RECOLHER_CICLO_MS).toISOString(), last_sync_attempt_at: new Date(Date.now() - 60_000).toISOString() });
    const respostas: RespostasDoAsaas = { listas: { "/customers": [], [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: {} };
    expect(await rodar(vivo, respostas).resultado).toEqual({ ok: false, codigo: "em_curso" });
  });

  it("o ciclo BATE o cadeado enquanto trabalha (last_sync_attempt_at avança depois do claim)", async () => {
    const estado = estadoInicial();
    const respostas: RespostasDoAsaas = { listas: { "/customers": [clienteAsaas("cus_A", "A")], [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: {} };
    await rodar(estado, respostas).resultado;
    const batidas = estado.escritas.filter((w) => w.tabela === "cb_asaas_config" && w.op === "update" && (w.payload as Record<string, unknown>).last_sync_attempt_at !== undefined);
    // o claim e pelo menos dois batimentos (depois dos clientes e depois das cobranças)
    expect(batidas.length).toBeGreaterThanOrEqual(3);
  });

  it("listagemSuspeita: vazia é sempre suspeita; parcial só acima de 20% E de 5", () => {
    expect(listagemSuspeita(0, 439, 439)).toBe(true);
    expect(listagemSuspeita(0, 3, 3)).toBe(true);
    expect(listagemSuspeita(0, 0, 0)).toBe(false); // primeira listagem de uma conta vazia
    expect(listagemSuspeita(433, 439, 6)).toBe(false); // 6 apagados de 439: churn normal
    expect(listagemSuspeita(300, 439, 139)).toBe(true); // um terço sumiu: veio pela metade
    expect(listagemSuspeita(7, 10, 3)).toBe(false); // conta pequena: 3 de 10 não passa do piso absoluto
    expect(listagemSuspeita(4, 10, 6)).toBe(true);
  });

  it("o cadeado é solto no erro também", async () => {
    const estado = estadoInicial();
    const respostas: RespostasDoAsaas = { listas: {}, recursos: {}, erro: new AsaasError("limite", "429") };
    await rodar(estado, respostas).resultado;
    expect(estado.tabelas.cb_asaas_config[0]).toMatchObject({ status: "erro", last_error: "limite", sincronizando_desde: null });
  });

  it("listagem de clientes VAZIA (ou curta) não marca ninguém como apagado nem carimba a listagem diária", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: Array.from({ length: 10 }, (_, i) => ({ id: `l-${i}`, account_id: CONTA, asaas_customer_id: `cus_${i}`, nome: `Cliente ${i}`, contatos_recusados: [], candidatos: [], deleted: false, vinculo_origem: "desvinculado", contact_id: null, visto_em: "2026-09-13T06:00:00Z" })),
      },
      { last_full_sync_at: "2026-09-13T06:00:00Z", vencidas_listadas_em: "2026-09-13T06:00:00Z" },
    );
    const respostas: RespostasDoAsaas = {
      listas: { "/customers": [], [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] },
      recursos: { "/customers/cus_0": clienteAsaas("cus_0", "Cliente 0") },
    };
    const r = await rodar(estado, respostas).resultado;
    expect(r).toMatchObject({ ok: true, clientesListados: 0 });
    expect(estado.tabelas.cb_asaas_clientes.filter((c) => c.deleted)).toHaveLength(0);
    expect(estado.tabelas.cb_asaas_config[0].last_full_sync_at).toBe("2026-09-13T06:00:00Z");
    // uma sumida entre dez é aceitável: só ela vira apagada
    const respostas2: RespostasDoAsaas = {
      listas: { "/customers": Array.from({ length: 9 }, (_, i) => clienteAsaas(`cus_${i}`, `Cliente ${i}`)), [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] },
      recursos: { "/customers/cus_0": clienteAsaas("cus_0", "Cliente 0") },
    };
    const estado2 = estadoInicial(
      {
        cb_asaas_clientes: Array.from({ length: 10 }, (_, i) => ({ id: `l-${i}`, account_id: CONTA, asaas_customer_id: `cus_${i}`, nome: `Cliente ${i}`, contatos_recusados: [], candidatos: [], deleted: false, vinculo_origem: "desvinculado", contact_id: null, visto_em: "2026-09-13T06:00:00Z" })),
      },
      { last_full_sync_at: "2026-09-13T06:00:00Z", vencidas_listadas_em: "2026-09-13T06:00:00Z" },
    );
    await rodar(estado2, respostas2).resultado;
    expect(estado2.tabelas.cb_asaas_clientes.filter((c) => c.deleted).map((c) => c.asaas_customer_id)).toEqual(["cus_9"]);
    expect(estado2.tabelas.cb_asaas_config[0].last_full_sync_at).toBe(AGORA.toISOString());
  });

  it("a prova de identidade usa os clientes mais recentes e, se todos derem 404, a listagem da chave", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: [
          { id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", nome: "A", contatos_recusados: [], candidatos: [], deleted: false, vinculo_origem: "desvinculado", contact_id: null, visto_em: "2026-09-13T06:00:00Z" },
          { id: "l-b", account_id: CONTA, asaas_customer_id: "cus_B", nome: "B", contatos_recusados: [], candidatos: [], deleted: false, vinculo_origem: "desvinculado", contact_id: null, visto_em: "2026-09-12T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    // os dois clientes apagados no Asaas (404), mas a listagem da chave traz cus_A: é a mesma conta
    const respostas: RespostasDoAsaas = { listas: { "/customers": [clienteAsaas("cus_A", "A")], [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] }, recursos: {} };
    const { resultado, registro } = rodar(estado, respostas);
    expect(await resultado).toMatchObject({ ok: true });
    expect(registro.pedidos.slice(0, 3)).toEqual(["/customers/cus_A", "/customers/cus_B", "/customers"]);
    // e a mesma situação com uma listagem de OUTRA conta é conta_trocada
    const estado2 = estadoInicial({ cb_asaas_clientes: [...estado.tabelas.cb_asaas_clientes] }, { last_full_sync_at: "2026-09-14T06:00:00Z" });
    const r2 = await rodar(estado2, { listas: { "/customers": [clienteAsaas("cus_X", "X")] }, recursos: {} }).resultado;
    expect(r2).toEqual({ ok: false, codigo: "conta_trocada" });
  });

  it("sem a permissão Parcelamentos, o passo dos totais para no PRIMEIRO 403; parcelamento sem total (404) ganha a sentinela 0", async () => {
    const estado = estadoInicial(
      {
        cb_asaas_clientes: [{ id: "l-a", account_id: CONTA, asaas_customer_id: "cus_A", nome: "A", contatos_recusados: [], candidatos: [], deleted: false, vinculo_origem: "desvinculado", contact_id: null, visto_em: "2026-09-14T06:00:00Z" }],
        cb_asaas_cobrancas: [
          { id: "p1", account_id: CONTA, asaas_payment_id: "pay_1", asaas_customer_id: "cus_A", status: "OVERDUE", deleted: false, valor: 1, vencimento: "2026-09-01", parcelamento_id: "ins_1", parcela_numero: 1, parcela_total: null, visto_em: "2026-09-14T06:00:00Z" },
          { id: "p2", account_id: CONTA, asaas_payment_id: "pay_2", asaas_customer_id: "cus_A", status: "OVERDUE", deleted: false, valor: 1, vencimento: "2026-09-01", parcelamento_id: "ins_2", parcela_numero: 1, parcela_total: null, visto_em: "2026-09-14T06:00:00Z" },
        ],
      },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const base: RespostasDoAsaas = {
      listas: { [LISTA_VENCIDAS]: [cobranca("pay_1", "cus_A", { installment: "ins_1", installmentNumber: 1 }), cobranca("pay_2", "cus_A", { installment: "ins_2", installmentNumber: 1 })], [LISTA_VENCE_HOJE]: [] },
      recursos: { "/customers/cus_A": clienteAsaas("cus_A", "A") },
    };
    // 404 no primeiro parcelamento → sentinela; o segundo traz o total
    const r = await rodar(estado, { ...base, recursos: { ...base.recursos, "/installments/ins_2": { installmentCount: 6 } } }).resultado;
    expect(r).toMatchObject({ ok: true });
    const totais = Object.fromEntries(estado.tabelas.cb_asaas_cobrancas.map((c) => [c.asaas_payment_id, c.parcela_total]));
    expect(totais).toEqual({ pay_1: 0, pay_2: 6 });
    // 403 → um pedido só, e o ciclo segue ok
    const estado2 = estadoInicial(
      { cb_asaas_clientes: [...estado.tabelas.cb_asaas_clientes], cb_asaas_cobrancas: estado.tabelas.cb_asaas_cobrancas.map((c) => ({ ...c, parcela_total: null })) },
      { last_full_sync_at: "2026-09-14T06:00:00Z", vencidas_listadas_em: "2026-09-14T06:00:00Z" },
    );
    const registro: PedidosAoAsaas = { pedidos: [] };
    const asaas = dubleDoAsaas(base, registro);
    const obter = asaas.obter.bind(asaas);
    asaas.obter = async (caminho: string) => {
      if (caminho.startsWith("/installments/")) {
        registro.pedidos.push(caminho);
        throw new AsaasError("sem_permissao", "403", "insufficient_permission", 403);
      }
      return obter(caminho);
    };
    const r2 = await sincronizarAsaas(dubleDoSupabase(estado2), CONTA, { agora: AGORA, cliente: () => asaas });
    expect(r2).toMatchObject({ ok: true });
    expect(registro.pedidos.filter((p) => p.startsWith("/installments/"))).toHaveLength(1);
    expect(estado2.tabelas.cb_asaas_cobrancas.every((c) => c.parcela_total === null)).toBe(true);
  });

  it("a etiqueta que falha na criação vira `etiqueta_pendente` e é refeita no ciclo seguinte — só ela", async () => {
    const estado = estadoInicial({
      contacts: [{ id: "c-tirou", account_id: CONTA, user_id: DONO, name: "Tirou", phone: "5584999990009", email: null }],
      cb_asaas_clientes: [
        // ficha criada antes cuja etiqueta a PESSOA tirou: não é pendência, não volta
        { id: "l-t", account_id: CONTA, asaas_customer_id: "cus_T", nome: "Tirou", cpf_cnpj: "9", celular: "5584999990009", contact_id: "c-tirou", vinculo_origem: "criada", contatos_recusados: [], candidatos: [], deleted: false, visto_em: "2026-09-13T06:00:00Z", etiqueta_pendente: false },
      ],
    });
    const respostas: RespostasDoAsaas = {
      listas: { "/customers": [clienteAsaas("cus_T", "Tirou", { mobilePhone: "84999990009" }), clienteAsaas("cus_N", "Novo Cliente", { mobilePhone: "84999990010" })], [LISTA_VENCIDAS]: [], [LISTA_VENCE_HOJE]: [] },
      recursos: {},
    };
    const admin = dubleDoSupabase(estado);
    const original = admin.from.bind(admin);
    let upserts = 0;
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as Record<string, unknown> & { upsert: (...a: unknown[]) => unknown };
      if (t === "contact_tags") {
        const upsert = q.upsert;
        q.upsert = (...a: unknown[]) => {
          // o primeiro upsert (a criação) falha; os seguintes passam
          if (++upserts === 1) return { then: (r: (x: unknown) => unknown) => r({ data: null, error: { message: "boom" } }) };
          return upsert.apply(q, a);
        };
      }
      return q;
    };
    const r1 = await sincronizarAsaas(admin, CONTA, { agora: AGORA, cliente: () => dubleDoAsaas(respostas) });
    expect(r1).toMatchObject({ ok: true, fichasCriadas: 1 });
    const novo = estado.tabelas.cb_asaas_clientes.find((c) => c.asaas_customer_id === "cus_N")!;
    expect(novo).toMatchObject({ vinculo_origem: "criada", etiqueta_pendente: true });
    expect(estado.tabelas.contact_tags).toHaveLength(0);
    // ciclo seguinte: só a pendente ganha a etiqueta; a do "Tirou" continua sem
    const r2 = await sincronizarAsaas(admin, CONTA, { agora: new Date(AGORA.getTime() + 15 * 60_000), cliente: () => dubleDoAsaas(respostas) });
    expect(r2).toMatchObject({ ok: true });
    expect(estado.tabelas.contact_tags.map((t) => t.contact_id)).toEqual([novo.contact_id]);
    expect(estado.tabelas.cb_asaas_clientes.find((c) => c.asaas_customer_id === "cus_N")!.etiqueta_pendente).toBe(false);
  });

  it("chave ilegível marca o erro e não chama o Asaas", async () => {
    const estado = estadoInicial({}, { api_key: "lixo" });
    const { resultado, registro } = rodar(estado, { listas: {}, recursos: {} });
    expect(await resultado).toEqual({ ok: false, codigo: "chave_ilegivel" });
    expect(registro.pedidos).toHaveLength(0);
    expect(estado.tabelas.cb_asaas_config[0]).toMatchObject({ status: "erro", last_error: "chave_ilegivel" });
  });
});
