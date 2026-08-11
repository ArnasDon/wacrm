import { describe, expect, it } from "vitest";
import { resolveResponderColor } from "./responder-color";
import type { Profile } from "@/types";

function profile(full_name: string | null): Profile {
  return { full_name } as Profile;
}

describe("resolveResponderColor", () => {
  it("resolves Ronaldo to blue", () => {
    expect(resolveResponderColor(profile("Ronaldo Meira"))).toBe("blue");
  });

  it("resolves her real stored name, Thatianna Oliveira, to pink", () => {
    // Regression: a bare `includes("tati")` misses "Thatianna" — the
    // inserted "h" (t-h-a-t-i-...) breaks the substring run.
    expect(resolveResponderColor(profile("Thatianna Oliveira"))).toBe("pink");
  });

  it("resolves the shorter spelling, Tatiana, to pink too", () => {
    expect(resolveResponderColor(profile("Tatiana Souza"))).toBe("pink");
  });

  it("falls back to gray for an unrecognized profile", () => {
    expect(resolveResponderColor(profile("Someone Else"))).toBe("gray");
  });

  it("falls back to gray for a null/missing profile", () => {
    expect(resolveResponderColor(null)).toBe("gray");
    expect(resolveResponderColor(undefined)).toBe("gray");
  });
});
