import { beforeEach, describe, expect, it, vi } from "vitest";

import { montarCabecalho } from "@/lib/calendly/assinatura";

// ------------------------------------------------------------
// A rota do webhook (977), com o banco e o processamento mockados: o que se
// prova aqui é a ORDEM das guardas — token desconhecido, assinatura,
// idempotência, evento estranho — e que a resposta ao Calendly é 200 antes
// de qualquer automação rodar.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  state: {
    config: null as Record<string, unknown> | null,
    upsertDevolve: [{ id: "evt-1" }] as { id: string }[],
    upserts: [] as Record<string, unknown>[],
    updates: [] as { table: string; payload: Record<string, unknown> }[],
    processados: [] as unknown[],
    cancelamentos: [] as unknown[],
    gravados: [] as unknown[],
  },
}));

vi.mock("@/lib/automations/admin-client", () => {
  const { state } = h;
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.eq = chain;
    b.update = (payload: Record<string, unknown>) => {
      state.updates.push({ table, payload });
      return b;
    };
    b.upsert = (payload: Record<string, unknown>) => {
      state.upserts.push(payload);
      return { select: async () => ({ data: state.upsertDevolve, error: null }) };
    };
    b.maybeSingle = async () => ({ data: table === "cb_calendly_config" ? state.config : null, error: null });
    b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return b;
  }
  return { supabaseAdmin: () => ({ from: (t: string) => builder(t) }) };
});

vi.mock("@/lib/whatsapp/encryption", () => ({ decrypt: (s: string) => s.replace(/^enc:/, "") }));

vi.mock("@/lib/calendly/cancelamento", () => ({
  processarCancelamento: vi.fn(async (_db: unknown, accountId: string, c: unknown) => {
    h.state.cancelamentos.push({ accountId, c });
    return { resultado: "cancelado", detalhe: "1 lembrete(s) desarmado(s)", contactId: "c1" };
  }),
}));

vi.mock("@/lib/calendly/processar", () => ({
  processarAgendamento: vi.fn(async (_db: unknown, accountId: string, agendamento: unknown) => {
    h.state.processados.push({ accountId, agendamento });
    return { resultado: "disparado", detalhe: null, contactId: "c1" };
  }),
  gravarResultado: vi.fn(async (_db: unknown, eventoId: string, r: unknown) => {
    h.state.gravados.push({ eventoId, r });
  }),
}));

// `after()` fora de um pedido do Next estoura; aqui ele roda na hora.
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => Promise<void>) => void fn() };
});

import { POST } from "./route";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const CHAVE = "chave-de-assinatura";

function corpoDeAgendamento(inviteeId = "INV1") {
  return JSON.stringify({
    event: "invitee.created",
    created_at: "2026-09-07T10:00:00Z",
    created_by: "https://api.calendly.com/users/U1",
    payload: {
      uri: `https://api.calendly.com/scheduled_events/E1/invitees/${inviteeId}`,
      name: "Marcelo",
      email: "m@x.com",
      text_reminder_number: "+55 96 99112-6767",
      questions_and_answers: [],
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/E1",
        name: "Reunião com Advogado - Kommo",
        start_time: "2026-08-26T16:45:00Z",
        end_time: "2026-08-26T17:15:00Z",
        event_type: "https://api.calendly.com/event_types/T1",
        location: { type: "google_conference", join_url: "https://meet.google.com/x" },
      },
    },
  });
}

async function chamar(corpo: string, headers: Record<string, string>, token = TOKEN) {
  const req = new Request(`http://crm.local/api/cb/calendly/webhook/${token}`, { method: "POST", headers, body: corpo });
  const res = await POST(req, { params: Promise.resolve({ token }) });
  return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
}

function assinado(corpo: string, chave = CHAVE) {
  return { "calendly-webhook-signature": montarCabecalho(corpo, chave, Math.floor(Date.now() / 1000)) };
}

beforeEach(() => {
  h.state.config = { account_id: "acc-1", signing_key: `enc:${CHAVE}`, pergunta_telefone: null };
  h.state.upsertDevolve = [{ id: "evt-1" }];
  h.state.upserts = [];
  h.state.updates = [];
  h.state.processados = [];
  h.state.cancelamentos = [];
  h.state.gravados = [];
});

describe("POST /api/cb/calendly/webhook/[token]", () => {
  it("agendamento assinado: grava, responde 200 e processa depois", async () => {
    const corpo = corpoDeAgendamento();
    const r = await chamar(corpo, assinado(corpo));
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ ok: true, evento: "evt-1" });
    expect(h.state.upserts[0]).toMatchObject({
      account_id: "acc-1",
      evento: "invitee.created",
      invitee_uri: "https://api.calendly.com/scheduled_events/E1/invitees/INV1",
      telefone: "5596991126767",
      telefone_origem: "sms",
      resultado: "recebido",
    });
    expect(h.state.processados).toHaveLength(1);
    expect(h.state.gravados[0]).toMatchObject({ eventoId: "evt-1", r: { resultado: "disparado" } });
    // 979: as variáveis entregues ao motor ficam na linha, para o
    // "Processar de novo" repetir a MESMA entrega.
    expect((h.state.upserts[0] as { variaveis?: Record<string, string> }).variaveis).toMatchObject({
      agendamento_nome: "Marcelo",
    });
    const carimbo = h.state.updates.find((u) => u.table === "cb_calendly_config" && "last_event_at" in u.payload);
    expect(carimbo?.payload.webhook_state).toBe("active");
  });

  it("CRÍTICO: assinatura errada → 401 e NADA gravado", async () => {
    const corpo = corpoDeAgendamento();
    const r = await chamar(corpo, assinado(corpo, "outra-chave"));
    expect(r.status).toBe(401);
    expect(h.state.upserts).toHaveLength(0);
    expect(h.state.processados).toHaveLength(0);
  });

  it("sem cabeçalho de assinatura → 401", async () => {
    const r = await chamar(corpoDeAgendamento(), {});
    expect(r.status).toBe(401);
  });

  it("token desconhecido → 404 antes de conferir qualquer coisa", async () => {
    h.state.config = null;
    const corpo = corpoDeAgendamento();
    const r = await chamar(corpo, assinado(corpo));
    expect(r.status).toBe(404);
  });

  it("token fora da forma → 404", async () => {
    const corpo = corpoDeAgendamento();
    const r = await chamar(corpo, assinado(corpo), "../x");
    expect(r.status).toBe(404);
  });

  it("CRÍTICO: reentrega (UNIQUE recusou) → 200 duplicado, sem processar de novo", async () => {
    h.state.upsertDevolve = [];
    const corpo = corpoDeAgendamento();
    const r = await chamar(corpo, assinado(corpo));
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ ok: true, duplicado: true });
    expect(h.state.processados).toHaveLength(0);
  });

  it("evento que o CRM não trata → 200 ignorado, nada gravado (4xx desativaria a assinatura)", async () => {
    // ⚠️ Até a 1013 este teste usava `invitee.canceled` como exemplo de
    // "evento estranho". Ele passou a ser TRATADO (desarma os lembretes),
    // então o exemplo mudou — o que se prova aqui continua sendo que um
    // evento fora dos dois assinados não vira linha nem 4xx.
    const corpo = JSON.stringify({ event: "routing_form_submission.created", payload: { uri: "x" } });
    const r = await chamar(corpo, assinado(corpo));
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ ok: true, ignorado: true });
    expect(h.state.upserts).toHaveLength(0);
  });

  it("CANCELAMENTO: grava a linha própria e desarma em after() (1013)", async () => {
    const corpo = JSON.stringify({
      event: "invitee.canceled",
      payload: {
        uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
        name: "Joel",
        scheduled_event: { start_time: "2026-09-25T17:00:00Z" },
      },
    });
    const r = await chamar(corpo, assinado(corpo));
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ ok: true, cancelamento: true });
    // a linha é do evento de CANCELAMENTO, não do agendamento
    expect(h.state.upserts).toHaveLength(1);
    expect(h.state.upserts[0]).toMatchObject({ evento: "invitee.canceled", resultado: "recebido" });
    expect(h.state.cancelamentos).toHaveLength(1);
    // e o agendamento NÃO foi processado por este caminho
    expect(h.state.processados).toHaveLength(0);
  });

  it("CANCELAMENTO reentregue (UNIQUE recusou) → 200 duplicado, sem desarmar de novo", async () => {
    h.state.upsertDevolve = [];
    const corpo = JSON.stringify({
      event: "invitee.canceled",
      payload: { uri: "u", scheduled_event: { start_time: "2026-09-25T17:00:00Z" } },
    });
    const r = await chamar(corpo, assinado(corpo));
    expect(r.corpo).toEqual({ ok: true, duplicado: true });
    expect(h.state.cancelamentos).toHaveLength(0);
  });

  it("JSON inválido com assinatura válida → 400", async () => {
    const corpo = "{nope";
    const r = await chamar(corpo, assinado(corpo));
    expect(r.status).toBe(400);
  });

  it("processamento que estoura vira `falhou` na linha, nunca 500 para o Calendly", async () => {
    const { processarAgendamento } = await import("@/lib/calendly/processar");
    vi.mocked(processarAgendamento).mockRejectedValueOnce(new Error("banco caiu"));
    const corpo = corpoDeAgendamento("INV2");
    const r = await chamar(corpo, assinado(corpo));
    expect(r.status).toBe(200);
    // o `after()` mockado roda síncrono, mas a rejeição resolve no próximo tick
    await new Promise((res) => setTimeout(res, 0));
    expect(h.state.gravados[0]).toMatchObject({ r: { resultado: "falhou", detalhe: "banco caiu" } });
  });
});
