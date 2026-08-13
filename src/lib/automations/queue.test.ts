import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks de estado compartidos (hoisted para el factory de vi.mock).
const h = vi.hoisted(() => ({
  rule: null as Record<string, unknown> | null,
  sentToday: 0 as number,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  dueRows: [] as Record<string, unknown>[],
  sendTemplate: vi.fn(async (_args: Record<string, unknown>) => ({ whatsapp_message_id: "m1" })),
  sendText: vi.fn(async (_args: Record<string, unknown>) => ({ whatsapp_message_id: "m1" })),
}));

vi.mock("./admin-client", () => {
  function resolve(ops: { table: string; type: string }) {
    if (ops.table === "frequency_rules") return { data: h.rule, error: null };
    if (ops.table === "messages") {
      // count head query
      return { count: h.sentToday, error: null };
    }
    if (ops.table === "message_queue") {
      if (ops.type === "insert") return { data: { id: "q1" }, error: null };
      if (ops.type === "update") {
        // claim / sent update → fila única (select id)
        return { data: h.dueRows[0] ?? null, error: null };
      }
      // select (fetch due) → array completo
      return { data: h.dueRows, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = { table, type: "select" as string, payload: undefined as unknown };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      eq: () => b,
      gte: () => b,
      in: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(resolve(ops)),
      single: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
    }),
  };
});

vi.mock("@/lib/flows/meta-send", () => ({
  engineSendTemplate: h.sendTemplate,
  engineSendText: h.sendText,
}));

import {
  checkFrequencyOrEnqueue,
  drainMessageQueue,
  withinWindow,
} from "./queue";

const ACCOUNT = "acct-1";
const CONTACT = "contact-1";

beforeEach(() => {
  h.rule = null;
  h.sentToday = 0;
  h.inserts = [];
  h.updates = [];
  h.dueRows = [];
  h.sendTemplate.mockClear();
  h.sendText.mockClear();
});

// El builder del mock no registra inserts/updates en el estado; los
// espiamos manualmente interceptando en el factory. Para mantener el
// test simple, verificamos el resultado funcional (queued sí/no) y el
// comportamiento de drain (llamadas a send*).

describe("withinWindow", () => {
  it("dentro de la ventana → true", () => {
    expect(withinWindow("09:00", "20:00", "15:30")).toBe(true);
  });
  it("fuera de la ventana → false", () => {
    expect(withinWindow("09:00", "20:00", "22:00")).toBe(false);
  });
  it("borde final exclusivo → false a las 20:00", () => {
    expect(withinWindow("09:00", "20:00", "20:00")).toBe(false);
  });
  it("borde inicial inclusivo → true a las 09:00", () => {
    expect(withinWindow("09:00", "20:00", "09:00")).toBe(true);
  });
});

describe("checkFrequencyOrEnqueue", () => {
  it("fail-open: sin regla configurada → envía directo (no encola)", async () => {
    const r = await checkFrequencyOrEnqueue({
      accountId: ACCOUNT,
      contactId: CONTACT,
      payload: { step_type: "send_template", template_name: "x" },
    });
    expect(r.queued).toBe(false);
  });

  it("regla con cuota no agotada → envía directo", async () => {
    h.rule = {
      account_id: ACCOUNT,
      channel: "whatsapp",
      max_per_day: 10,
      window_start: "09:00",
      window_end: "20:00",
      is_active: true,
    };
    h.sentToday = 3;
    const r = await checkFrequencyOrEnqueue({
      accountId: ACCOUNT,
      contactId: CONTACT,
      payload: { step_type: "send_message", text: "hola" },
    });
    expect(r.queued).toBe(false);
  });

  it("cuota agotada → encola con razón frequency_limit", async () => {
    h.rule = {
      account_id: ACCOUNT,
      channel: "whatsapp",
      max_per_day: 5,
      window_start: "09:00",
      window_end: "20:00",
      is_active: true,
    };
    h.sentToday = 5;
    const r = await checkFrequencyOrEnqueue({
      accountId: ACCOUNT,
      contactId: CONTACT,
      payload: { step_type: "send_template", template_name: "x", params: [] },
    });
    expect(r.queued).toBe(true);
    expect(r.reason).toContain("frequency limit 5/5");
  });

  it("regla inactiva → envía directo", async () => {
    h.rule = { ...(h.rule as object), is_active: false } as Record<string, unknown>;
    const r = await checkFrequencyOrEnqueue({
      accountId: ACCOUNT,
      contactId: CONTACT,
      payload: { step_type: "send_message", text: "hola" },
    });
    expect(r.queued).toBe(false);
  });
});

describe("drainMessageQueue", () => {
  it("sin filas due → no envía nada", async () => {
    const r = await drainMessageQueue();
    expect(r).toEqual({ processed: 0, sent: 0, failed: 0 });
  });

  it("claim + envío template + marca sent", async () => {
    h.dueRows = [
      {
        id: "q1",
        account_id: ACCOUNT,
        contact_id: CONTACT,
        channel: "whatsapp",
        payload: {
          step_type: "send_template",
          template_name: "recordatorio",
          params: ["Ana"],
          conversation_id: "conv-1",
          user_id: "user-1",
        },
        attempts: 0,
      },
    ];
    const r = await drainMessageQueue();
    expect(r.processed).toBe(1);
    expect(r.sent).toBe(1);
    expect(h.sendTemplate).toHaveBeenCalledTimes(1);
    expect(h.sendTemplate.mock.calls[0][0]).toMatchObject({
      accountId: ACCOUNT,
      contactId: CONTACT,
      templateName: "recordatorio",
      params: ["Ana"],
    });
  });

  it("fallo del envío → reintento con backoff, no se descarta", async () => {
    h.sendTemplate.mockRejectedValueOnce(new Error("Meta 400"));
    h.dueRows = [
      {
        id: "q1",
        account_id: ACCOUNT,
        contact_id: CONTACT,
        channel: "whatsapp",
        payload: { step_type: "send_template", template_name: "x" },
        attempts: 0,
      },
    ];
    const r = await drainMessageQueue();
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(0);
  });
});
