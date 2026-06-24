import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manageCall } from "./meta-api";

// A 200 OK fetch mock that records the request so we can assert the
// body/URL the call-control helper produced.
function okFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ messaging_product: "whatsapp", calls: [{ id: "wacid.X" }] }),
      // surface what was sent for assertions
      __init: init,
    } as unknown as Response;
  });
}

const BASE = {
  phoneNumberId: "PHONE_ID",
  accessToken: "TOKEN",
  callId: "wacid.X",
} as const;

function lastBody(fetchMock: ReturnType<typeof okFetch>) {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("manageCall", () => {
  let fetchMock: ReturnType<typeof okFetch>;
  beforeEach(() => {
    fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the /calls endpoint with bearer auth", async () => {
    await manageCall({ ...BASE, action: "terminate" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/PHONE_ID/calls");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
  });

  it("accept carries the SDP answer with sdp_type=answer", async () => {
    await manageCall({ ...BASE, action: "accept", sdp: "v=0-answer" });
    const body = lastBody(fetchMock);
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      call_id: "wacid.X",
      action: "accept",
      session: { sdp_type: "answer", sdp: "v=0-answer" },
    });
  });

  it("pre_accept also carries the SDP answer", async () => {
    await manageCall({ ...BASE, action: "pre_accept", sdp: "v=0-pre" });
    const body = lastBody(fetchMock);
    expect(body.action).toBe("pre_accept");
    expect(body.session.sdp).toBe("v=0-pre");
  });

  it("reject/terminate omit the session block", async () => {
    await manageCall({ ...BASE, action: "reject" });
    expect(lastBody(fetchMock).session).toBeUndefined();
  });

  it("throws (before fetch) when accept is missing its SDP", async () => {
    // never reaches fetch — but stubbed anyway so a regression would hit the mock
    await expect(manageCall({ ...BASE, action: "accept" })).rejects.toThrow(
      /requires an SDP answer/,
    );
  });
});
