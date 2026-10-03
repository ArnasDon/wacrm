import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  conditionSubject,
  contactHasTag,
  normalizeTagUuid,
  resolveTagIdForAccount,
  tagPresenceOperandRaw,
} from "./condition-tag-presence";

describe("conditionSubject", () => {
  it("defaults missing subject to tag_presence", () => {
    expect(conditionSubject({ subject: undefined as unknown as "tag_presence" })).toBe(
      "tag_presence",
    );
    expect(conditionSubject({ subject: "" as unknown as "tag_presence" })).toBe("tag_presence");
  });
});

describe("tagPresenceOperandRaw", () => {
  it("prefers operand over legacy value", () => {
    expect(
      tagPresenceOperandRaw({
        subject: "tag_presence",
        operand: "uuid-a",
        value: "uuid-b",
      }),
    ).toBe("uuid-a");
  });

  it("falls back to value when operand empty", () => {
    expect(
      tagPresenceOperandRaw({
        subject: "tag_presence",
        operand: "",
        value: "  test-tag-id  ",
      }),
    ).toBe("test-tag-id");
  });
});

describe("normalizeTagUuid", () => {
  it("accepts canonical UUIDs case-insensitively", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(normalizeTagUuid(id.toUpperCase())).toBe(id);
    expect(normalizeTagUuid("not-a-uuid")).toBeNull();
  });
});

describe("resolveTagIdForAccount", () => {
  const tagRow = { id: "550e8400-e29b-41d4-a716-446655440000" };

  function mockDb(handlers: {
    byId?: { data: { id: string } | null; error: null };
    byName?: { data: { id: string } | null; error: null };
  }) {
    return {
      from: (table: string) => {
        const filters: Record<string, unknown> = {};
        const chain = {
          select: () => chain,
          eq: (k: string, v: unknown) => {
            filters[k] = v;
            return chain;
          },
          ilike: (k: string, v: unknown) => {
            filters[k] = v;
            return chain;
          },
          maybeSingle: async () => {
            if (table !== "tags") return { data: null, error: null };
            if ("id" in filters && filters.id) return handlers.byId ?? { data: null, error: null };
            if ("name" in filters) return handlers.byName ?? { data: null, error: null };
            return { data: null, error: null };
          },
        };
        return chain;
      },
    };
  }

  it("resolves UUID operands scoped to account", async () => {
    const db = mockDb({ byId: { data: tagRow, error: null } });
    const id = await resolveTagIdForAccount(
      db as never,
      "acct",
      tagRow.id,
    );
    expect(id).toBe(tagRow.id);
  });

  it("resolves tag name when operand is not a UUID", async () => {
    const db = mockDb({ byName: { data: tagRow, error: null } });
    const id = await resolveTagIdForAccount(db as never, "acct", "test");
    expect(id).toBe(tagRow.id);
  });
});

describe("contactHasTag", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns present when count > 0", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ count: 1, error: null }),
          }),
        }),
      }),
    };
    await expect(
      contactHasTag(db as never, "contact-1", "tag-1"),
    ).resolves.toEqual({ present: true, count: 1 });
  });
});
