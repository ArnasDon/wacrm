import { describe, expect, it } from "vitest";
import {
  reduceCallEvent,
  type ExistingCallRow,
  type WhatsAppCallEvent,
} from "./call-events";

const NOW = "2026-06-24T10:00:00.000Z";

function connectEvent(over: Partial<WhatsAppCallEvent> = {}): WhatsAppCallEvent {
  return {
    id: "wacid.ABC",
    from: "919812345678",
    to: "14155550100",
    event: "connect",
    direction: "USER_INITIATED",
    timestamp: "1750759200", // 2025-06-24T10:00:00.000Z
    session: { sdp_type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0..." },
    ...over,
  };
}

describe("reduceCallEvent — connect (inbound first sight)", () => {
  it("creates a ringing inbound row and captures the SDP offer", () => {
    const patch = reduceCallEvent(connectEvent(), null, NOW);
    expect(patch.direction).toBe("inbound");
    expect(patch.status).toBe("ringing");
    expect(patch.meta_call_id).toBe("wacid.ABC");
    expect(patch.sdp_type).toBe("offer");
    expect(patch.offer_sdp).toContain("v=0");
    expect(patch.started_at).toBe("2025-06-24T10:00:00.000Z");
  });

  it("infers sdp_type=offer when only an sdp string is present", () => {
    const patch = reduceCallEvent(
      connectEvent({ session: { sdp: "v=0..." } }),
      null,
      NOW,
    );
    expect(patch.sdp_type).toBe("offer");
  });

  it("falls back to now when timestamp is missing/garbage", () => {
    const patch = reduceCallEvent(
      connectEvent({ timestamp: undefined }),
      null,
      NOW,
    );
    expect(patch.started_at).toBe(NOW);
  });

  it("marks BUSINESS_INITIATED events as outbound", () => {
    const patch = reduceCallEvent(
      connectEvent({ direction: "BUSINESS_INITIATED" }),
      null,
      NOW,
    );
    expect(patch.direction).toBe("outbound");
  });
});

describe("reduceCallEvent — terminate", () => {
  it("an answered call completes with a computed duration", () => {
    const existing: ExistingCallRow = {
      status: "connected",
      started_at: "2026-06-24T09:59:00.000Z",
      answered_at: "2026-06-24T09:59:30.000Z",
    };
    const patch = reduceCallEvent(
      { id: "wacid.ABC", from: "919812345678", event: "terminate", timestamp: undefined },
      existing,
      NOW, // ended now → 30s after answered_at
    );
    expect(patch.status).toBe("completed");
    expect(patch.ended_at).toBe(NOW);
    expect(patch.duration_seconds).toBe(30);
  });

  it("prefers Meta's explicit duration when provided", () => {
    const existing: ExistingCallRow = {
      status: "connected",
      answered_at: "2026-06-24T09:59:30.000Z",
    };
    const patch = reduceCallEvent(
      { id: "wacid.ABC", from: "9198", event: "terminate", duration: 42 },
      existing,
      NOW,
    );
    expect(patch.duration_seconds).toBe(42);
  });

  it("an unanswered ringing call that ends is missed", () => {
    const existing: ExistingCallRow = { status: "ringing", started_at: NOW };
    const patch = reduceCallEvent(
      { id: "wacid.ABC", from: "9198", event: "terminate" },
      existing,
      NOW,
    );
    expect(patch.status).toBe("missed");
    expect(patch.duration_seconds).toBeNull();
  });

  it("maps a reject/decline reason to declined", () => {
    const existing: ExistingCallRow = { status: "ringing" };
    const patch = reduceCallEvent(
      {
        id: "wacid.ABC",
        from: "9198",
        event: "terminate",
        status_info: { reason: "USER_REJECTED" },
      },
      existing,
      NOW,
    );
    expect(patch.status).toBe("declined");
    expect(patch.end_reason).toBe("USER_REJECTED");
  });

  it("maps an error reason to failed", () => {
    const patch = reduceCallEvent(
      { id: "wacid.ABC", from: "9198", event: "terminate", status: "connection_error" },
      { status: "ringing" },
      NOW,
    );
    expect(patch.status).toBe("failed");
  });

  it("handles terminate with no prior row (very short call) by stamping started_at", () => {
    const patch = reduceCallEvent(
      { id: "wacid.ABC", from: "9198", event: "terminate" },
      null,
      NOW,
    );
    expect(patch.status).toBe("missed");
    expect(patch.started_at).toBe(NOW);
    expect(patch.ended_at).toBe(NOW);
  });
});
