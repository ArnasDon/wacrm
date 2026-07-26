import { describe, expect, it, vi } from "vitest";

import {
  MAX_HTTP_RESPONSE_BYTES,
  assertAuthorableHttpUrl,
  executeHttpRequest,
  isPrivateOrReservedIp,
  sanitizeHttpHeaders,
} from "./http-request";

describe("HTTP request authoring guard", () => {
  it.each([
    "ftp://example.com/file",
    "http://user:secret@example.com",
    "https://example.com/path#fragment",
    "http://localhost/a",
    "http://127.0.0.1/a",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1",
    "http://[::1]/",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => assertAuthorableHttpUrl(url)).toThrow();
  });

  it("accepts a public http(s) URL without credentials or fragment", () => {
    expect(assertAuthorableHttpUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1",
    );
  });
});

describe("HTTP request runtime guard", () => {
  it("recognizes private, loopback, link-local, CGNAT, documentation and multicast ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:a9fe:a9fe",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
      "2001:db8::1",
      "3fff::1",
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateOrReservedIp("2001:4860:4860::8888")).toBe(false);
  });

  it.each([
    [303, "PUT", "GET"],
    [301, "POST", "GET"],
    [302, "POST", "GET"],
    [307, "POST", "POST"],
    [308, "POST", "POST"],
  ])("applies redirect method semantics for %i", async (status, initial, next) => {
    let cancelled = 0;
    const redirectBody = new ReadableStream({
      cancel() {
        cancelled += 1;
      },
    });
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(redirectBody, {
          status,
          headers: { location: "https://public.example/next" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "content-type": "text/plain" } }),
      );
    await executeHttpRequest(
      {
        method: initial as "POST" | "PUT",
        url: "https://public.example/start",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "2",
          "X-Trace": "ok",
        },
        body: "{}",
        response_var: "result",
      },
      { lookup: async () => ["93.184.216.34"], transport },
    );
    const redirected = transport.mock.calls[1][2]!;
    expect(redirected.method).toBe(next);
    expect(redirected.body).toBe(next === "GET" ? undefined : "{}");
    if (next === "GET") {
      expect(new Headers(redirected.headers).has("content-type")).toBe(false);
      expect(new Headers(redirected.headers).has("content-length")).toBe(false);
    }
    expect(cancelled).toBe(1);
  });

  it("checks DNS before fetching and every redirect hop", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://internal.example/secret" },
        }),
      );
    const lookup = vi.fn(async (host: string) =>
      host === "public.example" ? ["93.184.216.34"] : ["10.1.2.3"],
    );

    await expect(
      executeHttpRequest(
        {
          method: "GET",
          url: "https://public.example/start",
          headers: {},
          response_var: "result",
        },
        { transport, lookup },
      ),
    ).rejects.toThrow("not publicly routable");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      "https://public.example/start",
      "93.184.216.34",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("pins each connection to the address returned by the validated lookup", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    const transport = vi.fn(async () =>
      new Response("ok", { headers: { "content-type": "text/plain" } }),
    );

    await executeHttpRequest(
      {
        method: "GET",
        url: "https://public.example/data",
        headers: {},
        response_var: "result",
      },
      { lookup, transport },
    );

    expect(transport).toHaveBeenCalledWith(
      "https://public.example/data",
      "93.184.216.34",
      expect.objectContaining({
        headers: expect.objectContaining({ Host: "public.example" }),
      }),
    );
  });

  it("strips credentials when a redirect changes origin", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example/next" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "content-type": "text/plain" } }),
      );

    await executeHttpRequest(
      {
        method: "GET",
        url: "https://public.example/start",
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
          "X-Api-Key": "secret",
          "X-Trace": "safe",
        },
        response_var: "result",
      },
      {
        lookup: async () => ["93.184.216.34"],
        transport,
      },
    );

    const redirectedHeaders = transport.mock.calls[1][2]?.headers;
    expect(redirectedHeaders).toMatchObject({ "X-Trace": "safe" });
    expect(redirectedHeaders).not.toHaveProperty("Authorization");
    expect(redirectedHeaders).not.toHaveProperty("Cookie");
    expect(redirectedHeaders).not.toHaveProperty("X-Api-Key");
  });

  it("rejects oversized and unsupported responses", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    const tooLarge = new Uint8Array(MAX_HTTP_RESPONSE_BYTES + 1);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(tooLarge, {
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      executeHttpRequest(
        {
          method: "GET",
          url: "https://public.example/data",
          headers: {},
          response_var: "result",
        },
        { transport: fetcher, lookup },
      ),
    ).rejects.toThrow("response is too large");

    fetcher.mockResolvedValue(
      new Response("binary", {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    await expect(
      executeHttpRequest(
        {
          method: "GET",
          url: "https://public.example/data",
          headers: {},
          response_var: "result",
        },
        { transport: fetcher, lookup },
      ),
    ).rejects.toThrow("unsupported content type");
  });

  it("supports abort and returns typed output without leaking secrets", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    const fetcher = vi.fn(
      async (_url: string, _address: string, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const controller = new AbortController();
    const pending = executeHttpRequest(
      {
        method: "POST",
        url: "https://public.example/data",
        headers: { Authorization: "Bearer secret", "X-Trace": "ok" },
        body: "{}",
        response_var: "result",
      },
      { transport: fetcher, lookup, signal: controller.signal },
    );
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(sanitizeHttpHeaders({ Authorization: "secret", Cookie: "x", X: "y" }))
      .toEqual({ Authorization: "[REDACTED]", Cookie: "[REDACTED]", X: "y" });
  });

  it("returns json/text/status output", async () => {
    const output = await executeHttpRequest(
      {
        method: "GET",
        url: "https://public.example/data",
        headers: {},
        response_var: "result",
      },
      {
        lookup: async () => ["93.184.216.34"],
        transport: async () =>
          new Response('{"answer":42}', {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    expect(output).toEqual({
      status: 201,
      body: { answer: 42 },
      content_type: "application/json",
    });
  });

  it("treats non-success responses as execution failures", async () => {
    await expect(
      executeHttpRequest(
        {
          method: "GET",
          url: "https://public.example/data",
          headers: {},
          response_var: "result",
        },
        {
          lookup: async () => ["93.184.216.34"],
          transport: async () =>
            new Response('{"error":"busy"}', {
              status: 503,
              headers: { "content-type": "application/json" },
            }),
        },
      ),
    ).rejects.toThrow("status 503");
  });
});
