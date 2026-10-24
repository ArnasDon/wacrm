import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ runDailyBackup: vi.fn() }));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));
vi.mock('@/lib/backup/tarea', () => ({
  runDailyBackup: h.runDailyBackup,
  MANIFEST_NAME: 'manifiesto.json',
}));

import { GET, __resetBackupLockForTests } from './route';

type Answer = { status: number; body: Record<string, unknown> };

function call(secret?: string) {
  return GET(
    new Request('http://t/api/backup/cron', {
      headers: secret === undefined ? {} : { 'x-cron-secret': secret },
    })
  ) as unknown as Promise<Answer>;
}

beforeEach(() => {
  __resetBackupLockForTests();
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'un-secreto-largo');
  h.runDailyBackup.mockReset();
  h.runDailyBackup.mockResolvedValue({
    ok: true,
    folder: 'f',
    uploaded: ['supabase-db.dump'],
  });
});

describe('GET /api/backup/cron', () => {
  it('runs the backup and answers 200 with what it uploaded', async () => {
    const answer = await call('un-secreto-largo');
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      folder: 'f',
      uploaded: ['supabase-db.dump'],
    });
    expect(h.runDailyBackup).toHaveBeenCalledTimes(1);
  });

  it('answers 401 and does not run the backup without the shared secret', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('otro')).status).toBe(401);
    expect(h.runDailyBackup).not.toHaveBeenCalled();
  });

  it('answers 503 when the cron secret is not configured', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    expect((await call('un-secreto-largo')).status).toBe(503);
    expect(h.runDailyBackup).not.toHaveBeenCalled();
  });

  it('answers 500 with the failed step when the backup failed', async () => {
    h.runDailyBackup.mockResolvedValue({
      ok: false,
      folder: 'f',
      uploaded: [],
      failure: {
        step: 'upload',
        artifact: 'supabase-db.dump',
        message: 'quota exceeded',
      },
      notified: true,
    });
    const answer = await call('un-secreto-largo');
    expect(answer.status).toBe(500);
    expect(answer.body).toMatchObject({ step: 'upload', notified: true });
  });

  it('answers 409 instead of dumping twice at the same time', async () => {
    let release: () => void = () => {};
    h.runDailyBackup.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, folder: 'f', uploaded: [] });
        })
    );
    const first = call('un-secreto-largo');
    expect((await call('un-secreto-largo')).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(h.runDailyBackup).toHaveBeenCalledTimes(1);
  });

  it('frees the lock after a backup that threw', async () => {
    h.runDailyBackup.mockRejectedValueOnce(new Error('boom'));
    expect((await call('un-secreto-largo')).status).toBe(500);
    expect((await call('un-secreto-largo')).status).toBe(200);
  });
});
