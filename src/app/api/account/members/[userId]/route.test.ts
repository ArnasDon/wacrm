import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  adminFrom: vi.fn(),
  deleteUser: vi.fn(),
  rpc: vi.fn(),
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
    auth: {
      admin: {
        deleteUser: mocks.deleteUser,
      },
    },
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
  mocks.adminFrom.mockReset();
  mocks.deleteUser.mockReset();
  mocks.rpc.mockReset();

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

  it("DELETE prevents self-removal", async () => {
    const req = new Request("http://localhost/api/account/members/admin-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, {
      params: Promise.resolve({ userId: "admin-1" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot remove yourself");
  });

  it("DELETE permanently removes member and deletes auth credentials", async () => {
    mocks.deleteUser.mockResolvedValue({ error: null });

    mocks.adminFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    account_id: "account-flyorder",
                    account_role: "agent",
                    full_name: "Test Agent",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "accounts") {
        return {
          delete: () => ({
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
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-2");
  });
});
