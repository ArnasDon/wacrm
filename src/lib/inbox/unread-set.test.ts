import { describe, expect, it } from "vitest";
import { applyUnreadChange } from "./unread-set";

describe("applyUnreadChange", () => {
  it("adds a conversation that gains unread messages", () => {
    const ids = new Set<string>();
    applyUnreadChange(ids, { eventType: "INSERT", new: { id: "c1", unread_count: 2 } });
    expect([...ids]).toEqual(["c1"]);
  });

  it("removes a conversation once it is read", () => {
    const ids = new Set(["c1"]);
    applyUnreadChange(ids, { eventType: "UPDATE", new: { id: "c1", unread_count: 0 } });
    expect(ids.size).toBe(0);
  });

  it("removes a deleted conversation", () => {
    const ids = new Set(["c1", "c2"]);
    applyUnreadChange(ids, { eventType: "DELETE", old: { id: "c1" } });
    expect([...ids]).toEqual(["c2"]);
  });

  it("treats a null unread_count as read", () => {
    const ids = new Set(["c1"]);
    applyUnreadChange(ids, { eventType: "UPDATE", new: { id: "c1", unread_count: null } });
    expect(ids.size).toBe(0);
  });
});
