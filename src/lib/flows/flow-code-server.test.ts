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
    const list = vi.fn(async (_prefix: string, options: { offset?: number }) => ({
      data:
        options.offset === 0
          ? [
              { name: "welcome.png" },
              { name: "../escape.png" },
              { name: "nested/file.png" },
            ]
          : [],
      error: null,
    }));
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

  it("paginates account assets and includes only account-member legacy paths", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      name: `${index}.png`,
    }));
    const list = vi.fn(
      async (prefix: string, options: { offset?: number }) => {
        if (prefix.startsWith("account-")) {
          return {
            data: options.offset === 0 ? firstPage : [{ name: "500.png" }],
            error: null,
          };
        }
        if (prefix === "member-1") {
          return {
            data: options.offset === 0 ? [{ name: "legacy.png" }] : [],
            error: null,
          };
        }
        throw new Error(`unexpected prefix ${prefix}`);
      },
    );
    const bucket = {
      list,
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://storage.example.test/${path}` },
      }),
    };
    const admin = {
      from: vi.fn((table: string) =>
        query(
          table === "profiles"
            ? [{ user_id: "member-1", full_name: "Member" }]
            : [],
        ),
      ),
      storage: { from: () => bucket },
    } as unknown as SupabaseClient;

    const catalog = await loadFlowCodeCatalog(admin, "account-1");
    const assets = catalog.resources.filter(
      (resource) => resource.kind === "asset",
    );

    expect(list).toHaveBeenCalledWith(
      "account-account-1",
      expect.objectContaining({ offset: 500 }),
    );
    expect(list).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ offset: 0 }),
    );
    expect(assets).toHaveLength(502);
    expect(assets.map(({ runtimeValue }) => runtimeValue)).toContain(
      "https://storage.example.test/member-1/legacy.png",
    );
    expect(
      list.mock.calls.some(([prefix]) => prefix === "foreign-member"),
    ).toBe(false);
  });
});
