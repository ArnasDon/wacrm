import { describe, expect, it, vi } from "vitest";

import {
  nextCronOccurrence,
  drainDueFlowTriggerSchedules,
} from "./trigger-scheduler";

describe("flow trigger cron scheduler", () => {
  it("computes the next occurrence in an IANA timezone", () => {
    const next = nextCronOccurrence(
      "*/15 * * * *",
      "America/Sao_Paulo",
      new Date("2026-07-27T11:07:00.000Z"),
    );

    expect(next.toISOString()).toBe("2026-07-27T11:15:00.000Z");
  });

  it("rejects cron expressions that can fire more often than every 5 minutes", () => {
    expect(() =>
      nextCronOccurrence("* * * * *", "UTC", new Date("2026-07-27T00:00:00Z")),
    ).toThrow(/5 minutes/i);
    expect(() =>
      nextCronOccurrence("*/4 * * * *", "UTC", new Date("2026-07-27T00:00:00Z")),
    ).toThrow(/5 minutes/i);
  });

  it("claims due schedules and marks each with a deterministic invocation idempotency key", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_due_flow_trigger_schedules") {
        return {
          data: [
            {
              id: "schedule-1",
              claim_token: "claim-1",
              cron_expr: "*/15 * * * *",
              timezone: "UTC",
              next_fire_at: "2026-07-27T12:00:00.000Z",
            },
          ],
          error: null,
        };
      }
      if (name === "mark_flow_trigger_schedule_fired") {
        return { data: [{ id: "invocation-1" }], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const stats = await drainDueFlowTriggerSchedules(
      { rpc } as never,
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect(stats).toEqual({ claimed: 1, enqueued: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith(
      "mark_flow_trigger_schedule_fired",
      expect.objectContaining({
        p_schedule_id: "schedule-1",
        p_claim_token: "claim-1",
        p_scheduled_for: "2026-07-27T12:00:00.000Z",
        p_next_fire_at: "2026-07-27T12:15:00.000Z",
        p_idempotency_key: "schedule:schedule-1:2026-07-27T12:00:00.000Z",
      }),
    );
  });
});
