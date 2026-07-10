import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  console.log("========== CRON ROUTE HIT ==========");

  const expected = process.env.AUTOMATION_CRON_SECRET
  console.log("[CRON] expected =", expected);
  console.log("[CRON] supplied =", request.headers.get("x-cron-secret"));
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()

  const { data: allRows, error: allErr } = await admin
    .from("automation_pending_executions")
    .select("id,status,run_at")
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("[CRON] ALL ROWS", allRows);
  console.log("[CRON] ALL ERROR", allErr);

  const staleCutoff = new Date(
    Date.now() - 15 * 60 * 1000,
  ).toISOString()

  await admin
    .from('automation_pending_executions')
    .update({
      status: 'pending',
    })
    .eq('status', 'running')
    .lt('started_at', staleCutoff)

  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  console.log("[CRON] due rows", due?.length, error);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    console.log("[CRON] processing", row.id);
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      console.log("[CRON] Calling resumePendingExecution");

      console.log("[CRON] Before resume", row.id);

await resumePendingExecution({
  id: row.id as string,
  automation_id: row.automation_id as string,
  account_id: row.account_id as string,
  user_id: row.user_id as string,
  contact_id: (row.contact_id as string | null) ?? null,
  log_id: (row.log_id as string | null) ?? null,
  parent_step_id: (row.parent_step_id as string | null) ?? null,
  branch: (row.branch as 'yes' | 'no' | null) ?? null,
  next_step_position: row.next_step_position as number,
  context: (row.context as AutomationContext) ?? {},
});

console.log("[CRON] After resume", row.id);

      console.log("[CRON] resumePendingExecution finished");
    } catch (e) {
      console.error("[CRON] resumePendingExecution FAILED", e);
    }
    processed++
  }

  return NextResponse.json({ processed })
}
