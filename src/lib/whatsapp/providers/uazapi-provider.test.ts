import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UazapiProvider } from "./uazapi-provider";

interface Captured {
  url?: string;
  body?: Record<string, unknown> | null;
}
let captured: Captured | null = null;

function okFetch(responseBody: unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    captured = {
      url,
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
    };
    return { ok: true, status: 200, json: async () => responseBody } as Response;
  });
}

describe("UazapiProvider", () => {
  const provider = new UazapiProvider({
    instanceId: "inst-1",
    token: "inst-token",
    baseUrl: "https://free.uazapi.com",
  });

  beforeEach(() => {
    captured = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports kind: "uazapi"', () => {
    expect(provider.kind).toBe("uazapi");
  });

  it("sendText normalizes messageid -> messageId", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "abc" }));
    const result = await provider.sendText({ to: "5511999999999", text: "oi" });
    expect(result).toEqual({ messageId: "abc" });
  });

  it("sendMedia maps kind='audio' to uazapi's 'ptt' type for voice-note rendering", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "abc" }));
    await provider.sendMedia({ to: "5511999999999", kind: "audio", link: "https://x/a.ogg" });
    expect(captured?.body).toMatchObject({ type: "ptt" });
  });

  it("sendMedia leaves image/video/document kinds untouched", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "abc" }));
    await provider.sendMedia({ to: "5511999999999", kind: "image", link: "https://x/a.jpg" });
    expect(captured?.body).toMatchObject({ type: "image" });
  });

  it("sendMedia only forwards docName for document kind", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "abc" }));
    await provider.sendMedia({
      to: "5511999999999",
      kind: "image",
      link: "https://x/a.jpg",
      filename: "should-be-ignored.jpg",
    });
    expect(captured?.body?.docName).toBeUndefined();
  });

  it("sendInteractiveButtons encodes each button as 'title|id'", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "abc" }));
    await provider.sendInteractiveButtons({
      to: "5511999999999",
      bodyText: "Escolha:",
      buttons: [
        { id: "yes", title: "Sim" },
        { id: "no", title: "Não" },
      ],
    });
    expect(captured?.body).toMatchObject({
      type: "button",
      choices: ["Sim|yes", "Não|no"],
    });
  });

  it("sendInteractiveList encodes sections as '[Title]' markers and rows as 'title|id|description'", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "abc" }));
    await provider.sendInteractiveList({
      to: "5511999999999",
      bodyText: "Catálogo",
      buttonLabel: "Ver opções",
      sections: [
        {
          title: "Eletrônicos",
          rows: [
            { id: "phones", title: "Smartphones", description: "Últimos lançamentos" },
            { id: "notes", title: "Notebooks" },
          ],
        },
      ],
    });
    expect(captured?.body).toMatchObject({
      type: "list",
      listButton: "Ver opções",
      choices: [
        "[Eletrônicos]",
        "Smartphones|phones|Últimos lançamentos",
        "Notebooks|notes",
      ],
    });
  });

  it("sendReaction passes target id and emoji through", async () => {
    vi.stubGlobal("fetch", okFetch({ messageid: "abc" }));
    await provider.sendReaction({ to: "5511999999999", targetMessageId: "3EB0-x", emoji: "👍" });
    expect(captured?.body).toMatchObject({ id: "3EB0-x", text: "👍" });
  });
});
