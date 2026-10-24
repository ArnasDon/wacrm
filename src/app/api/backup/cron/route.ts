import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDailyBackup } from '@/lib/backup/tarea';

let running = false;

export function __resetBackupLockForTests(): void {
  running = false;
}

/**
 * Daily backup trigger (BAK.1). Hit by the compose `cron` service at 03:00
 * with the shared `x-cron-secret` (same AUTOMATION_CRON_SECRET as the other
 * cron routes). Never echoes the destination URI or credentials.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '');
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (running) {
    return NextResponse.json(
      { error: 'a backup is already running' },
      { status: 409 }
    );
  }
  running = true;
  try {
    const outcome = await runDailyBackup();
    if (!outcome.ok) {
      console.error(
        `backup failed at ${outcome.failure.step}: ${outcome.failure.message}`
      );
      return NextResponse.json(
        {
          error: 'backup failed',
          step: outcome.failure.step,
          artifact: outcome.failure.artifact,
          notified: outcome.notified,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      folder: outcome.folder,
      uploaded: outcome.uploaded,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'backup failed';
    console.error(`backup failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    running = false;
  }
}
