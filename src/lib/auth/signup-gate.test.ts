import { describe, expect, it } from "vitest";
import { shouldAllowSignup } from "./signup-gate";

describe("shouldAllowSignup", () => {
  it("blocks when there is no invite token", () => {
    expect(shouldAllowSignup(null)).toBe(false);
    expect(shouldAllowSignup(undefined)).toBe(false);
  });

  it("blocks when the invite token is an empty or whitespace string", () => {
    expect(shouldAllowSignup("")).toBe(false);
    expect(shouldAllowSignup("   ")).toBe(false);
  });

  it("allows when a non-empty invite token is present", () => {
    expect(shouldAllowSignup("abc123")).toBe(true);
    expect(shouldAllowSignup("  abc123  ")).toBe(true);
  });
});
