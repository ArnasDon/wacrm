import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadFlowCodeCatalog } from "./flow-code-server";

function query(data: unknown[]) {
  const result = { data, error: null };
  return {
    select() {
      return this;
    },
    eq() {
      return Promise.resolve(result);
    },
    in() {
      return Promise.resolve(result);
    },
  };
}

describe("flow code server catalog", () => {
  it("enumerates only account-scoped assets with opaque ids", async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        { name: "welcome.png" },
        { name: "../escape.png" },
        { name: "nested/file.png" },
      ],
      error: null,
    });
    const getPublicUrl = vi.fn((path: string) => ({
      data: { publicUrl: `https://storage.example.test/${path}` },
    }));
    const fromStorage = vi.fn(() => ({ list, getPublicUrl }));
    const admin = {
      from: vi.fn((table: string) =>
        query(
          table === "tags"
            ? [{ id: "tag-1", name: "VIP" }]
            : [],
        ),
      ),
      storage: { from: fromStorage },
    } as unknown as SupabaseClient;

    const catalog = await loadFlowCodeCatalog(
      admin,
      "11111111-1111-4111-8111-111111111111",
    );
    const asset = catalog.resources.find((resource) => resource.kind === "asset");

    expect(fromStorage).toHaveBeenCalledWith("flow-media");
    expect(list).toHaveBeenCalledWith(
      "account-11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ limit: 500 }),
    );
    expect(asset).toEqual(
      expect.objectContaining({
        kind: "asset",
        name: "welcome.png",
        runtimeValue:
          "https://storage.example.test/account-11111111-1111-4111-8111-111111111111/welcome.png",
      }),
    );
    expect(asset?.id).toMatch(/^asset:[a-f0-9]{64}$/);
    expect(catalog.resources.filter((resource) => resource.kind === "asset")).toHaveLength(
      1,
    );
  });
});
