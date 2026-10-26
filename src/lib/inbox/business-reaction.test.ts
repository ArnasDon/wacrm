import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageReaction } from "@/types";
import {
  businessReactionOn,
  groupReactions,
  removeBusinessReaction,
  setBusinessReaction,
  withBusinessReaction,
} from "./business-reaction";

function reaction(overrides: Partial<MessageReaction>): MessageReaction {
  return {
    id: "r1",
    message_id: "m1",
    conversation_id: "c1",
    actor_type: "agent",
    actor_id: "agent-a",
    emoji: "👍",
    created_at: "2026-10-16T10:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-10-16T11:00:00.000Z");

describe("withBusinessReaction", () => {
  it("replaces another agent's reaction instead of adding a second one", () => {
    const next = withBusinessReaction([reaction({})], {
      messageId: "m1",
      conversationId: "c1",
      userId: "agent-b",
      emoji: "❤️",
      now: NOW,
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ actor_id: "agent-b", emoji: "❤️" });
    expect(next[0].id.startsWith("temp-")).toBe(true);
  });

  it("swaps the emoji in place when the same agent reacts again", () => {
    const next = withBusinessReaction([reaction({})], {
      messageId: "m1",
      conversationId: "c1",
      userId: "agent-a",
      emoji: "🎉",
      now: NOW,
    });
    expect(next).toEqual([reaction({ emoji: "🎉" })]);
  });

  it("removing clears the business reaction whoever set it, keeping the customer's", () => {
    const customer = reaction({ id: "r2", actor_type: "customer", actor_id: "contact-1" });
    const next = withBusinessReaction([reaction({}), customer], {
      messageId: "m1",
      conversationId: "c1",
      userId: "agent-b",
      emoji: "",
      now: NOW,
    });
    expect(next).toEqual([customer]);
  });

  it("leaves other messages untouched", () => {
    const other = reaction({ id: "r3", message_id: "m2" });
    const next = withBusinessReaction([other], {
      messageId: "m1",
      conversationId: "c1",
      userId: "agent-a",
      emoji: "👍",
      now: NOW,
    });
    expect(next).toContain(other);
    expect(next).toHaveLength(2);
  });
});

describe("businessReactionOn / groupReactions", () => {
  it("finds the agent row and marks its pill as the business's", () => {
    const rows = [
      reaction({}),
      reaction({ id: "r2", actor_type: "customer", actor_id: "contact-1" }),
    ];
    expect(businessReactionOn(rows, "m1")?.id).toBe("r1");
    expect(groupReactions(rows)).toEqual([{ emoji: "👍", count: 2, byBusiness: true }]);
    expect(groupReactions([rows[1]])).toEqual([{ emoji: "👍", count: 1, byBusiness: false }]);
  });
});

function reactionsDb(upsertErrors: ({ message: string; code?: string } | null)[]) {
  const calls: { op: string; filters: [string, string, unknown][] }[] = [];
  const chain = (op: string) => {
    const call = { op, filters: [] as [string, string, unknown][] };
    calls.push(call);
    const builder = {
      eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), builder),
      neq: (c: string, v: unknown) => (call.filters.push(["neq", c, v]), builder),
      then: (resolve: (r: { error: null }) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return builder;
  };
  const db = {
    from: () => ({
      delete: () => chain("delete"),
      upsert: async () => {
        calls.push({ op: "upsert", filters: [] });
        return { error: upsertErrors.shift() ?? null };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("setBusinessReaction / removeBusinessReaction", () => {
  it("clears other agents' rows before saving this agent's", async () => {
    const { db, calls } = reactionsDb([null]);
    const error = await setBusinessReaction(db, { messageId: "m1", conversationId: "c1" }, "agent-b", "❤️");
    expect(error).toBeNull();
    expect(calls.map((c) => c.op)).toEqual(["delete", "upsert"]);
    expect(calls[0].filters).toEqual([
      ["eq", "message_id", "m1"],
      ["eq", "actor_type", "agent"],
      ["neq", "actor_id", "agent-b"],
    ]);
  });

  it("retries once when a concurrent agent won the one-per-message index", async () => {
    const { db, calls } = reactionsDb([{ message: "dup", code: "23505" }, null]);
    const error = await setBusinessReaction(db, { messageId: "m1", conversationId: "c1" }, "agent-b", "❤️");
    expect(error).toBeNull();
    expect(calls.map((c) => c.op)).toEqual(["delete", "upsert", "delete", "upsert"]);
  });

  it("removal deletes every agent row on the message", async () => {
    const { db, calls } = reactionsDb([]);
    await removeBusinessReaction(db, "m1");
    expect(calls[0].filters).toEqual([
      ["eq", "message_id", "m1"],
      ["eq", "actor_type", "agent"],
    ]);
  });
});
