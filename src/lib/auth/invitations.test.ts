import { describe, expect, it } from "vitest";
import {
  clampExpiryDays,
  DEFAULT_INVITE_EXPIRY_DAYS,
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  inviteUrl,
  MAX_INVITE_EXPIRY_DAYS,
} from "./invitations";

describe("generateInviteToken", () => {
  it("returns a 43-character base64url token (32 raw bytes)", () => {
    const { token } = generateInviteToken();
    expect(token).toHaveLength(43);
    // base64url alphabet: A-Z a-z 0-9 - _ (no +, /, or =)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a 64-char hex hash matching SHA-256 of the token", () => {
    const { token, hash } = generateInviteToken();
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).toBe(hashInviteToken(token));
  });

  it("produces distinct tokens across calls", () => {
    // 32 bytes of CSPRNG entropy — a collision in 1000 draws would
    // be a thermodynamic miracle. This is a sanity guard for "did
    // someone accidentally swap randomBytes for a constant?".
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateInviteToken().token);
    }
    expect(seen.size).toBe(1000);
  });
});

describe("hashInviteToken", () => {
  it("is deterministic for the same input", () => {
    expect(hashInviteToken("hello")).toBe(hashInviteToken("hello"));
  });

  it("differs for different inputs", () => {
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
  });

  it("matches a known SHA-256 hex digest", () => {
    // Known fixture — `sha256("invite-token-abc")` hex digest.
    // If this assertion ever flips, the hash function changed and
    // every stored token_hash in the DB is suddenly orphaned.
    expect(hashInviteToken("invite-token-abc")).toBe(
      "51481b404112f61a4e1171ff116d52068c429737863181bef089df7cb607352f",
    );
  });
});

describe("inviteUrl", () => {
  it("joins path correctly with no trailing slash", () => {
    expect(inviteUrl("abc", "https://wacrm.example")).toBe(
      "https://wacrm.example/join/abc",
    );
  });

  it("tolerates a trailing slash on baseUrl", () => {
    expect(inviteUrl("abc", "https://wacrm.example/")).toBe(
      "https://wacrm.example/join/abc",
    );
  });

  it("tolerates multiple trailing slashes", () => {
    expect(inviteUrl("abc", "https://wacrm.example///")).toBe(
      "https://wacrm.example/join/abc",
    );
  });

  it("preserves the entire token verbatim — including base64url symbols", () => {
    // The token may contain `-` and `_`. Both are URL-safe; the
    // function must NOT percent-encode them.
    expect(inviteUrl("a-b_c", "https://x")).toBe("https://x/join/a-b_c");
  });
});

describe("clampExpiryDays", () => {
  it("defaults to DEFAULT_INVITE_EXPIRY_DAYS when undefined", () => {
    expect(clampExpiryDays(undefined)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
  });

  it("defaults when given a non-finite value", () => {
    // Non-finite values (NaN, ±Infinity) are always programmer errors,
    // never legitimate input. We collapse them to the safe default
    // rather than to MAX — a buggy Infinity passing through and
    // silently producing a year-long invite would be worse than a
    // default 7-day one that the admin can re-issue.
    expect(clampExpiryDays(NaN)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
    expect(clampExpiryDays(Infinity)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
    expect(clampExpiryDays(-Infinity)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
  });

  it("rejects zero / negative", () => {
    expect(clampExpiryDays(0)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
    expect(clampExpiryDays(-5)).toBe(DEFAULT_INVITE_EXPIRY_DAYS);
  });

  it("clamps above MAX_INVITE_EXPIRY_DAYS", () => {
    expect(clampExpiryDays(99999)).toBe(MAX_INVITE_EXPIRY_DAYS);
  });

  it("passes valid values through", () => {
    expect(clampExpiryDays(1)).toBe(1);
    expect(clampExpiryDays(7)).toBe(7);
    expect(clampExpiryDays(30)).toBe(30);
  });

  it("floors fractional days", () => {
    expect(clampExpiryDays(7.9)).toBe(7);
  });
});

describe("inviteExpiresAt", () => {
  it("adds the requested days to `now`", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const out = inviteExpiresAt(7, now);
    expect(out.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("uses the default when expiresInDays is omitted", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const out = inviteExpiresAt(undefined, now);
    const expected = new Date(
      now.getTime() + DEFAULT_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(out.toISOString()).toBe(expected.toISOString());
  });

  it("respects the max clamp", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const out = inviteExpiresAt(99999, now);
    const expected = new Date(
      now.getTime() + MAX_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(out.toISOString()).toBe(expected.toISOString());
  });
});
