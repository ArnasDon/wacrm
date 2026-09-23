import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BODY_MAX_CHARS,
  BROWSER_NOTIFY_STORAGE_KEY,
  DEDUPE_WINDOW_MS,
  DEFAULT_NOTIFICATION_LABELS,
  buildNotificationContent,
  conversationHref,
  getNotificationPermission,
  pickContactDisplayName,
  readBrowserNotifyPref,
  shouldNotifyForMessage,
  truncateBody,
  viewedConversationFromLocation,
  writeBrowserNotifyPref,
  type NotifiableMessage,
} from "./browser-notify";

const NOW = new Date("2026-09-13T10:00:00.000Z").getTime();

function customerMsg(over: Partial<NotifiableMessage> = {}): NotifiableMessage {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_type: "customer",
    content_type: "text",
    content_text: "Hi, is the blue one still in stock?",
    ...over,
  };
}

describe("shouldNotifyForMessage", () => {
  it("notifies for a customer message when the tab is hidden", () => {
    const seen = new Map<string, number>();
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: false,
        viewingConversationId: "c1",
        seen,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("notifies when visible but a different conversation is open", () => {
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: "other",
        seen: new Map(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("notifies when visible on a non-inbox page (no conversation open)", () => {
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: null,
        seen: new Map(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("stays silent when the user is already viewing that conversation", () => {
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: "c1",
        seen: new Map(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("ignores agent and bot messages", () => {
    for (const sender_type of ["agent", "bot"] as const) {
      const seen = new Map<string, number>();
      expect(
        shouldNotifyForMessage(customerMsg({ sender_type }), {
          documentVisible: false,
          viewingConversationId: null,
          seen,
          now: NOW,
        }),
      ).toBe(false);
      // Our own sends never enter the dedupe map.
      expect(seen.size).toBe(0);
    }
  });

  it("dedupes a replayed INSERT for the same id inside the window", () => {
    const seen = new Map<string, number>();
    const opts = { documentVisible: false, viewingConversationId: null, seen };
    expect(shouldNotifyForMessage(customerMsg(), { ...opts, now: NOW })).toBe(true);
    expect(
      shouldNotifyForMessage(customerMsg(), { ...opts, now: NOW + 1_000 }),
    ).toBe(false);
    // A different message id is unaffected.
    expect(
      shouldNotifyForMessage(customerMsg({ id: "m2" }), { ...opts, now: NOW + 1_000 }),
    ).toBe(true);
  });

  it("forgets an id once the dedupe window has passed", () => {
    const seen = new Map<string, number>();
    const opts = { documentVisible: false, viewingConversationId: null, seen };
    shouldNotifyForMessage(customerMsg(), { ...opts, now: NOW });
    expect(
      shouldNotifyForMessage(customerMsg(), {
        ...opts,
        now: NOW + DEDUPE_WINDOW_MS + 1,
      }),
    ).toBe(true);
    // The stale entry was pruned rather than accumulating forever.
    expect(seen.size).toBe(1);
  });

  it("keeps a suppressed message suppressed if it replays after the user leaves", () => {
    const seen = new Map<string, number>();
    // First arrival: user is looking at the thread -> silent.
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: "c1",
        seen,
        now: NOW,
      }),
    ).toBe(false);
    // Replay 2s later after switching tabs: still the same message.
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: false,
        viewingConversationId: null,
        seen,
        now: NOW + 2_000,
      }),
    ).toBe(false);
  });
});

describe("buildNotificationContent", () => {
  it("uses the contact name as title and the text as body", () => {
    expect(buildNotificationContent(customerMsg(), "Ada Lovelace")).toEqual({
      title: "Ada Lovelace",
      body: "Hi, is the blue one still in stock?",
    });
  });

  it("falls back to a generic title without a contact name", () => {
    expect(buildNotificationContent(customerMsg(), null).title).toBe(
      DEFAULT_NOTIFICATION_LABELS.fallbackTitle,
    );
    expect(buildNotificationContent(customerMsg(), "   ").title).toBe(
      DEFAULT_NOTIFICATION_LABELS.fallbackTitle,
    );
  });

  it("describes media types in plain words", () => {
    const cases: [NotifiableMessage["content_type"], string][] = [
      ["image", "📷 Photo"],
      ["audio", "🎤 Voice message"],
      ["video", "🎬 Video"],
      ["document", "📄 Document"],
      ["location", "📍 Location"],
      ["template", "📋 Template"],
    ];
    for (const [content_type, label] of cases) {
      expect(
        buildNotificationContent(
          customerMsg({ content_type, content_text: null }),
          "Ada",
        ).body,
      ).toBe(label);
    }
  });

  it("appends a media caption after the descriptor", () => {
    expect(
      buildNotificationContent(
        customerMsg({ content_type: "image", content_text: "the receipt" }),
        "Ada",
      ).body,
    ).toBe("📷 Photo · the receipt");
  });

  it("uses the tapped option text for interactive replies", () => {
    expect(
      buildNotificationContent(
        customerMsg({ content_type: "interactive", content_text: "Yes, book it" }),
        "Ada",
      ).body,
    ).toBe("Yes, book it");
  });

  it("accepts caller-supplied (translated) labels", () => {
    const labels = {
      ...DEFAULT_NOTIFICATION_LABELS,
      fallbackTitle: "새 메시지",
      audio: "🎤 음성 메시지",
    };
    const out = buildNotificationContent(
      customerMsg({ content_type: "audio", content_text: null }),
      null,
      labels,
    );
    expect(out).toEqual({ title: "새 메시지", body: "🎤 음성 메시지" });
  });

  it("truncates long bodies to roughly the limit", () => {
    const long = "word ".repeat(60).trim(); // 299 chars
    const { body } = buildNotificationContent(
      customerMsg({ content_text: long }),
      "Ada",
    );
    expect(body.length).toBeLessThanOrEqual(BODY_MAX_CHARS + 1);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("truncateBody", () => {
  it("returns short text untouched apart from whitespace collapsing", () => {
    expect(truncateBody("  hello\n\nworld  ")).toBe("hello world");
  });

  it("cuts on a word boundary when one is near the limit", () => {
    const text = `${"a".repeat(100)} ${"b".repeat(50)}`;
    expect(truncateBody(text)).toBe(`${"a".repeat(100)}…`);
  });

  it("hard-cuts a single giant token", () => {
    const text = "x".repeat(400);
    expect(truncateBody(text)).toBe(`${"x".repeat(BODY_MAX_CHARS)}…`);
  });
});

describe("pickContactDisplayName", () => {
  it("prefers name, then @username, then phone", () => {
    expect(
      pickContactDisplayName({ name: "Ada", wa_username: "ada", phone: "+1" }),
    ).toBe("Ada");
    expect(pickContactDisplayName({ name: "", wa_username: "ada", phone: "+1" })).toBe(
      "@ada",
    );
    expect(pickContactDisplayName({ name: null, wa_username: null, phone: "+1" })).toBe(
      "+1",
    );
  });

  it("returns null when nothing is usable", () => {
    expect(pickContactDisplayName(null)).toBeNull();
    expect(pickContactDisplayName({ name: " ", wa_username: "", phone: "" })).toBeNull();
  });
});

describe("viewedConversationFromLocation", () => {
  it("reads ?c= only on the inbox route", () => {
    expect(viewedConversationFromLocation("/inbox", "?c=abc")).toBe("abc");
    expect(viewedConversationFromLocation("/inbox/", "?c=abc")).toBe("abc");
    expect(viewedConversationFromLocation("/inbox", "")).toBeNull();
    expect(viewedConversationFromLocation("/dashboard", "?c=abc")).toBeNull();
    expect(viewedConversationFromLocation("/inbox-archive", "?c=abc")).toBeNull();
  });
});

describe("conversationHref", () => {
  it("matches the inbox deep-link param", () => {
    expect(conversationHref("c1")).toBe("/inbox?c=c1");
  });
});

describe("browser-only helpers without a window", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("report unsupported / off during SSR", () => {
    expect(typeof window).toBe("undefined");
    expect(getNotificationPermission()).toBe("unsupported");
    expect(readBrowserNotifyPref()).toBe(false);
    expect(() => writeBrowserNotifyPref(true)).not.toThrow();
  });

  it("round-trip the preference through localStorage when a window exists", () => {
    const store = new Map<string, string>();
    const events: string[] = [];
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: (e: { type: string }) => {
        events.push(e.type);
        return true;
      },
    });
    vi.stubGlobal("Event", class { constructor(public type: string) {} });

    expect(readBrowserNotifyPref()).toBe(false);
    writeBrowserNotifyPref(true);
    expect(store.get(BROWSER_NOTIFY_STORAGE_KEY)).toBe("1");
    expect(readBrowserNotifyPref()).toBe(true);
    writeBrowserNotifyPref(false);
    expect(store.has(BROWSER_NOTIFY_STORAGE_KEY)).toBe(false);
    expect(readBrowserNotifyPref()).toBe(false);
    expect(events).toHaveLength(2);
  });

  it("report unsupported when window lacks Notification", () => {
    vi.stubGlobal("window", {});
    expect(getNotificationPermission()).toBe("unsupported");
  });
});
