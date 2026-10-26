import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import {
  applyMessageUpdate,
  applyRealtimeInsert,
  confirmedSendUpdate,
  isTempMessage,
  mergeFetchedPage,
  newTempMessageId,
  prependOlderMessages,
} from "./optimistic-messages";

function msg(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    conversation_id: "conv-1",
    sender_type: "agent",
    content_type: "text",
    content_text: id,
    status: "sent",
    created_at: "2026-05-18T10:00:00.000Z",
    ...overrides,
  };
}

const ids = (list: Message[]) => list.map((m) => m.id);

describe("newTempMessageId", () => {
  it("is unique within the same millisecond and recognised as temp", () => {
    const a = newTempMessageId(1);
    const b = newTempMessageId(1);
    expect(a).not.toBe(b);
    expect(isTempMessage({ id: a })).toBe(true);
    expect(isTempMessage({ id: "real-1" })).toBe(false);
  });
});

describe("applyRealtimeInsert", () => {
  it("replaces only the pending temp that matches the inserted row", () => {
    const prev = [
      msg("temp-1", { content_text: "hello", status: "sending" }),
      msg("temp-2", { content_text: "other", status: "sending" }),
    ];
    const next = applyRealtimeInsert(prev, msg("real-1", { content_text: "hello" }));
    expect(ids(next)).toEqual(["temp-2", "real-1"]);
  });

  it("keeps failed temp bubbles even when content matches", () => {
    const prev = [msg("temp-1", { content_text: "hello", status: "failed" })];
    const next = applyRealtimeInsert(prev, msg("real-1", { content_text: "hello" }));
    expect(ids(next)).toEqual(["temp-1", "real-1"]);
  });

  it("keeps temps when a customer message arrives", () => {
    const prev = [msg("temp-1", { content_text: "hello", status: "sending" })];
    const next = applyRealtimeInsert(
      prev,
      msg("in-1", { sender_type: "customer", content_text: "hello" }),
    );
    expect(ids(next)).toEqual(["temp-1", "in-1"]);
  });

  it("does not match a temp of a different content type", () => {
    const prev = [msg("temp-1", { content_type: "image", content_text: "x", status: "sending" })];
    const next = applyRealtimeInsert(prev, msg("real-1", { content_text: "x" }));
    expect(ids(next)).toEqual(["temp-1", "real-1"]);
  });

  it("ignores duplicate inserts", () => {
    const prev = [msg("real-1")];
    expect(applyRealtimeInsert(prev, msg("real-1"))).toBe(prev);
  });
});

describe("confirmedSendUpdate", () => {
  it("carries the persisted row id from the send response", () => {
    expect(confirmedSendUpdate({ success: true, message_id: "real-1" })).toEqual({
      status: "sent",
      id: "real-1",
    });
  });

  it("only flips the status when the response has no id", () => {
    expect(confirmedSendUpdate({})).toEqual({ status: "sent" });
    expect(confirmedSendUpdate(null)).toEqual({ status: "sent" });
  });
});

describe("applyMessageUpdate", () => {
  it("swaps a temp id for the confirmed row id", () => {
    const prev = [msg("temp-1", { status: "sending" })];
    const next = applyMessageUpdate(prev, "temp-1", { id: "real-1", status: "sent" });
    expect(next).toEqual([msg("real-1", { content_text: "temp-1", status: "sent" })]);
  });

  it("drops the temp when realtime already delivered the confirmed row", () => {
    const prev = [msg("real-1"), msg("temp-1", { status: "sending" })];
    const next = applyMessageUpdate(prev, "temp-1", { id: "real-1", status: "sent" });
    expect(ids(next)).toEqual(["real-1"]);
  });

  it("patches status without an id change", () => {
    const prev = [msg("temp-1", { status: "sending" })];
    expect(applyMessageUpdate(prev, "temp-1", { status: "failed" })[0].status).toBe("failed");
  });
});

describe("mergeFetchedPage", () => {
  const at = (minute: number) => `2026-05-18T10:${String(minute).padStart(2, "0")}:00.000Z`;

  it("keeps failed and still-pending temps after a resync", () => {
    const prev = [
      msg("real-1", { created_at: at(1) }),
      msg("temp-failed", { content_text: "lost", status: "failed", created_at: at(2) }),
      msg("temp-pending", { content_text: "wait", status: "sending", created_at: at(3) }),
    ];
    const fetched = [msg("real-1", { created_at: at(1) })];
    expect(ids(mergeFetchedPage(prev, fetched, "conv-1"))).toEqual([
      "real-1",
      "temp-failed",
      "temp-pending",
    ]);
  });

  it("drops a pending temp once the fetched page contains its row", () => {
    const prev = [msg("temp-1", { content_text: "hi", status: "sent", created_at: at(5) })];
    const fetched = [msg("real-9", { content_text: "hi", created_at: at(5) })];
    expect(ids(mergeFetchedPage(prev, fetched, "conv-1"))).toEqual(["real-9"]);
  });

  it("does not let an old identical message consume a new pending temp", () => {
    const prev = [msg("temp-1", { content_text: "ok", status: "sending", created_at: at(30) })];
    const fetched = [msg("real-old", { content_text: "ok", created_at: at(1) })];
    expect(ids(mergeFetchedPage(prev, fetched, "conv-1"))).toEqual(["real-old", "temp-1"]);
  });

  it("keeps older loaded pages when the newest page overlaps them", () => {
    const prev = [
      msg("old-1", { created_at: at(1) }),
      msg("old-2", { created_at: at(2) }),
      msg("mid-3", { created_at: at(3) }),
    ];
    const fetched = [msg("mid-3", { created_at: at(3) }), msg("new-4", { created_at: at(4) })];
    expect(ids(mergeFetchedPage(prev, fetched, "conv-1"))).toEqual([
      "old-1",
      "old-2",
      "mid-3",
      "new-4",
    ]);
  });

  it("drops older pages when the newest page does not connect to them", () => {
    const prev = [msg("old-1", { created_at: at(1) })];
    const fetched = [msg("new-8", { created_at: at(8) }), msg("new-9", { created_at: at(9) })];
    expect(ids(mergeFetchedPage(prev, fetched, "conv-1"))).toEqual(["new-8", "new-9"]);
  });

  it("keeps a realtime row that landed after the fetch ran", () => {
    const prev = [msg("a", { created_at: at(1) }), msg("late", { created_at: at(9) })];
    const fetched = [msg("a", { created_at: at(1) })];
    expect(ids(mergeFetchedPage(prev, fetched, "conv-1"))).toEqual(["a", "late"]);
  });

  it("ignores local messages from another conversation", () => {
    const prev = [msg("temp-x", { conversation_id: "conv-2", status: "failed" })];
    expect(ids(mergeFetchedPage(prev, [msg("a")], "conv-1"))).toEqual(["a"]);
  });
});

describe("prependOlderMessages", () => {
  it("prepends unseen older rows and skips boundary duplicates", () => {
    const prev = [msg("b"), msg("c")];
    expect(ids(prependOlderMessages(prev, [msg("a"), msg("b")]))).toEqual(["a", "b", "c"]);
  });

  it("returns the same list when nothing is new", () => {
    const prev = [msg("a")];
    expect(prependOlderMessages(prev, [msg("a")])).toBe(prev);
  });
});
