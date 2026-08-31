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

import { GET } from "./route";

describe("GET /api/admin/accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when user is not a platform admin", async () => {
    const ForbiddenError = (await import("@/lib/auth/account")).ForbiddenError;
    mocks.requirePlatformAdmin.mockRejectedValue(
      new ForbiddenError("Platform admin access required")
    );

    const response = await GET();
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Platform admin access required");
  });

  it("returns accounts list with member count and whatsapp status when authorized", async () => {
    mocks.requirePlatformAdmin.mockResolvedValue({ userId: "user-admin" });

    const mockAccounts = [
      {
        id: "acc-1",
        name: "Acme Corp",
        created_at: "2026-08-01T00:00:00Z",
        owner_user_id: "user-owner-1",
      },
      {
        id: "acc-2",
        name: "Beta Ltd",
        created_at: "2026-08-02T00:00:00Z",
        owner_user_id: "user-owner-2",
      },
    ];

    const mockProfiles = [
      { account_id: "acc-1" },
      { account_id: "acc-1" },
      { account_id: "acc-2" },
    ];

    const mockWaConfigs = [
      { account_id: "acc-1", status: "connected" },
    ];

    mocks.supabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "accounts") {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: mockAccounts, error: null }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: mockProfiles, error: null }),
            }),
          };
        }
        if (table === "whatsapp_config") {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: mockWaConfigs, error: null }),
            }),
          };
        }
        return {};
      },
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.accounts).toHaveLength(2);

    expect(data.accounts[0]).toEqual({
      id: "acc-1",
      name: "Acme Corp",
      created_at: "2026-08-01T00:00:00Z",
      owner_user_id: "user-owner-1",
      member_count: 2,
      whatsapp_status: "connected",
    });

    expect(data.accounts[1]).toEqual({
      id: "acc-2",
      name: "Beta Ltd",
      created_at: "2026-08-02T00:00:00Z",
      owner_user_id: "user-owner-2",
      member_count: 1,
      whatsapp_status: "disconnected",
    });
  });
});
