import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { pruneOrphanedChatMedia } from '@/lib/maintenance/retention';

function authorized(request: Request): boolean {
  const expected =
    process.env.RETENTION_CRON_SECRET ?? process.env.WEBHOOK_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const configured =
    process.env.RETENTION_CRON_SECRET ?? process.env.WEBHOOK_CRON_SECRET;
  if (!configured) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  // Fail-safe: an unqualified/manual request only reports what would be
  // removed. The scheduled job must opt into execution explicitly.
  const dryRun = url.searchParams.get('execute') !== 'true';
  const admin = supabaseAdmin();
  const { data: database, error } = await admin.rpc('run_data_retention', {
    p_dry_run: dryRun,
    p_batch_size: 1000,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const media = await pruneOrphanedChatMedia(admin, { dryRun, limit: 200 });
    return NextResponse.json({ dryRun, database, media });
  } catch (mediaError) {
    return NextResponse.json(
      {
        dryRun,
        database,
        mediaError:
          mediaError instanceof Error
            ? mediaError.message
            : 'media cleanup failed',
      },
      { status: 500 }
    );
  }
}
