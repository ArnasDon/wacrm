import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstanceStatus,
  getQrCode,
  getProfilePicture,
  disconnectInstance,
  configureWebhook,
  sendText,
  sendImage,
  sendVideo,
  sendAudio,
  sendDocument,
  sendReaction,
  removeReaction,
  sendButtonList,
  sendOptionList,
} from "./zapi-api";

const INSTANCE_ID = "inst-123";
const TOKEN = "token-abc";
const BASE = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`;

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

describe("zapi-api", () => {
  beforeEach(() => {
    captured = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getInstanceStatus reports connected/disconnected without a Client-Token header when none is configured", async () => {
    vi.stubGlobal("fetch", okFetch({ connected: true, error: "You are already connected" }));
    const result = await getInstanceStatus({ instanceId: INSTANCE_ID, token: TOKEN });
    expect(result).toEqual({ connected: true, detail: "You are already connected" });
    expect(captured?.url).toBe(`${BASE}/status`);
    expect(captured?.headers?.["Client-Token"]).toBeUndefined();
  });

  it("sends the Client-Token header when configured", async () => {
    vi.stubGlobal("fetch", okFetch({ connected: false }));
    await getInstanceStatus({ instanceId: INSTANCE_ID, token: TOKEN, clientToken: "sec-1" });
    expect(captured?.headers?.["Client-Token"]).toBe("sec-1");
  });

  it("getQrCode returns the data-url value, or null when Z-API omits it", async () => {
    vi.stubGlobal("fetch", okFetch({ value: "data:image/png;base64,AA==" }));
    const result = await getQrCode({ instanceId: INSTANCE_ID, token: TOKEN });
    expect(result).toEqual({ qrCode: "data:image/png;base64,AA==" });
    expect(captured?.url).toBe(`${BASE}/qr-code`);

    vi.stubGlobal("fetch", okFetch({}));
    const empty = await getQrCode({ instanceId: INSTANCE_ID, token: TOKEN });
    expect(empty).toEqual({ qrCode: null });
  });

  it("getProfilePicture returns the photo link with the phone as a query param", async () => {
    vi.stubGlobal("fetch", okFetch({ link: "https://pps.whatsapp.net/photo.jpg" }));
    const result = await getProfilePicture({ instanceId: INSTANCE_ID, token: TOKEN, phone: "5511999999999" });
    expect(result).toEqual({ url: "https://pps.whatsapp.net/photo.jpg" });
    expect(captured?.url).toBe(`${BASE}/profile-picture?phone=5511999999999`);
  });

  it("getProfilePicture returns null instead of throwing on a non-2xx response (e.g. no photo set)", async () => {
    vi.stubGlobal("fetch", okFetch({ error: "not found" }, 404));
    const result = await getProfilePicture({ instanceId: INSTANCE_ID, token: TOKEN, phone: "5511999999999" });
    expect(result).toEqual({ url: null });
  });

  it("disconnectInstance posts to /disconnect", async () => {
    vi.stubGlobal("fetch", okFetch({ value: true }));
    await disconnectInstance({ instanceId: INSTANCE_ID, token: TOKEN });
    expect(captured?.url).toBe(`${BASE}/disconnect`);
    expect(captured?.method).toBe("POST");
  });

  it("configureWebhook PUTs the same URL to /update-every-webhooks with notifySentByMe: false", async () => {
    vi.stubGlobal("fetch", okFetch({ value: true }));
    await configureWebhook({
      instanceId: INSTANCE_ID,
      token: TOKEN,
      url: "https://crm.example.com/api/z-api/webhook/acc/secret",
    });
    expect(captured?.url).toBe(`${BASE}/update-every-webhooks`);
    expect(captured?.method).toBe("PUT");
    expect(captured?.body).toEqual({
      value: "https://crm.example.com/api/z-api/webhook/acc/secret",
      notifySentByMe: false,
    });
  });

  it("sendText normalizes the messageId field", async () => {
    vi.stubGlobal("fetch", okFetch({ zaapId: "z1", messageId: "3EB0-abc", id: "3EB0-abc" }));
    const result = await sendText({ instanceId: INSTANCE_ID, token: TOKEN, phone: "5511999999999", message: "oi" });
    expect(result).toEqual({ messageId: "3EB0-abc" });
    expect(captured?.url).toBe(`${BASE}/send-text`);
    expect(captured?.body).toEqual({ phone: "5511999999999", message: "oi" });
  });

  it("sendImage passes phone/image/caption straight through", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "m1" }));
    await sendImage({
      instanceId: INSTANCE_ID,
      token: TOKEN,
      phone: "5511999999999",
      image: "https://cdn.example.com/x.jpg",
      caption: "legenda",
    });
    expect(captured?.url).toBe(`${BASE}/send-image`);
    expect(captured?.body).toMatchObject({ image: "https://cdn.example.com/x.jpg", caption: "legenda" });
  });

  it("sendVideo and sendAudio hit their own endpoints", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "m1" }));
    await sendVideo({ instanceId: INSTANCE_ID, token: TOKEN, phone: "5511999999999", video: "https://x/v.mp4" });
    expect(captured?.url).toBe(`${BASE}/send-video`);

    await sendAudio({ instanceId: INSTANCE_ID, token: TOKEN, phone: "5511999999999", audio: "https://x/a.mp3" });
    expect(captured?.url).toBe(`${BASE}/send-audio`);
  });

  it("sendDocument puts the file extension in the URL path, not the body", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "m1" }));
    await sendDocument({
      instanceId: INSTANCE_ID,
      token: TOKEN,
      phone: "5511999999999",
      document: "https://x/doc.pdf",
      extension: "pdf",
      fileName: "doc.pdf",
    });
    expect(captured?.url).toBe(`${BASE}/send-document/pdf`);
    expect(captured?.body).toMatchObject({ document: "https://x/doc.pdf", fileName: "doc.pdf" });
    // extension must not leak into the body
    expect(captured?.body?.extension).toBeUndefined();
  });

  it("sendReaction and removeReaction hit distinct endpoints", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "m1" }));
    await sendReaction({ instanceId: INSTANCE_ID, token: TOKEN, phone: "5511999999999", messageId: "3EB0-x", reaction: "👍" });
    expect(captured?.url).toBe(`${BASE}/send-reaction`);
    expect(captured?.body).toEqual({ phone: "5511999999999", reaction: "👍", messageId: "3EB0-x" });

    await removeReaction({ instanceId: INSTANCE_ID, token: TOKEN, phone: "5511999999999", messageId: "3EB0-x" });
    expect(captured?.url).toBe(`${BASE}/send-remove-reaction`);
    expect(captured?.body).toEqual({ phone: "5511999999999", messageId: "3EB0-x" });
  });

  it("sendButtonList encodes buttons as {id, label} pairs", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "m1" }));
    await sendButtonList({
      instanceId: INSTANCE_ID,
      token: TOKEN,
      phone: "5511999999999",
      message: "Escolha uma opção",
      buttons: [
        { id: "1", label: "Sim" },
        { id: "2", label: "Não" },
      ],
    });
    expect(captured?.url).toBe(`${BASE}/send-button-list`);
    expect(captured?.body).toEqual({
      phone: "5511999999999",
      message: "Escolha uma opção",
      buttonList: {
        buttons: [
          { id: "1", label: "Sim" },
          { id: "2", label: "Não" },
        ],
      },
    });
  });

  it("sendOptionList encodes the option list shape", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "m1" }));
    await sendOptionList({
      instanceId: INSTANCE_ID,
      token: TOKEN,
      phone: "5511999999999",
      message: "Selecione:",
      title: "Opções",
      buttonLabel: "Abrir lista",
      options: [{ id: "1", title: "Z-API", description: "desc" }],
    });
    expect(captured?.url).toBe(`${BASE}/send-option-list`);
    expect(captured?.body).toEqual({
      phone: "5511999999999",
      message: "Selecione:",
      optionList: {
        title: "Opções",
        buttonLabel: "Abrir lista",
        options: [{ id: "1", title: "Z-API", description: "desc" }],
      },
    });
  });

  it("throws with the Z-API error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", okFetch({ error: "invalid token" }, 401));
    await expect(
      sendText({ instanceId: INSTANCE_ID, token: "bad", phone: "5511999999999", message: "oi" }),
    ).rejects.toThrow(/invalid token/);
  });
});
