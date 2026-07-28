import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZapiProvider } from "./zapi-provider";

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

describe("ZapiProvider", () => {
  const provider = new ZapiProvider({ instanceId: "inst-1", token: "inst-token" });

  beforeEach(() => {
    captured = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports kind: "zapi"', () => {
    expect(provider.kind).toBe("zapi");
  });

  it("sendText normalizes messageId", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "abc" }));
    const result = await provider.sendText({ to: "5511999999999", text: "oi" });
    expect(result).toEqual({ messageId: "abc" });
  });

  it("sendMedia routes each kind to its own Z-API endpoint", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "abc" }));
    await provider.sendMedia({ to: "5511999999999", kind: "image", link: "https://x/a.jpg" });
    expect(captured?.url).toContain("/send-image");

    await provider.sendMedia({ to: "5511999999999", kind: "video", link: "https://x/a.mp4" });
    expect(captured?.url).toContain("/send-video");

    await provider.sendMedia({ to: "5511999999999", kind: "audio", link: "https://x/a.mp3" });
    expect(captured?.url).toContain("/send-audio");
  });

  it("sendMedia derives the document extension from the filename first", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "abc" }));
    await provider.sendMedia({
      to: "5511999999999",
      kind: "document",
      link: "https://x/download?id=1",
      filename: "report.xlsx",
    });
    expect(captured?.url).toContain("/send-document/xlsx");
  });

  it("sendMedia falls back to the link's extension when no filename is given", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "abc" }));
    await provider.sendMedia({
      to: "5511999999999",
      kind: "document",
      link: "https://x/report.pdf",
    });
    expect(captured?.url).toContain("/send-document/pdf");
  });

  it("sendReaction sends the emoji, and removes it when emoji is empty", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "abc" }));
    await provider.sendReaction({ to: "5511999999999", targetMessageId: "3EB0-x", emoji: "👍" });
    expect(captured?.url).toContain("/send-reaction");
    expect(captured?.body).toMatchObject({ reaction: "👍", messageId: "3EB0-x" });

    await provider.sendReaction({ to: "5511999999999", targetMessageId: "3EB0-x", emoji: "" });
    expect(captured?.url).toContain("/send-remove-reaction");
  });

  it("sendInteractiveButtons encodes each button as {id, label}", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "abc" }));
    await provider.sendInteractiveButtons({
      to: "5511999999999",
      bodyText: "Escolha:",
      buttons: [
        { id: "yes", title: "Sim" },
        { id: "no", title: "Não" },
      ],
    });
    expect(captured?.body).toMatchObject({
      buttonList: {
        buttons: [
          { id: "yes", label: "Sim" },
          { id: "no", label: "Não" },
        ],
      },
    });
  });

  it("sendInteractiveList flattens sections into one options array, folding the section title into each row's description", async () => {
    vi.stubGlobal("fetch", okFetch({ messageId: "abc" }));
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
      optionList: {
        buttonLabel: "Ver opções",
        options: [
          { id: "phones", title: "Smartphones", description: "Eletrônicos — Últimos lançamentos" },
          { id: "notes", title: "Notebooks", description: "Eletrônicos" },
        ],
      },
    });
  });
});
