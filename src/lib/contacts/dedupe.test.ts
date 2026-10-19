import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
  pickBestPhoneMatch,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "+1 (555) 1111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows without a leading + (no country code), counted as invalid", () => {
    // "4155551212" is a US national number to the person who exported the
    // CSV, but Meta would deliver it to +41 (Switzerland). Refusing it here
    // is the bulk-import half of issue #586.
    const { unique, duplicates, invalid } = dedupeByPhone([
      { phone: "4155551212", name: "national" },
      { phone: "+14155551212", name: "international" },
      { phone: "14155551212", name: "digits with CC but no +" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["international"]);
    expect(duplicates).toBe(0);
    expect(invalid).toBe(2);
  });

  it("drops rows with no digits, counted as invalid rather than duplicate", () => {
    const { unique, duplicates, invalid } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(0);
    expect(invalid).toBe(1);
  });
});

describe("findExistingContact", () => {
  function stubDb(rows: Array<{ id: string; phone: string }>) {
    const calls: { column: string; values: string[] }[] = [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: (column: string, values: string[]) => {
        calls.push({ column, values });
        return Promise.resolve({ data: rows, error: null });
      },
    };
    const db = { from: () => builder } as unknown as SupabaseClient;
    return { db, calls };
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const { db } = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
  });

  it("looks candidates up by the exact number and its trunk variants", async () => {
    const { db, calls } = stubDb([]);
    await findExistingContact(db, "acct", "+370 63949836");
    expect(calls).toHaveLength(1);
    expect(calls[0].column).toBe("phone_normalized");
    expect(calls[0].values).toContain("37063949836");
    expect(calls[0].values).toContain("370063949836");
  });

  it("prefers the exact contact over an earlier trunk-variant candidate", async () => {
    const { db } = stubDb([
      { id: "fuzzy", phone: "370063949836" },
      { id: "exact", phone: "37063949836" },
    ]);
    const hit = await findExistingContact(db, "acct", "+37063949836");
    expect(hit?.id).toBe("exact");
  });

  it("does not return a Chicago contact for a New York number", async () => {
    const { db } = stubDb([{ id: "nyc", phone: "12125551234" }]);
    expect(await findExistingContact(db, "acct", "+13125551234")).toBeNull();
  });

  it("does not return a +1 contact for a +44 number with the same subscriber digits", async () => {
    const { db } = stubDb([{ id: "us", phone: "12125551234" }]);
    expect(await findExistingContact(db, "acct", "+442125551234")).toBeNull();
  });

  it("returns null when no candidate matches", async () => {
    const { db } = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const { db, calls } = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("pickBestPhoneMatch", () => {
  it("maps an inbound number without trunk 0 to a contact stored with it", () => {
    const hit = pickBestPhoneMatch(
      [{ id: "stored", phone: "370063949836" }],
      "37063949836",
    );
    expect(hit?.id).toBe("stored");
  });

  it("maps an inbound number with trunk 0 to a contact stored without it", () => {
    const hit = pickBestPhoneMatch(
      [{ id: "stored", phone: "37063949836" }],
      "370063949836",
    );
    expect(hit?.id).toBe("stored");
  });

  it("returns null for numbers that only share the last 8 digits", () => {
    expect(
      pickBestPhoneMatch([{ id: "nyc", phone: "12125551234" }], "13125551234"),
    ).toBeNull();
  });
});
