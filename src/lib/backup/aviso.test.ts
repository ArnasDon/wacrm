import { describe, expect, it, vi } from 'vitest';
import { notifyFailure } from './aviso';

const notice = {
  step: 'upload' as const,
  artifact: 'supabase-db.dump',
  destinationScheme: 's3',
  folder: '2026-10-21T03-00-00-000Z',
  message: 'rclone exited with 1: quota exceeded',
  at: '2026-10-21T03:04:00.000Z',
};

describe('notifyFailure', () => {
  it('posts the notice as json to the tenant webhook', async () => {
    const fetchFn = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 })
    );
    await expect(
      notifyFailure('https://avisos.example.com/backup', notice, { fetchFn })
    ).resolves.toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://avisos.example.com/backup');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe(
      'application/json'
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      event: 'backup.failed',
      step: 'upload',
      artifact: 'supabase-db.dump',
      destinationScheme: 's3',
      folder: notice.folder,
      at: notice.at,
    });
  });

  it('never carries the destination uri or the credential', async () => {
    const fetchFn = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 })
    );
    await notifyFailure('https://avisos.example.com/backup', notice, {
      fetchFn,
    });
    const body = (fetchFn.mock.calls[0][1] as RequestInit).body as string;
    expect(body).not.toContain('secret_access_key');
    expect(body).not.toContain('://');
  });

  it('returns false when the webhook answers with an error status', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      notifyFailure('https://avisos.example.com/backup', notice, { fetchFn })
    ).resolves.toBe(false);
  });

  it('returns false instead of throwing when the webhook is unreachable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      notifyFailure('https://avisos.example.com/backup', notice, { fetchFn })
    ).resolves.toBe(false);
  });

  it('gives up on a webhook that never answers', async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    );
    await expect(
      notifyFailure('https://avisos.example.com/backup', notice, {
        fetchFn: fetchFn as unknown as typeof fetch,
        timeoutMs: 10,
      })
    ).resolves.toBe(false);
  });
});
