import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: vi.fn(() => ({
    from: mocks.from,
    rpc: mocks.rpc,
  })),
}));

import { hasCreditsForOne, chargeBillableMessage, creditWallet } from "./charge";

describe("Billing charge helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hasCreditsForOne returns true when balance >= rate", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "account_wallets") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { balance: 10.0 }, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    mocks.rpc.mockResolvedValue({ data: 1.5, error: null });

    const result = await hasCreditsForOne("acc-1");
    expect(result).toBe(true);
  });

  it("hasCreditsForOne returns false when balance < rate", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "account_wallets") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { balance: 0.5 }, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    mocks.rpc.mockResolvedValue({ data: 1.5, error: null });

    const result = await hasCreditsForOne("acc-1");
    expect(result).toBe(false);
  });

  it("chargeBillableMessage calls debit_message RPC and returns ok on success", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    const result = await chargeBillableMessage("acc-1", "message", "msg-123");
    expect(result).toBe("ok");
    expect(mocks.rpc).toHaveBeenCalledWith("debit_message", {
      p_account_id: "acc-1",
      p_reference_type: "message",
      p_reference_id: "msg-123",
    });
  });

  it("creditWallet calls credit_wallet RPC and returns new balance", async () => {
    mocks.rpc.mockResolvedValue({ data: 150, error: null });

    const newBalance = await creditWallet(
      "acc-1",
      100,
      "recharge",
      "admin",
      "manual",
      "Test top-up",
      "user-admin"
    );

    expect(newBalance).toBe(150);
    expect(mocks.rpc).toHaveBeenCalledWith("credit_wallet", {
      p_account_id: "acc-1",
      p_credits: 100,
      p_type: "recharge",
      p_reference_type: "admin",
      p_reference_id: "manual",
      p_note: "Test top-up",
      p_created_by: "user-admin",
    });
  });
});
