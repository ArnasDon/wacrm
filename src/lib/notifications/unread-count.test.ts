import { describe, expect, it } from "vitest";
import { notificationsAccountFilter, unreadCountChange } from "./unread-count";

const ACCOUNT = "acc-current";
const OTHER = "acc-previous";

describe("notificationsAccountFilter", () => {
  it("scopes realtime changes to the current account", () => {
    expect(notificationsAccountFilter(ACCOUNT)).toBe("account_id=eq.acc-current");
  });
});

describe("unreadCountChange", () => {
  it("counts an unread insert for the current account", () => {
    expect(
      unreadCountChange({ eventType: "INSERT", new: { account_id: ACCOUNT }, old: {} }, ACCOUNT),
    ).toEqual({ kind: "delta", delta: 1 });
  });

  it("ignores an insert that belongs to another account", () => {
    expect(
      unreadCountChange({ eventType: "INSERT", new: { account_id: OTHER }, old: {} }, ACCOUNT),
    ).toEqual({ kind: "delta", delta: 0 });
  });

  it("ignores an insert that is already read", () => {
    expect(
      unreadCountChange(
        { eventType: "INSERT", new: { account_id: ACCOUNT, read_at: "2026-10-16T00:00:00Z" }, old: {} },
        ACCOUNT,
      ),
    ).toEqual({ kind: "delta", delta: 0 });
  });

  it("decrements when a current-account notification is marked read", () => {
    expect(
      unreadCountChange(
        { eventType: "UPDATE", new: { account_id: ACCOUNT, read_at: "2026-10-16T00:00:00Z" }, old: {} },
        ACCOUNT,
      ),
    ).toEqual({ kind: "delta", delta: -1 });
  });

  it("ignores a read update from another account", () => {
    expect(
      unreadCountChange(
        { eventType: "UPDATE", new: { account_id: OTHER, read_at: "2026-10-16T00:00:00Z" }, old: {} },
        ACCOUNT,
      ),
    ).toEqual({ kind: "delta", delta: 0 });
  });

  it("refetches on delete because the old row only carries its primary key", () => {
    expect(
      unreadCountChange({ eventType: "DELETE", new: {}, old: { id: "n1" } }, ACCOUNT),
    ).toEqual({ kind: "refetch" });
  });
});
