import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BRAND_TITLE } from "./brand";

// getBrand feeds the dashboard's <title> and favicon. The invariant
// this file guards: it must NEVER throw and must NEVER use a PostgREST
// embed. A throw here breaks the page render for a decoration; an
// embed reintroduces issue #294, where a stale schema cache took down
// the whole account context.

interface SelectCall {
  table: string;
  columns?: string;
  limit?: number;
}

function makeClient(opts: {
  data?: unknown;
  error?: unknown;
  throwOnFrom?: boolean;
}) {
  const calls: SelectCall[] = [];

  const from = (table: string) => {
    if (opts.throwOnFrom) throw new Error("connection refused");
    const call: SelectCall = { table };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      limit(n: number) {
        call.limit = n;
        return Promise.resolve({
          data: opts.data ?? null,
          error: opts.error ?? null,
        });
      },
    };
    return builder;
  };

  return { calls, client: { from } };
}

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

// `cache()` memoises per request; in tests there is no request scope,
// so React's cache is a passthrough. Reset the module registry between
// cases anyway so one case cannot observe another's result.
async function loadGetBrand() {
  vi.resetModules();
  const mod = await import("./server");
  return mod.getBrand;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getBrand", () => {
  it("returns the account's brand on the happy path", async () => {
    const { client } = makeClient({
      data: [{ brand_name: "Acme", logo_url: "https://x/logo.png" }],
    });
    createClientMock.mockResolvedValue(client);

    const getBrand = await loadGetBrand();
    expect(await getBrand()).toEqual({
      title: "Acme",
      logoUrl: "https://x/logo.png",
      isCustom: true,
    });
  });

  it("falls back to the generic brand when the query errors", async () => {
    // This is the migration-not-yet-applied window: PostgREST answers
    // 42703 for `brand_name` until its schema cache reloads.
    const { client } = makeClient({
      error: { code: "42703", message: "column accounts.brand_name does not exist" },
    });
    createClientMock.mockResolvedValue(client);

    const getBrand = await loadGetBrand();
    expect(await getBrand()).toEqual({
      title: DEFAULT_BRAND_TITLE,
      logoUrl: null,
      isCustom: false,
    });
  });

  it("falls back when there is no session (RLS returns no rows)", async () => {
    const { client } = makeClient({ data: [] });
    createClientMock.mockResolvedValue(client);

    const getBrand = await loadGetBrand();
    expect((await getBrand()).title).toBe(DEFAULT_BRAND_TITLE);
  });

  it("falls back rather than guessing when RLS returns several rows", async () => {
    const { client } = makeClient({
      data: [{ brand_name: "A" }, { brand_name: "B" }],
    });
    createClientMock.mockResolvedValue(client);

    const getBrand = await loadGetBrand();
    expect((await getBrand()).title).toBe(DEFAULT_BRAND_TITLE);
  });

  it("never throws, even when the client itself blows up", async () => {
    createClientMock.mockRejectedValue(new Error("no cookie store"));

    const getBrand = await loadGetBrand();
    await expect(getBrand()).resolves.toEqual({
      title: DEFAULT_BRAND_TITLE,
      logoUrl: null,
      isCustom: false,
    });
  });

  it("never throws when the query builder blows up mid-chain", async () => {
    const { client } = makeClient({ throwOnFrom: true });
    createClientMock.mockResolvedValue(client);

    const getBrand = await loadGetBrand();
    await expect(getBrand()).resolves.toMatchObject({
      title: DEFAULT_BRAND_TITLE,
    });
  });

  it("reads accounts with a flat select and no embed (issue #294)", async () => {
    const { calls, client } = makeClient({ data: [{ brand_name: "Acme" }] });
    createClientMock.mockResolvedValue(client);

    const getBrand = await loadGetBrand();
    await getBrand();

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("accounts");
    // An embed would look like `accounts!inner(...)` — the paren is the
    // tell, and it is what a stale schema cache cannot resolve.
    expect(calls[0].columns).not.toContain("(");
    expect(calls[0].limit).toBe(2);
  });

  it("does not call auth.getUser (RLS is the boundary, not a round trip)", async () => {
    const getUser = vi.fn();
    const { client } = makeClient({ data: [{ brand_name: "Acme" }] });
    createClientMock.mockResolvedValue({ ...client, auth: { getUser } });

    const getBrand = await loadGetBrand();
    await getBrand();

    expect(getUser).not.toHaveBeenCalled();
  });
});
