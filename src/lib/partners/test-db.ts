// ============================================================
// Test-only in-memory stand-in for the Supabase client, just rich
// enough for the Partners routes: select / insert / update / delete
// with eq / in / lte / ilike filters, maybeSingle / single, rpc and
// auth.admin. Filters are really applied, so ownership scoping is
// exercised rather than assumed.
// ============================================================

/* eslint-disable @typescript-eslint/no-unused-vars -- mock params exist only to type `toHaveBeenCalledWith` */
import { vi } from "vitest";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface FakeDbOptions {
  tables: Record<string, Row[]>;
  /** Signed-in user for `auth.getUser()` (session client). */
  sessionUserId?: string | null;
}

export function createFakeDb({ tables, sessionUserId = null }: FakeDbOptions) {
  let idSeq = 0;
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
    data: null as unknown,
    error: null as unknown,
  }));
  const admin = {
    createUser: vi.fn(async (_attrs: Record<string, unknown>) => ({
      data: { user: { id: "new-user-id" } } as { user: { id: string } | null },
      error: null as null | { message: string; code?: string },
    })),
    deleteUser: vi.fn(async (_id: string) => ({ data: null, error: null })),
    updateUserById: vi.fn(async (_id: string, _attrs: Record<string, unknown>) => ({
      data: null,
      error: null as null | { message: string },
    })),
  };

  function from(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | null = null;
    let limitN: number | null = null;

    const run = () => {
      const rows = (tables[table] ??= []);
      if (op === "insert") {
        const row: Row = { id: `id-${++idSeq}`, created_at: new Date().toISOString(), ...payload };
        if (
          table === "partner_invitations" &&
          row.status === "PENDING" &&
          rows.some((r) => r.status === "PENDING" && r.email === row.email)
        ) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows.push(row);
        return { data: [row], error: null };
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") matched.forEach((r) => Object.assign(r, payload));
      if (op === "delete") tables[table] = rows.filter((r) => !matched.includes(r));
      if (limitN !== null) matched = matched.slice(0, limitN);
      return { data: matched, error: null };
    };

    const builder = {
      select: () => builder,
      insert: (p: Row) => ((op = "insert"), (payload = p), builder),
      update: (p: Row) => ((op = "update"), (payload = p), builder),
      delete: () => ((op = "delete"), builder),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), builder),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), builder),
      ilike: (c: string, v: string) => (
        filters.push((r) => String(r[c]).toLowerCase() === v.replace(/\\(.)/g, "$1").toLowerCase()),
        builder
      ),
      order: () => builder,
      limit: (n: number) => ((limitN = n), builder),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error: error ?? (data?.length ? null : { code: "PGRST116" }) };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }

  return {
    tables,
    rpc,
    admin,
    client: {
      from,
      rpc,
      auth: {
        admin,
        getUser: async () => ({
          data: { user: sessionUserId ? { id: sessionUserId } : null },
          error: null,
        }),
      },
    },
  };
}
