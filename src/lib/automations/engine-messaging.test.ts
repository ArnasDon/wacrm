import { describe, it, expect, beforeEach, vi } from "vitest";

// https://github.com/dacasan/wacrm/blob/main/src/lib/automations/engine.test.ts
// Mismo harness de mocking del service-role client, + stubs de los
// clientes Telnyx/Resend para aislar las ramas send_sms/send_email.
const h = vi.hoisted(() => ({
  state: {
    owned: null as Record<string, unknown> | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    logInserts: [] as Record<string, unknown>[],
    emailTemplate: null as { subject: string; body_html: string } | null,
    telnyxConfig: null as {
      api_key_encrypted?: string;
      default_from_number?: string;
      messaging_profile_id?: string | null;
    } | null,
    emailConfig: null as {
      resend_api_key_encrypted?: string;
      from_email?: string;
      reply_to?: string | null;
    } | null,
  },
  smsCalls: [] as Array<{ from: string; to: string; text: string; messagingProfileId: string }>,
  emailCalls: [] as Array<{ to: string; subject: string; html: string }>,
}));

vi.mock("./admin-client", () => {
  const { state } = h;
  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      gte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }
  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === "contacts") return { data: state.owned, error: null };
    if (table === "automations") return { data: state.automations, error: null };
    if (table === "email_templates") return { data: state.emailTemplate, error: null };
    if (table === "telnyx_config") return { data: state.telnyxConfig, error: null };
    if (table === "email_config") return { data: state.emailConfig, error: null };
    if (table === "automation_steps") return { data: state.steps, error: null };
    if (table === "automation_logs") {
      if (type === "insert") {
        state.logInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: "log1" }, error: null };
      }
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    return { data: null, error: null };
  }
  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("@/lib/telnyx/api", () => ({
  loadTelnyxSendConfig: async () => {
    const { state } = h;
    return {
      apiKey: state.telnyxConfig?.api_key_encrypted ?? "key",
      fromNumber: state.telnyxConfig?.default_from_number ?? "+15550002222",
      messagingProfileId: state.telnyxConfig?.messaging_profile_id ?? null,
    };
  },
  createTelnyxClient: (apiKey: string) => ({
    sendSms: async (input: {
      from: string;
      to: string;
      text: string;
      messagingProfileId: string;
    }) => {
      h.smsCalls.push(input);
      return { id: "msg-sms" };
    },
  }),
}));

vi.mock("@/lib/email/send", () => ({
  loadEmailConfig: async () => {
    const { state } = h;
    return {
      apiKey: state.emailConfig?.resend_api_key_encrypted ?? "resend-key",
      fromEmail: state.emailConfig?.from_email ?? "Mi Pyme <hola@x.com>",
      replyTo: state.emailConfig?.reply_to ?? null,
    };
  },
  createResendClient: () => ({
    send: async (from: string, replyTo: string | null, input: { to: string; subject: string; html: string }) => {
      h.emailCalls.push(input);
      return { id: "email-1" };
    },
  }),
}));

import { runAutomationsForTrigger } from "./engine";
import type { Automation } from "@/types";

const ACCOUNT = "acct-1";

function automationWith(steps: Record<string, unknown>[]): Automation {
  h.state.automations = [{
    id: "auto-1",
    account_id: ACCOUNT,
    user_id: "user-1",
    name: "missed follow-up",
    trigger_type: "missed_call",
    trigger_config: {},
    is_active: true,
    execution_count: 0,
    created_at: "",
    updated_at: "",
  }];
  return h.state.automations[0] as unknown as Automation;
}

beforeEach(() => {
  h.state.automations = [];
  h.state.owned = {
    id: "c1",
    name: "Ana",
    email: "ana@correo.com",
    phone: "+370 63949836",
    company: "Acme",
  };
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.logInserts = [];
  h.state.emailTemplate = { subject: "Perdimos tu llamada", body_html: "<p>Hola {{1}}</p>" };
  h.state.telnyxConfig = {
    api_key_encrypted: "iv:key:t",
    default_from_number: "+15550002222",
    messaging_profile_id: "mp-1",
  };
  h.state.emailConfig = {
    resend_api_key_encrypted: "iv:rk:t",
    from_email: "Mi Pyme <hola@x.com>",
    reply_to: null,
  };
  h.smsCalls = [];
  h.emailCalls = [];
});

function run(steps: Record<string, unknown>[]) {
  h.state.steps = steps;
  h.state.automations = [{
    id: "auto-1",
    account_id: ACCOUNT,
    user_id: "user-1",
    name: "missed follow-up",
    trigger_type: "missed_call",
    trigger_config: {},
    is_active: true,
    execution_count: 0,
    created_at: "",
    updated_at: "",
  }];
  return runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: "missed_call",
    contactId: "c1",
    context: { missed_call_number: "+15550001111", call_id: "call-1" },
  });
}

describe("send_sms step (Telnyx)", () => {
  it("envía el SMS con el número E.164 y el messaging profile", async () => {
    await run([{
      id: "s1",
      automation_id: "auto-1",
      step_type: "send_sms",
      step_config: { text: "Hola {{name}}, te llamamos y no pudimos. Llámanos." },
      position: 0,
    }]);

    expect(h.smsCalls).toHaveLength(1);
    expect(h.smsCalls[0]).toMatchObject({
      from: "+15550002222",
      to: "+37063949836", // normalizePhone (dígitos) + '+'
      messagingProfileId: "mp-1",
    });
    expect(h.smsCalls[0].text).toContain("Ana");
  });

  it("falla cuando el contacto no tiene phone", async () => {
    h.state.owned = { id: "c1", name: "Ana", email: "a@b.c", phone: "", company: "" };
    await run([{
      id: "s1",
      automation_id: "auto-1",
      step_type: "send_sms",
      step_config: { text: "Hola" },
      position: 0,
    }]);

    expect(h.smsCalls).toHaveLength(0);
    expect(h.state.logInserts[0]).toBeDefined();
    ensureFailedStatus(h.state.logInserts[0]);
  });

  it("falla si falta messaging_profile_id en la config", async () => {
    h.state.telnyxConfig = {
      api_key_encrypted: "iv:key:t",
      default_from_number: "+15550002222",
      messaging_profile_id: null,
    };
    await run([{
      id: "s1",
      automation_id: "auto-1",
      step_type: "send_sms",
      step_config: { text: "Hola" },
      position: 0,
    }]);

    expect(h.smsCalls).toHaveLength(0);
    ensureFailedStatus(h.state.logInserts[0]);
  });
});

describe("send_email step (Resend)", () => {
  it("interpola el template y envía el email", async () => {
    await run([{
      id: "s2",
      automation_id: "auto-1",
      step_type: "send_email",
      step_config: { template: "missed_call", variables: { "1": { type: "field", value: "name" } } },
      position: 0,
    }]);

    expect(h.emailCalls).toHaveLength(1);
    expect(h.emailCalls[0]).toMatchObject({
      to: "ana@correo.com",
      subject: "Perdimos tu llamada",
    });
    expect(h.emailCalls[0].html).toContain("Ana");
  });

  it("falla si no existe el template", async () => {
    h.state.emailTemplate = null;
    await run([{
      id: "s2",
      automation_id: "auto-1",
      step_type: "send_email",
      step_config: { template: "missing" },
      position: 0,
    }]);

    expect(h.emailCalls).toHaveLength(0);
    ensureFailedStatus(h.state.logInserts[0]);
  });

  it("falla si el contacto no tiene email", async () => {
    h.state.owned = { id: "c1", name: "Ana", email: "", phone: "+37063949836", company: "" };
    await run([{
      id: "s2",
      automation_id: "auto-1",
      step_type: "send_email",
      step_config: { template: "missed_call" },
      position: 0,
    }]);

    expect(h.emailCalls).toHaveLength(0);
    ensureFailedStatus(h.state.logInserts[0]);
  });
});

function ensureFailedStatus(log: Record<string, unknown>) {
  const steps = log.steps_executed as Array<{ status?: string } | undefined> | undefined;
  const anyFailed = (steps ?? []).some((s) => s?.status === "failed");
  expect(anyFailed || log.status === "failed").toBe(true);
}