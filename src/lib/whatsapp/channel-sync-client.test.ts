import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('./channel-sync-client');

// Fresh module (fresh throttle / state) per test.
async function load(): Promise<Mod> {
  vi.resetModules();
  return import('./channel-sync-client');
}

const ok = (channels: unknown[] = [{ id: 'c1' }], failed: unknown[] = []) =>
  Promise.resolve(
    new Response(JSON.stringify({ channels, failed }), { status: 200 })
  );

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => ok());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('channel sync client', () => {
  it('syncs and publishes the fresh channels to subscribers', async () => {
    const m = await load();
    const seen: boolean[] = [];
    m.subscribeChannelSync(() => seen.push(m.getChannelSyncState().syncing));
    const s = await m.requestChannelSync();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/whatsapp/channels/sync',
      expect.objectContaining({ method: 'POST' })
    );
    expect(s.channels).toEqual([{ id: 'c1' }]);
    expect(s.lastSync).not.toBeNull();
    expect(seen).toEqual([true, false]); // syncing → done
  });

  it('one request at a time: simultaneous callers share it', async () => {
    const m = await load();
    await Promise.all([
      m.requestChannelSync(),
      m.requestChannelSync(),
      m.requestChannelSync(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('navigating again within 30 s does not call the server again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const m = await load();
    await m.requestChannelSync();
    vi.setSystemTime(Date.now() + 10_000);
    await m.requestChannelSync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 25_000);
    await m.requestChannelSync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('Sync now (force) always goes through and says so', async () => {
    const m = await load();
    await m.requestChannelSync();
    await m.requestChannelSync({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      force: true,
    });
  });

  it('reports failures without throwing', async () => {
    const m = await load();
    fetchMock.mockImplementationOnce(() =>
      Promise.reject(new Error('offline'))
    );
    const s = await m.requestChannelSync();
    expect(s.error).toBe('offline');
    expect(s.syncing).toBe(false);
    fetchMock.mockImplementationOnce(() =>
      ok([{ id: 'c1' }], [{ id: 'c2', error: 'Token expired' }])
    );
    const s2 = await m.requestChannelSync({ force: true });
    expect(s2.error).toBeNull();
    expect(s2.failed).toEqual([{ id: 'c2', error: 'Token expired' }]);
  });
});
