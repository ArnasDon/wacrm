import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_QUICK_REPLY_LIMITS,
  sendQuickReplies,
  sendTextMessage,
  sendMediaMessage,
  verifyIgAccount,
  getIgUserProfile,
} from "./api";

// Mirrors src/lib/whatsapp/meta-api.test.ts's approach: stub fetch to a
// never-resolving mock so a validation test that accidentally falls
// through to the network call hangs (and fails) rather than silently
// hitting graph.facebook.com.
const neverFetch = () =>
  new Promise<Response>(() => {
    /* intentionally never resolves */
  });

const BASE_ARGS = {
  igAccountId: "test-ig-account",
  accessToken: "test-token",
  to: "1234567890",
} as const;

describe("sendTextMessage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the recipient/message envelope to /{igAccountId}/messages", async () => {
    let captured: { url: string; body: unknown } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ message_id: "ig-msg-1" }), { status: 200 });
      }),
    );

    const result = await sendTextMessage({ ...BASE_ARGS, text: "Hi 👋" });

    expect(result).toEqual({ messageId: "ig-msg-1" });
    expect(captured).not.toBeNull();
    expect(captured!.url).toContain("/test-ig-account/messages");
    expect(captured!.body).toEqual({
      recipient: { id: "1234567890" },
      message: { text: "Hi 👋" },
    });
  });

  it("throws Meta's error message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid token" } }), { status: 401 })),
    );
    await expect(sendTextMessage({ ...BASE_ARGS, text: "Hi" })).rejects.toThrow("Invalid token");
  });
});

describe("sendMediaMessage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the 'document' kind to Instagram's 'file' attachment type", async () => {
    let captured: { body: unknown } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = { body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ message_id: "ig-msg-2" }), { status: 200 });
      }),
    );

    await sendMediaMessage({ ...BASE_ARGS, kind: "document", link: "https://x/y.pdf" });

    expect(captured!.body).toEqual({
      recipient: { id: "1234567890" },
      message: {
        attachment: { type: "file", payload: { url: "https://x/y.pdf", is_reusable: true } },
      },
    });
  });

  it("rejects a missing link before the network call", async () => {
    vi.stubGlobal("fetch", vi.fn(neverFetch));
    await expect(
      sendMediaMessage({ ...BASE_ARGS, kind: "image", link: "" }),
    ).rejects.toThrow(/requires a link/);
  });
});

describe("sendQuickReplies — validation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an empty options array", async () => {
    await expect(
      sendQuickReplies({ ...BASE_ARGS, text: "Pick one", quickReplies: [] }),
    ).rejects.toThrow(/1-13 options/);
  });

  it(`rejects more than ${INSTAGRAM_QUICK_REPLY_LIMITS.maxOptions} options (Meta cap)`, async () => {
    const quickReplies = Array.from({ length: INSTAGRAM_QUICK_REPLY_LIMITS.maxOptions + 1 }, (_, i) => ({
      title: `Option ${i}`,
      payload: `opt_${i}`,
    }));
    await expect(
      sendQuickReplies({ ...BASE_ARGS, text: "Pick one", quickReplies }),
    ).rejects.toThrow(/1-13 options/);
  });

  it("rejects a title longer than 20 chars (Meta cap)", async () => {
    await expect(
      sendQuickReplies({
        ...BASE_ARGS,
        text: "Pick one",
        quickReplies: [{ title: "x".repeat(INSTAGRAM_QUICK_REPLY_LIMITS.titleMaxLength + 1), payload: "p" }],
      }),
    ).rejects.toThrow(/exceeds 20 chars/);
  });

  it("rejects an option missing its payload", async () => {
    await expect(
      sendQuickReplies({
        ...BASE_ARGS,
        text: "Pick one",
        quickReplies: [{ title: "Yes", payload: "" }],
      }),
    ).rejects.toThrow(/missing payload/);
  });

  it("rejects empty text", async () => {
    await expect(
      sendQuickReplies({ ...BASE_ARGS, text: "", quickReplies: [{ title: "Yes", payload: "yes" }] }),
    ).rejects.toThrow(/requires text/);
  });

  it("sends the right payload shape when all inputs are valid", async () => {
    let captured: { body: unknown } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = { body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ message_id: "ig-msg-3" }), { status: 200 });
      }),
    );

    const result = await sendQuickReplies({
      ...BASE_ARGS,
      text: "Pick one",
      quickReplies: [
        { title: "Yes", payload: "yes" },
        { title: "No", payload: "no" },
      ],
    });

    expect(result).toEqual({ messageId: "ig-msg-3" });
    expect(captured!.body).toEqual({
      recipient: { id: "1234567890" },
      message: {
        text: "Pick one",
        quick_replies: [
          { content_type: "text", title: "Yes", payload: "yes" },
          { content_type: "text", title: "No", payload: "no" },
        ],
      },
    });
  });
});

describe("verifyIgAccount", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the account metadata on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: "ig-1", username: "acme_support" }), { status: 200 }),
      ),
    );
    const info = await verifyIgAccount({ igAccountId: "ig-1", accessToken: "tok" });
    expect(info).toEqual({ id: "ig-1", username: "acme_support" });
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth token" } }), { status: 401 })),
    );
    await expect(verifyIgAccount({ igAccountId: "ig-1", accessToken: "bad" })).rejects.toThrow(
      "Invalid OAuth token",
    );
  });
});

describe("getIgUserProfile — best-effort, never throws", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the profile on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ name: "Jane", username: "jane_ig" }), { status: 200 })),
    );
    const profile = await getIgUserProfile({ igsid: "igsid-1", accessToken: "tok" });
    expect(profile).toEqual({ name: "Jane", username: "jane_ig" });
  });

  it("returns null on a non-2xx response instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(getIgUserProfile({ igsid: "igsid-1", accessToken: "tok" })).resolves.toBeNull();
  });

  it("returns null when fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(getIgUserProfile({ igsid: "igsid-1", accessToken: "tok" })).resolves.toBeNull();
  });
});
