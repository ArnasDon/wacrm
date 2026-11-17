import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CONTACT_PICKER_LIMIT } from "@/lib/contacts/contact-picker";
import {
  findContactConversationId,
  searchNewConversationContacts,
} from "./new-conversation";

interface RecordedCall {
  method: string;
  args: unknown[];
}

function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const calls: RecordedCall[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "or"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = async () => {
    calls.push({ method: "maybeSingle", args: [] });
    return result;
  };
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  const db = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("searchNewConversationContacts", () => {
  it("lists the account's contacts, capped, without a search filter", async () => {
    const contacts = [{ id: "c1", name: "Ana", phone: "+1555" }];
    const { db, calls } = fakeDb({ data: contacts, error: null });

    const result = await searchNewConversationContacts(db, "acct-1", "");

    expect(result).toEqual(contacts);
    expect(calls).toContainEqual({ method: "from", args: ["contacts"] });
    expect(calls).toContainEqual({ method: "eq", args: ["account_id", "acct-1"] });
    expect(calls).toContainEqual({ method: "limit", args: [CONTACT_PICKER_LIMIT] });
    expect(calls.some((c) => c.method === "or")).toBe(false);
  });

  it("filters server-side by name and phone when searching", async () => {
    const { db, calls } = fakeDb({ data: [], error: null });

    await searchNewConversationContacts(db, "acct-1", "555");

    expect(calls).toContainEqual({
      method: "or",
      args: ["name.ilike.*555*,phone.ilike.*555*"],
    });
  });

  it("throws so the dialog can show its error and retry state", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom" } });

    await expect(
      searchNewConversationContacts(db, "acct-1", ""),
    ).rejects.toThrow("boom");
  });
});

describe("findContactConversationId", () => {
  it("returns the contact's existing conversation in the account", async () => {
    const { db, calls } = fakeDb({ data: { id: "conv-1" }, error: null });

    await expect(
      findContactConversationId(db, "acct-1", "contact-1"),
    ).resolves.toBe("conv-1");
    expect(calls).toContainEqual({ method: "from", args: ["conversations"] });
    expect(calls).toContainEqual({ method: "eq", args: ["account_id", "acct-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["contact_id", "contact-1"] });
  });

  it("returns null when the contact has no conversation yet", async () => {
    const { db } = fakeDb({ data: null, error: null });

    await expect(
      findContactConversationId(db, "acct-1", "contact-1"),
    ).resolves.toBeNull();
  });

  it("throws when the lookup fails", async () => {
    const { db } = fakeDb({ data: null, error: { message: "denied" } });

    await expect(
      findContactConversationId(db, "acct-1", "contact-1"),
    ).rejects.toThrow("denied");
  });
});
