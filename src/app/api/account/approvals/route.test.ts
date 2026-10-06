import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  adminFrom: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: "auth failed" }, { status: 403 })
  ),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: mocks.adminFrom,
  })),
}));

import { GET, POST } from "./route";

const context = {
  supabase: {},
  accountId: "account-flyorder",
  userId: "admin-1",
  role: "admin",
  account: { id: "account-flyorder", name: "Fly Order" },
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.adminFrom.mockReset();
  mocks.select.mockReset();
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.order.mockReset();

  mocks.requireRole.mockResolvedValue(context);
});

describe("/api/account/approvals", () => {
  it("GET lists all pending user signups", async () => {
    const fakePending = [
      {
        user_id: "user-pending-1",
        full_name: "Test Applicant",
        email: "applicant@example.com",
        avatar_url: null,
        created_at: "2026-10-06T12:00:00Z",
        approval_status: "pending",
      },
    ];

    mocks.adminFrom.mockReturnValue({
      select: mocks.select.mockReturnValue({
        eq: mocks.eq.mockReturnValue({
          order: mocks.order.mockResolvedValue({
            data: fakePending,
            error: null,
          }),
        }),
      }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingUsers).toHaveLength(1);
    expect(body.pendingUsers[0].email).toBe("applicant@example.com");
  });

  it("POST approves a pending user and assigns them to the workspace", async () => {
    mocks.adminFrom.mockReturnValue({
      update: mocks.update.mockReturnValue({
        eq: mocks.eq.mockResolvedValue({
          data: null,
          error: null,
        }),
      }),
    });

    const req = new Request("http://localhost/api/account/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-pending-1",
        action: "approve",
        role: "agent",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "account-flyorder",
        account_role: "agent",
        approval_status: "approved",
      })
    );
  });

  it("POST rejects a pending user registration", async () => {
    mocks.adminFrom.mockReturnValue({
      update: mocks.update.mockReturnValue({
        eq: mocks.eq.mockResolvedValue({
          data: null,
          error: null,
        }),
      }),
    });

    const req = new Request("http://localhost/api/account/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-pending-1",
        action: "reject",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        approval_status: "rejected",
      })
    );
  });

  it("POST returns 400 when userId is missing", async () => {
    const req = new Request("http://localhost/api/account/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
