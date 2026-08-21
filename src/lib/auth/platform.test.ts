import { afterEach, describe, expect, it, vi } from "vitest";

// requirePlatformAdmin() — the gate every /api/platform/* route and
// the /painel-a17c94fe2b6d page itself must pass. platform_admins has
// exactly one RLS policy (self-row-only SELECT — see migration 042),
// so this mock only ever needs to simulate "is there a row for THIS
// caller", never the full admin roster.

interface BuilderCall {
  table: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  adminRow: { data: unknown; error: unknown };
}) {
  const calls: BuilderCall[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(opts.adminRow);
      },
    };
    return builder;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { requirePlatformAdmin } = await import("./platform");
const { UnauthorizedError, ForbiddenError } = await import("./account");

afterEach(() => {
  vi.clearAllMocks();
});

describe("requirePlatformAdmin", () => {
  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({
      user: null,
      adminRow: { data: null, error: null },
    });
    createClient.mockReturnValue(client);

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError (403) for a regular authenticated user with no platform_admins row", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-regular" },
      adminRow: { data: null, error: null },
    });
    createClient.mockReturnValue(client);

    const err = await requirePlatformAdmin().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.status).toBe(403);
    // Scoped to the caller's own row — never an unscoped roster read.
    expect(calls[0].table).toBe("platform_admins");
    expect(calls[0].eqArgs).toEqual([["user_id", "user-regular"]]);
  });

  it("throws ForbiddenError when the lookup itself errors", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      adminRow: { data: null, error: { message: "boom" } },
    });
    createClient.mockReturnValue(client);

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves for a caller whose own row exists in platform_admins", async () => {
    const { client } = makeClient({
      user: { id: "user-admin" },
      adminRow: { data: { user_id: "user-admin" }, error: null },
    });
    createClient.mockReturnValue(client);

    const ctx = await requirePlatformAdmin();
    expect(ctx.userId).toBe("user-admin");
  });
});
