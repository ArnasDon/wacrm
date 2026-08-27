// ============================================================
// GET /api/health
//
// Public. Two levels:
//   - default        -> LIVENESS: app + database. 200 ok / 503 down.
//   - ?full=1        -> READINESS: also cron heartbeats + critical env.
//                       200 ok|degraded / 503 down.
//
// EasyPanel's container healthcheck should use the DEFAULT (liveness):
// a stale cron must not trigger a container restart — restarting the
// web process won't make the scheduler fire.
//
// The external uptime monitor should hit `?full=1` so it also catches
// "app is up but a background job stopped".
//
// No secrets, versions, stack traces, or row data — every check is a
// flat enum. `Cache-Control: no-store`. The non-DB checks are cached
// in-process for a few seconds so a per-minute monitor is cheap.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadHeartbeatHealth } from '@/lib/observability/heartbeat';

export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 2_000;
const CACHE_MS = 8_000;

type CheckState = 'ok' | 'degraded' | 'down';

interface HealthBody {
  status: CheckState;
  checks: Record<string, string>;
  ts: string;
}

let _admin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _admin;
}

async function checkDb(): Promise<'ok' | 'down'> {
  try {
    const query = admin()
      .from('system_heartbeats')
      .select('name', { count: 'exact', head: true });
    // If the query settles at all within the budget the DB answered —
    // even a PostgREST error (permissions, missing relation) means the
    // server is up, which is what liveness cares about. Only an
    // unreachable DB (rejected fetch) or a timeout counts as down.
    await Promise.race([
      query,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('db timeout')), DB_TIMEOUT_MS),
      ),
    ]);
    return 'ok';
  } catch {
    return 'down';
  }
}

function checkEnv(): 'ok' | 'down' {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ENCRYPTION_KEY',
    'META_APP_SECRET',
  ];
  return required.every((k) => (process.env[k] ?? '').length > 0) ? 'ok' : 'down';
}

let cache: { at: number; env: 'ok' | 'down' } | null = null;

export async function GET(request: Request) {
  const full = new URL(request.url).searchParams.get('full') === '1';

  const db = await checkDb();

  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), env: checkEnv() };
  }
  const env = cache.env;

  const checks: Record<string, string> = { database: db, env };
  let status: CheckState = db === 'down' || env === 'down' ? 'down' : 'ok';

  if (full && status !== 'down') {
    try {
      const hbs = await loadHeartbeatHealth();
      const stale = hbs.filter((h) => h.stale).map((h) => h.name);
      const errored = hbs.filter((h) => h.lastStatus === 'error').map((h) => h.name);
      checks.crons =
        stale.length === 0 && errored.length === 0
          ? 'ok'
          : `degraded (stale: ${stale.join(',') || 'none'}; errored: ${errored.join(',') || 'none'})`;
      if (stale.length > 0 || errored.length > 0) status = 'degraded';
    } catch {
      checks.crons = 'unknown';
    }
  }

  const body: HealthBody = { status, checks, ts: new Date().toISOString() };
  return NextResponse.json(body, {
    status: status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
