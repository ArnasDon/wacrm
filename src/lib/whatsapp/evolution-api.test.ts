import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendEvolutionText,
  sendEvolutionMedia,
} from "./evolution-api";

const BASE_ARGS = {
  apiUrl: "http://localhost:8080",
  instanceName: "pablo_crm",
  apiKey: "secret-apikey",
  to: "+5547999998888",
} as const;

// A fetch stub that records the call and returns a canned OK response.
// Typed args so `mock.calls[0]` reads back as [url, RequestInit].
function okFetch(json: unknown = { key: { id: "wamid.EVO123" } }) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const headersOf = (init: RequestInit) =>
  init.headers as Record<string, string>;
const bodyOf = (init: RequestInit) => JSON.parse(init.body as string);

describe("sendEvolutionText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /message/sendText/{instance} with the apikey header", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEvolutionText({ ...BASE_ARGS, text: "Olá!" });

    expect(result.messageId).toBe("wamid.EVO123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/message/sendText/pablo_crm");
    expect(init.method).toBe("POST");
    expect(headersOf(init).apikey).toBe("secret-apikey");
  });

  it("strips the '+' and separators from the recipient number", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await sendEvolutionText({ ...BASE_ARGS, to: "+55 (47) 99999-8888", text: "hi" });

    const body = bodyOf(fetchMock.mock.calls[0][1]);
    expect(body.number).toBe("5547999998888");
    expect(body.text).toBe("hi");
  });

  it("trims a trailing slash on the base URL", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await sendEvolutionText({
      ...BASE_ARGS,
      apiUrl: "http://localhost:8080/",
      text: "hi",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:8080/message/sendText/pablo_crm",
    );
  });

  it("throws with the server detail on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("instance not found", { status: 404 })),
    );

    await expect(
      sendEvolutionText({ ...BASE_ARGS, text: "hi" }),
    ).rejects.toThrow(/Evolution API error: 404: instance not found/);
  });

  it("returns an empty messageId when the server omits key.id", async () => {
    vi.stubGlobal("fetch", okFetch({ status: "PENDING" }));

    const result = await sendEvolutionText({ ...BASE_ARGS, text: "hi" });
    expect(result.messageId).toBe("");
  });
});

describe("sendEvolutionMedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends image/video/document via /message/sendMedia with mediatype", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await sendEvolutionMedia({
      ...BASE_ARGS,
      kind: "image",
      link: "https://cdn.example.com/pic.jpg",
      caption: "look",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/message/sendMedia/pablo_crm");
    const body = bodyOf(init);
    expect(body.mediatype).toBe("image");
    expect(body.media).toBe("https://cdn.example.com/pic.jpg");
    expect(body.caption).toBe("look");
  });

  it("sets fileName only for documents", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await sendEvolutionMedia({
      ...BASE_ARGS,
      kind: "document",
      link: "https://cdn.example.com/invoice.pdf",
      filename: "invoice.pdf",
    });

    const body = bodyOf(fetchMock.mock.calls[0][1]);
    expect(body.fileName).toBe("invoice.pdf");
  });

  it("routes audio to /message/sendWhatsAppAudio and never sends a caption", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await sendEvolutionMedia({
      ...BASE_ARGS,
      kind: "audio",
      link: "https://cdn.example.com/note.ogg",
      caption: "ignored",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://localhost:8080/message/sendWhatsAppAudio/pablo_crm",
    );
    const body = bodyOf(init);
    expect(body.audio).toBe("https://cdn.example.com/note.ogg");
    expect(body.caption).toBeUndefined();
  });

  it("throws when called without a link", async () => {
    vi.stubGlobal("fetch", okFetch());
    await expect(
      sendEvolutionMedia({ ...BASE_ARGS, kind: "image", link: "" }),
    ).rejects.toThrow(/requires a link/);
  });
});
