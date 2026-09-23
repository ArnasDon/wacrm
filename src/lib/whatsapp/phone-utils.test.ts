import { describe, expect, it } from "vitest";
import {
  isRecipientNotAllowedError,
  isValidE164,
  normalizePhone,
  parseInternationalPhone,
  phoneVariants,
  phonesMatch,
  sanitizePhoneForMeta,
} from "./phone-utils";

describe("sanitizePhoneForMeta", () => {
  it("strips +, spaces, and dashes leaving only digits", () => {
    expect(sanitizePhoneForMeta("+370 639 49836")).toBe("37063949836");
    expect(sanitizePhoneForMeta("+1 (415) 555-1212")).toBe("14155551212");
  });

  it("returns an empty string for falsy input", () => {
    expect(sanitizePhoneForMeta("")).toBe("");
    // Defensive: existing call sites occasionally pass through nullable
    // contact phones. The function early-returns on the falsy check.
    expect(sanitizePhoneForMeta(undefined as unknown as string)).toBe("");
  });

  it("is idempotent on already-sanitized input", () => {
    const cleaned = "14155551212";
    expect(sanitizePhoneForMeta(cleaned)).toBe(cleaned);
  });
});

describe("normalizePhone", () => {
  it("matches sanitizePhoneForMeta byte-for-byte (shared canonical form)", () => {
    const samples = ["+370 12345", "abc-555-DEF", "", "0044 7000 0000 0000"];
    for (const s of samples) {
      expect(normalizePhone(s)).toBe(sanitizePhoneForMeta(s));
    }
  });
});

describe("phonesMatch", () => {
  it("returns true for exact digit matches", () => {
    expect(phonesMatch("+37063949836", "37063949836")).toBe(true);
  });

  it("matches across trunk-prefix variants by last-8 fallback", () => {
    // Lithuanian trunk-0 variant. Last 8 digits ("63949836") collide.
    expect(phonesMatch("370063949836", "37063949836")).toBe(true);
  });

  it("rejects mismatched numbers", () => {
    expect(phonesMatch("+37063949836", "+37063949837")).toBe(false);
  });

  it("rejects very short inputs that would false-positive on tail match", () => {
    // Only 7 digits — the last-8 fallback is gated to len>=8 on both
    // sides to avoid declaring "12345" and "67890-12345" a match.
    expect(phonesMatch("1234567", "1234567")).toBe(true);
    expect(phonesMatch("1234567", "9991234567")).toBe(false);
  });

  it("ignores formatting noise on both sides", () => {
    expect(phonesMatch("+370 6 394 9836", "37063949836")).toBe(true);
    expect(phonesMatch("(415) 555-1212", "+1 415-555-1212")).toBe(true);
  });
});

describe("isValidE164", () => {
  it("accepts numbers 8–15 digits with optional + and non-zero start", () => {
    expect(isValidE164("+37063949836")).toBe(true);
    expect(isValidE164("37063949836")).toBe(true);
    expect(isValidE164("+12345678")).toBe(true); // 8 digits — lower bound
    expect(isValidE164("+123456789012345")).toBe(true); // 15 digits — upper bound
  });

  it("still accepts a national-format digit string — rejecting those is parseInternationalPhone's job", () => {
    // A stored/inbound digit string carries no country-code marker, so
    // "4155551212" is indistinguishable from a Swiss number here. Raw
    // input must go through parseInternationalPhone (issue #586).
    expect(isValidE164("4155551212")).toBe(true);
  });

  it("rejects numbers that start with 0 in international form", () => {
    expect(isValidE164("+0123456")).toBe(false);
    expect(isValidE164("0044700000000")).toBe(false);
  });

  it("rejects too-short and too-long inputs", () => {
    // 7 digits used to be the floor (E.164's theoretical minimum) but it
    // admitted most national formats; the floor is now 8 (issue #586).
    expect(isValidE164("+1234567")).toBe(false); // 7 digits
    expect(isValidE164("+123456")).toBe(false); // 6 digits
    expect(isValidE164("+1234567890123456")).toBe(false); // 16 digits
  });

  it("rejects strings with non-digit characters", () => {
    expect(isValidE164("+1-415-555-1212")).toBe(false);
    expect(isValidE164("+1 4155551212")).toBe(false);
    expect(isValidE164("abc12345678")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidE164("")).toBe(false);
  });
});

describe("parseInternationalPhone", () => {
  it("returns Meta's digits-only form for a + number, tolerating formatting", () => {
    expect(parseInternationalPhone("+14155551212")).toBe("14155551212");
    expect(parseInternationalPhone("+1 (415) 555-1212")).toBe("14155551212");
    expect(parseInternationalPhone("  +370 639.49836 ")).toBe("37063949836");
  });

  it("rejects national-format numbers with no country code", () => {
    expect(parseInternationalPhone("4155551212")).toBeNull(); // US national → would parse as +41 (CH)
    expect(parseInternationalPhone("07700900123")).toBeNull(); // UK national, trunk 0
    expect(parseInternationalPhone("9876543210")).toBeNull(); // 10-digit national → would parse as +98 (IR)
  });

  it("rejects digits that carry a country code but no + (the caller cannot tell)", () => {
    expect(parseInternationalPhone("14155551212")).toBeNull();
    expect(parseInternationalPhone("37063949836")).toBeNull();
  });

  it("rejects a + followed by an invalid digit string", () => {
    expect(parseInternationalPhone("+0123456789")).toBeNull(); // leading 0 after +
    expect(parseInternationalPhone("+1234567")).toBeNull(); // 7 digits — below the floor
    expect(parseInternationalPhone("++14155551212")).toBeNull();
    expect(parseInternationalPhone("+1415555abcd")).toBeNull();
    expect(parseInternationalPhone("+")).toBeNull();
  });

  it("returns null for empty and nullish input", () => {
    expect(parseInternationalPhone("")).toBeNull();
    expect(parseInternationalPhone("   ")).toBeNull();
    expect(parseInternationalPhone(null)).toBeNull();
    expect(parseInternationalPhone(undefined)).toBeNull();
  });

  it("agrees with normalizePhone for the numbers it accepts (shared dedupe key)", () => {
    // dedupeByPhone uses this as the key that must equal the DB's
    // phone_normalized (digits only) for `+` numbers.
    for (const s of ["+1 (415) 555-1212", "+370 639 49836"]) {
      expect(parseInternationalPhone(s)).toBe(normalizePhone(s));
    }
  });
});

describe("phoneVariants", () => {
  it("returns an empty list for empty input", () => {
    expect(phoneVariants("")).toEqual([]);
  });

  it("always lists the original number first", () => {
    const out = phoneVariants("37063949836");
    expect(out[0]).toBe("37063949836");
  });

  it("inserts a trunk 0 after each plausible country-code length", () => {
    // Input "37063949836" — CC-1 → "3" + "0" + "7063949836",
    //                       CC-3 → "370" + "0" + "63949836".
    // CC-2 is skipped because "063949836" already starts with 0.
    const out = phoneVariants("37063949836");
    expect(out).toEqual(
      expect.arrayContaining([
        "37063949836",
        "307063949836",
        "370063949836",
      ]),
    );
  });

  it("removes a leading 0 after the country code when present", () => {
    // Input "370063949836" — CC-2 strips one leading 0 from
    // "0063949836" → "37" + "063949836" = "37063949836". Only one zero
    // comes off per pass; that's what the live retry loop needs.
    const out = phoneVariants("370063949836");
    expect(out).toContain("370063949836");
    expect(out).toContain("37063949836");
  });

  it("deduplicates variants that collapse to the same digits", () => {
    const out = phoneVariants("37063949836");
    expect(new Set(out).size).toBe(out.length);
  });

  it("returns just the original when the number is too short for any CC slice", () => {
    // 1-char input is shorter than all ccLen values; both loops skip.
    expect(phoneVariants("1")).toEqual(["1"]);
  });
});

describe("isRecipientNotAllowedError", () => {
  it("matches Meta error code 131030", () => {
    expect(
      isRecipientNotAllowedError(
        "(#131030) Recipient phone number not in allowed list",
      ),
    ).toBe(true);
  });

  it("matches the human-readable English variants", () => {
    expect(isRecipientNotAllowedError("not in allowed list")).toBe(true);
    expect(isRecipientNotAllowedError("recipient not in the allowed list")).toBe(
      true,
    );
    // Case-insensitive on the human text.
    expect(isRecipientNotAllowedError("NOT IN ALLOWED LIST")).toBe(true);
  });

  it("does not false-positive on unrelated Meta errors", () => {
    expect(isRecipientNotAllowedError("(#100) Invalid parameter")).toBe(false);
    expect(isRecipientNotAllowedError("template name does not exist")).toBe(
      false,
    );
    expect(isRecipientNotAllowedError("")).toBe(false);
  });
});
