import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));

import { isPlatformAdmin, requirePlatformAdmin } from "./platform-admin";
import { ForbiddenError, UnauthorizedError } from "./account";

describe("platform-admin auth helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isPlatformAdmin returns false when user is unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await isPlatformAdmin();
    expect(result).toBe(false);
  });

  it("isPlatformAdmin returns false when user is not in platform_admins table", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-regular" } } });
    mocks.from.mockImplementation((table: string) => {
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const result = await isPlatformAdmin();
    expect(result).toBe(false);
  });

  it("isPlatformAdmin returns true when user is in platform_admins table", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-admin" } } });
    mocks.from.mockImplementation((table: string) => {
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { user_id: "user-admin" }, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const result = await isPlatformAdmin();
    expect(result).toBe(true);
  });

  it("requirePlatformAdmin throws UnauthorizedError when user is not logged in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("No session") });

    await expect(requirePlatformAdmin()).rejects.toThrow(UnauthorizedError);
  });

  it("requirePlatformAdmin throws ForbiddenError when user is not a platform admin", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-regular" } } });
    mocks.from.mockImplementation((table: string) => {
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    await expect(requirePlatformAdmin()).rejects.toThrow(ForbiddenError);
  });

  it("requirePlatformAdmin resolves user id when user is a platform admin", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-admin" } } });
    mocks.from.mockImplementation((table: string) => {
      if (table === "platform_admins") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { user_id: "user-admin" }, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await requirePlatformAdmin();
    expect(res.userId).toBe("user-admin");
  });
});
