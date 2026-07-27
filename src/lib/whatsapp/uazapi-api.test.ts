import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstance,
  connectInstance,
  getInstanceStatus,
  disconnectInstance,
  deleteInstance,
  sendText,
  sendMedia,
  sendReaction,
  sendMenu,
  configureWebhook,
} from "./uazapi-api";

const BASE_URL = "https://free.uazapi.com";
const ADMIN_TOKEN = "admin-secret";

interface Captured {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown> | null;
}
let captured: Captured | null = null;

function okFetch(responseBody: unknown, status = 200) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    captured = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
    };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
    } as Response;
  });
}

describe("uazapi-api", () => {
  beforeEach(() => {
    captured = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createInstance uses admintoken header, not token", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch({ token: "instance-token-abc", instance: { id: "inst-1" } }),
    );
    const result = await createInstance({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, name: "acme" });
    expect(result).toEqual({ instanceId: "inst-1", token: "instance-token-abc" });
    expect(captured?.url).toBe("https://free.uazapi.com/instance/create");
    expect(captured?.headers?.admintoken).toBe("admin-secret");
    expect(captured?.headers?.token).toBeUndefined();
    expect(captured?.body).toEqual({ name: "acme" });
  });

  it("createInstance throws when the response is missing id/token", async () => {
    vi.stubGlobal("fetch", okFetch({}));
    await expect(
      createInstance({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN, name: "acme" }),
    ).rejects.toThrow(/did not return an instance id\/token/);
  });

  it("connectInstance sends the per-instance token header and returns qrcode/paircode", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch({ instance: { status: "connecting", qrcode: "data:image/png;base64,AA==" } }),
    );
    const result = await connectInstance({ baseUrl: BASE_URL, token: "inst-token" });
    expect(result).toEqual({
      status: "connecting",
      qrcode: "data:image/png;base64,AA==",
      paircode: undefined,
    });
    expect(captured?.headers?.token).toBe("inst-token");
    expect(captured?.headers?.admintoken).toBeUndefined();
  });

  it("connectInstance forwards phone for pairing-code mode", async () => {
    vi.stubGlobal("fetch", okFetch({ instance: { status: "connecting", paircode: "1234-5678" } }));
    await connectInstance({ baseUrl: BASE_URL, token: "inst-token", phone: "5511999999999" });
    expect(captured?.body).toEqual({ phone: "5511999999999" });
  });

  it("getInstanceStatus extracts the paired phone from status.jid.user", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch({
        instance: { status: "connected" },
        status: { connected: true, loggedIn: true, jid: { user: "5511999999999" } },
      }),
    );
    const result = await getInstanceStatus({ baseUrl: BASE_URL, token: "inst-token" });
    expect(result).toEqual({
      status: "connected",
      qrcode: undefined,
      paircode: undefined,
      pairedPhone: "5511999999999",
    });
  });

  it("disconnectInstance and deleteInstance hit the right methods with the instance token", async () => {
    vi.stubGlobal("fetch", okFetch({ response: "ok" }));
    await disconnectInstance({ baseUrl: BASE_URL, token: "inst-token" });
    expect(captured?.url).toBe("https://free.uazapi.com/instance/disconnect");
    expect(captured?.method).toBe("POST");

    await deleteInstance({ baseUrl: BASE_URL, token: "inst-token" });
    expect(captured?.url).toBe("https://free.uazapi.com/instance");
    expect(captured?.method).toBe("DELETE");
  });

  it("deleteInstance treats 404 as success", async () => {
    vi.stubGlobal("fetch", okFetch({ error: "not found" }, 404));
    await expect(
      deleteInstance({ baseUrl: BASE_URL, token: "inst-token" }),
    ).resolves.toBeUndefined();
  });

  it("sendText normalizes uazapi's lowercase messageid to messageId", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "3EB0-abc" }));
    const result = await sendText({
      baseUrl: BASE_URL,
      token: "inst-token",
      number: "5511999999999",
      text: "oi",
    });
    expect(result).toEqual({ messageId: "3EB0-abc" });
    expect(captured?.body).toEqual({ number: "5511999999999", text: "oi" });
  });

  it("sendMedia maps kind/file/caption straight through", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "3EB0-media" }));
    const result = await sendMedia({
      baseUrl: BASE_URL,
      token: "inst-token",
      number: "5511999999999",
      type: "image",
      file: "https://cdn.example.com/x.jpg",
      text: "legenda",
    });
    expect(result).toEqual({ messageId: "3EB0-media" });
    expect(captured?.body).toMatchObject({
      type: "image",
      file: "https://cdn.example.com/x.jpg",
      text: "legenda",
    });
  });

  it("sendReaction falls back to the target id when uazapi omits one", async () => {
    vi.stubGlobal("fetch", okFetch({}));
    const result = await sendReaction({
      baseUrl: BASE_URL,
      token: "inst-token",
      number: "5511999999999",
      targetMessageId: "3EB0-target",
      emoji: "👍",
    });
    expect(result).toEqual({ messageId: "3EB0-target" });
    expect(captured?.body).toEqual({
      number: "5511999999999",
      text: "👍",
      id: "3EB0-target",
    });
  });

  it("sendMenu passes choices through untouched (encoding is the provider adapter's job)", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "3EB0-menu" }));
    await sendMenu({
      baseUrl: BASE_URL,
      token: "inst-token",
      number: "5511999999999",
      type: "button",
      text: "Escolha uma opção",
      choices: ["Sim|yes", "Não|no"],
      footerText: "rodapé",
    });
    expect(captured?.body).toEqual({
      number: "5511999999999",
      type: "button",
      text: "Escolha uma opção",
      choices: ["Sim|yes", "Não|no"],
      footerText: "rodapé",
      listButton: undefined,
    });
  });

  it("configureWebhook always sets excludeMessages: ['wasSentByApi'] to avoid echo loops", async () => {
    vi.stubGlobal("fetch", okFetch({}));
    await configureWebhook({
      baseUrl: BASE_URL,
      token: "inst-token",
      url: "https://crm.example.com/api/uazapi/webhook/acc/secret",
    });
    expect(captured?.body).toMatchObject({
      enabled: true,
      url: "https://crm.example.com/api/uazapi/webhook/acc/secret",
      excludeMessages: ["wasSentByApi"],
    });
  });

  it("throws with the uazapi error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", okFetch({ error: "invalid token" }, 401));
    await expect(
      sendText({ baseUrl: BASE_URL, token: "bad", number: "5511999999999", text: "oi" }),
    ).rejects.toThrow(/invalid token/);
  });
});
