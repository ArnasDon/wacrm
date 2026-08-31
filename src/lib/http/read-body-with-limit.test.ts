import { describe, it, expect } from "vitest";
import { readBodyWithLimit } from "./read-body-with-limit";

function requestWithBody(body: string, withContentLength = true): Request {
  const headers: Record<string, string> = {};
  if (withContentLength) {
    headers["content-length"] = String(new TextEncoder().encode(body).length);
  }
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers,
    body,
  });
}

describe("readBodyWithLimit", () => {
  it("returns the body text when under the limit", async () => {
    const result = await readBodyWithLimit(requestWithBody("hello"), 1024);
    expect(result).toEqual({ ok: true, text: "hello" });
  });

  it("rejects via Content-Length before reading the stream", async () => {
    const body = "x".repeat(2000);
    const result = await readBodyWithLimit(requestWithBody(body), 1024);
    expect(result).toEqual({ ok: false });
  });

  it("rejects a body that exceeds the limit even without Content-Length", async () => {
    // Simulates a chunked-transfer request where Content-Length is absent —
    // the streaming byte-count guard has to catch this on its own.
    const body = "x".repeat(2000);
    const result = await readBodyWithLimit(
      requestWithBody(body, /* withContentLength */ false),
      1024,
    );
    expect(result).toEqual({ ok: false });
  });

  it("accepts a body exactly at the limit", async () => {
    const body = "x".repeat(1024);
    const result = await readBodyWithLimit(requestWithBody(body), 1024);
    expect(result).toEqual({ ok: true, text: body });
  });

  it("handles multi-byte UTF-8 text correctly", async () => {
    const body = "olá mundo 🎉";
    const result = await readBodyWithLimit(requestWithBody(body), 1024);
    expect(result).toEqual({ ok: true, text: body });
  });
});
