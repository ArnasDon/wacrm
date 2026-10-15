import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logError } from "@/lib/observability/log";

/**
 * GET /api/health — unauthenticated liveness/readiness check.
 *
 * Meant for an external uptime monitor (this project already pings
 * other endpoints from cron-job.org — see AUTOMATION_CRON_SECRET /
 * ENVIOS_CRON_SECRET in .env.local.example) so a broken deploy surfaces
 * as an alert within minutes instead of "a user complained" days later
 * (the PDF-thumbnail regression sat undetected for ~2 days). Not under
 * /api/whatsapp/*, so the session-auth middleware trap doesn't apply,
 * and it deliberately stays outside any auth: a monitor has no session
 * cookie to send. Response body is minimal on purpose — booleans only,
 * no error messages or stack traces to an unauthenticated caller; the
 * real detail goes to Sentry via logError.
 */
const DB_TIMEOUT_MS = 3500;

export async function GET() {
  const checks: Record<string, boolean> = {};

  try {
    let timeoutId: NodeJS.Timeout | undefined;
    const dbPromise = supabaseAdmin()
      .from("accounts")
      .select("id")
      .limit(1);

    const timeoutPromise = new Promise<{ data: null; error: Error }>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Database check timeout after ${DB_TIMEOUT_MS}ms`)),
        DB_TIMEOUT_MS
      );
    });

    try {
      const { error } = await Promise.race([dbPromise, timeoutPromise]);
      checks.database = !error;
      if (error) logError("health.database", error);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch (error) {
    checks.database = false;
    logError("health.database", error);
  }

  const healthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: healthy ? "ok" : "error",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 }
  );
}
