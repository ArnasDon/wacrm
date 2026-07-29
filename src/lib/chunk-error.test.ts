import { describe, it, expect } from "vitest";
import { isChunkLoadError } from "./chunk-error";

describe("isChunkLoadError", () => {
  it("recognizes webpack's ChunkLoadError", () => {
    const err = new Error("Loading chunk 42 failed.");
    err.name = "ChunkLoadError";
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("recognizes a failed dynamic import (Chromium wording)", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://x/y.js"))).toBe(true);
  });

  it("recognizes a failed dynamic import (Safari wording)", () => {
    expect(isChunkLoadError(new Error("Importing a module script failed"))).toBe(true);
  });

  it("does not misclassify an unrelated error", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
  });

  it("handles non-Error values without throwing", () => {
    expect(isChunkLoadError("Loading chunk 3 failed.")).toBe(true);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
