import { describe, expect, it } from "vitest";

import {
  createAsyncEventTrace,
  durationMs,
  eventTracePayload,
  extendAsyncEventTrace,
} from "./async-events";

describe("async event tracing", () => {
  it("creates and extends a stable trace", () => {
    const base = createAsyncEventTrace({
      route: "/api/whatsapp/webhook",
      eventId: "evt-1",
      accountId: "acct-1",
    });
    const extended = extendAsyncEventTrace(base, {
      contactId: "contact-1",
      conversationId: "conv-1",
      messageId: "msg-1",
    });

    expect(extended).toEqual({
      event_id: "evt-1",
      route: "/api/whatsapp/webhook",
      account_id: "acct-1",
      contact_id: "contact-1",
      conversation_id: "conv-1",
      message_id: "msg-1",
    });
  });

  it("injects event_id into persisted payloads", () => {
    const trace = createAsyncEventTrace({
      route: "/internal/flows",
      eventId: "evt-2",
    });

    expect(
      eventTracePayload(trace, {
        reason: "duplicate_inbound_replay",
      }),
    ).toEqual({
      event_id: "evt-2",
      reason: "duplicate_inbound_replay",
    });
  });

  it("never returns a negative duration", () => {
    expect(durationMs(Date.now() + 1_000)).toBe(0);
  });
});
