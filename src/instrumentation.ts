/**
 * Runs once when a Next.js server instance starts.
 *
 * On a long-running Node server (`next start`, Docker, `next dev`) this
 * starts the in-process advanced-campaign scheduler, so scheduled
 * campaigns go out on time and an interrupted one resumes without any
 * external cron. Serverless hosts (Vercel) have no long-lived process —
 * point a cron at GET /api/campaigns/tick there instead.
 *
 * Set CAMPAIGN_SCHEDULER=off to disable it (e.g. when several replicas
 * run and only a cron should drive campaigns — the run lock makes
 * overlap safe either way).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.VERCEL || process.env.CAMPAIGN_SCHEDULER === 'off') return;
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  )
    return;

  const { startCampaignScheduler } =
    await import('@/lib/campaigns/scheduler-loop');
  startCampaignScheduler();
}
