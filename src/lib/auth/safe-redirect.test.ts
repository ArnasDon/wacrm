import { describe, expect, it } from "vitest";
import { sanitizeNextPath, DEFAULT_SAFE_REDIRECT } from "./safe-redirect";

describe("sanitizeNextPath", () => {
  // AUTH-N1.4
  it("allows a plain internal path", () => {
    expect(sanitizeNextPath("/reset-password")).toBe("/reset-password");
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/join/abc123")).toBe("/join/abc123");
  });

  // AUTH-N1.5
  it("rejects an absolute external URL", () => {
    expect(sanitizeNextPath("https://evil.example")).toBe(
      DEFAULT_SAFE_REDIRECT,
    );
    expect(sanitizeNextPath("http://evil.example")).toBe(
      DEFAULT_SAFE_REDIRECT,
    );
  });

  it("rejects an external URL even when it looks path-shaped after the host", () => {
    expect(
      sanitizeNextPath("https://evil.example/reset-password"),
    ).toBe(DEFAULT_SAFE_REDIRECT);
  });

  // AUTH-N1.6
  it("rejects a protocol-relative URL", () => {
    expect(sanitizeNextPath("//evil.example")).toBe(DEFAULT_SAFE_REDIRECT);
    expect(sanitizeNextPath("//evil.example/reset-password")).toBe(
      DEFAULT_SAFE_REDIRECT,
    );
  });

  // AUTH-N1.7
  it("rejects any value containing a backslash", () => {
    expect(sanitizeNextPath("/\\evil.example")).toBe(DEFAULT_SAFE_REDIRECT);
    expect(sanitizeNextPath("\\\\evil.example")).toBe(DEFAULT_SAFE_REDIRECT);
    expect(sanitizeNextPath("/reset-password\\..\\evil")).toBe(
      DEFAULT_SAFE_REDIRECT,
    );
  });

  // AUTH-N1.8
  it("falls back to the default when next is absent, null, or empty", () => {
    expect(sanitizeNextPath(null)).toBe(DEFAULT_SAFE_REDIRECT);
    expect(sanitizeNextPath(undefined)).toBe(DEFAULT_SAFE_REDIRECT);
    expect(sanitizeNextPath("")).toBe(DEFAULT_SAFE_REDIRECT);
  });

  it("accepts a custom fallback", () => {
    expect(sanitizeNextPath(null, "/somewhere-else")).toBe(
      "/somewhere-else",
    );
    expect(sanitizeNextPath("https://evil.example", "/somewhere-else")).toBe(
      "/somewhere-else",
    );
  });

  it("rejects a value that doesn't start with a single leading slash", () => {
    expect(sanitizeNextPath("evil.example")).toBe(DEFAULT_SAFE_REDIRECT);
    expect(sanitizeNextPath("reset-password")).toBe(DEFAULT_SAFE_REDIRECT);
  });

  it("allows a path with query string / hash, still same-origin", () => {
    expect(sanitizeNextPath("/reset-password?foo=bar")).toBe(
      "/reset-password?foo=bar",
    );
    expect(sanitizeNextPath("/dashboard#section")).toBe("/dashboard#section");
  });
});
