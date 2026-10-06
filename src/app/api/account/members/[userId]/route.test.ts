import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  adminFrom: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: any) =>
    Response.json({ error: err.message || "auth error" }, { status: 403 })
  ),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: mocks.adminFrom,
  })),
}));

import { DELETE, PATCH } from "./route";

const context = {
  supabase: {
    rpc: mocks.rpc,
  },
  accountId: "account-flyorder",
  userId: "admin-1",
  role: "owner",
  account: { id: "account-flyorder", name: "Fly Order" },
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.rpc.mockReset();
  mocks.adminFrom.mockReset();
  mocks.select.mockReset();
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.maybeSingle.mockReset();

  mocks.requireRole.mockResolvedValue(context);
});

describe("/api/account/members/[userId]", () => {
  it("PATCH changes a member role successfully", async () => {
    mocks.rpc.mockResolvedValue({ error: null });

    const req = new Request("http://localhost/api/account/members/user-2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "agent" }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ userId: "user-2" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("DELETE removes a member via RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: "new-acc-id", error: null });

    const req = new Request("http://localhost/api/account/members/user-2", {
      method: "DELETE",
    });

    const res = await DELETE(req, {
      params: Promise.resolve({ userId: "user-2" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("DELETE falls back to existing account if RPC throws unique constraint error (23505)", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "idx_accounts_one_per_owner"',
      },
    });

    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "existing-acc-123" }, error: null }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      }
      return {};
    });

    const req = new Request("http://localhost/api/account/members/user-2", {
      method: "DELETE",
    });

    const res = await DELETE(req, {
      params: Promise.resolve({ userId: "user-2" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.newPersonalAccountId).toBe("existing-acc-123");
  });
});
