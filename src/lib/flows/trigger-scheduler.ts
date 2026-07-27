import type { SupabaseClient } from "@supabase/supabase-js";

interface ClaimedSchedule {
  id: string;
  claim_token: string;
  cron_expr: string;
  timezone: string;
  next_fire_at: string;
}

interface SchedulerStats {
  claimed: number;
  enqueued: number;
  failed: number;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let value = min; value <= max; value += 1) values.add(value);
      continue;
    }
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      if (!Number.isInteger(step) || step < 1) throw new Error("invalid cron");
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error("invalid cron");
    }
    values.add(value);
  }
  return values;
}

function localParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour) % 24,
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: dateToWeekday(date, timezone),
  };
}

function dateToWeekday(date: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekday,
  );
}

function assertMinimumFiveMinutes(cronExpr: string): void {
  const [minute] = cronExpr.trim().split(/\s+/);
  if (minute === "*") {
    throw new Error("Cron triggers must be at least 5 minutes apart");
  }
  const step = minute.match(/^\*\/(\d+)$/);
  if (step && Number(step[1]) < 5) {
    throw new Error("Cron triggers must be at least 5 minutes apart");
  }
}

export function nextCronOccurrence(
  cronExpr: string,
  timezone: string,
  after: Date,
): Date {
  assertMinimumFiveMinutes(cronExpr);
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron expression must have 5 fields");
  const [minute, hour, day, month, weekday] = fields;
  const allowed = {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    day: parseField(day, 1, 31),
    month: parseField(month, 1, 12),
    weekday: parseField(weekday, 0, 7),
  };
  if (allowed.weekday.has(7)) {
    allowed.weekday.add(0);
    allowed.weekday.delete(7);
  }

  let cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60_000);
  const deadline = cursor.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= deadline) {
    const parts = localParts(cursor, timezone);
    if (
      allowed.minute.has(parts.minute) &&
      allowed.hour.has(parts.hour) &&
      allowed.day.has(parts.day) &&
      allowed.month.has(parts.month) &&
      allowed.weekday.has(parts.weekday)
    ) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  throw new Error("Cron expression has no occurrence within one year");
}

export async function drainDueFlowTriggerSchedules(
  db: SupabaseClient,
  now = new Date(),
): Promise<SchedulerStats> {
  const { data, error } = await db.rpc("claim_due_flow_trigger_schedules", {
    p_now: now.toISOString(),
    p_limit: 100,
  });
  if (error) throw error;
  const claims = (data ?? []) as ClaimedSchedule[];
  const stats: SchedulerStats = {
    claimed: claims.length,
    enqueued: 0,
    failed: 0,
  };
  for (const claim of claims) {
    try {
      const scheduledFor = new Date(claim.next_fire_at);
      const nextFireAt = nextCronOccurrence(
        claim.cron_expr,
        claim.timezone,
        scheduledFor,
      );
      const { error: markError } = await db.rpc(
        "mark_flow_trigger_schedule_fired",
        {
          p_schedule_id: claim.id,
          p_claim_token: claim.claim_token,
          p_scheduled_for: scheduledFor.toISOString(),
          p_next_fire_at: nextFireAt.toISOString(),
          p_idempotency_key: `schedule:${claim.id}:${scheduledFor.toISOString()}`,
        },
      );
      if (markError) {
        stats.failed += 1;
      } else {
        stats.enqueued += 1;
      }
    } catch {
      stats.failed += 1;
    }
  }
  return stats;
}
