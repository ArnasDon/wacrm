import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  supabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/platform-admin", () => ({
  requirePlatformAdmin: mocks.requirePlatformAdmin,
}));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

import { POST } from "./route";

describe("POST /api/admin/accounts/[id]/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-platform admin", async () => {
    const ForbiddenError = (await import("@/lib/auth/account")).ForbiddenError;
    mocks.requirePlatformAdmin.mockRejectedValue(
      new ForbiddenError("Platform admin access required")
    );

    const request = new Request("http://localhost/api/admin/accounts/acc-1/users", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "password123" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "acc-1" }) });
    expect(response.status).toBe(403);
  });

  it("provisions user with provision_account_id metadata when authorized", async () => {
    mocks.requirePlatformAdmin.mockResolvedValue({ userId: "user-admin" });
    const mockCreateUser = vi.fn().mockResolvedValue({
      data: { user: { id: "new-user-id" } },
      error: null,
    });

    mocks.supabaseAdmin.mockReturnValue({
      auth: {
        admin: {
          createUser: mockCreateUser,
        },
      },
    });

    const request = new Request("http://localhost/api/admin/accounts/acc-1/users", {
      method: "POST",
      body: JSON.stringify({
        email: "agent@acme.com",
        password: "securepassword",
        full_name: "Agent Smith",
        role: "agent",
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "acc-1" }) });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.user_id).toBe("new-user-id");

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: "agent@acme.com",
      password: "securepassword",
      email_confirm: true,
      user_metadata: {
        full_name: "Agent Smith",
        provision_account_id: "acc-1",
        provision_role: "agent",
      },
    });
  });
});
