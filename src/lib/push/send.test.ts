import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
}));
vi.mock('./vapid', () => ({
  getVapidConfig: () => ({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x@y.z' }),
}));

import { sendPushToUser } from './send';

/** Minimal fake of the bits `sendPushToUser` touches on `push_subscriptions`. */
function makeDb(rows: { id: string; endpoint: string; failure_count: number }[]) {
  const state = { deleted: [] as string[], updates: [] as { id: string; patch: Record<string, unknown> }[] };
  const db = {
    from() {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: rows.map((r) => ({ ...r, p256dh: 'p', auth: 'a' })), error: null }) }),
        delete: () => ({ in: (_c: string, ids: string[]) => { state.deleted.push(...ids); return Promise.resolve({ error: null }); } }),
        update: (patch: Record<string, unknown>) => ({ eq: (_c: string, id: string) => { state.updates.push({ id, patch }); return Promise.resolve({ error: null }); } }),
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, state };
}

beforeEach(() => {
  sendNotification.mockReset();
});

describe('sendPushToUser', () => {
  it('sends to every subscription the user has', async () => {
    sendNotification.mockResolvedValue({});
    const { db } = makeDb([
      { id: 's1', endpoint: 'e1', failure_count: 0 },
      { id: 's2', endpoint: 'e2', failure_count: 0 },
    ]);
    const res = await sendPushToUser(db, 'u1', { title: 'hi' });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ sent: 2, pruned: 0 });
  });

  it('prunes a subscription the push service reports as gone (410)', async () => {
    sendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    const { db, state } = makeDb([
      { id: 's1', endpoint: 'e1', failure_count: 0 },
      { id: 's2', endpoint: 'e2', failure_count: 0 },
    ]);
    const res = await sendPushToUser(db, 'u1', { title: 'hi' });
    expect(res).toEqual({ sent: 1, pruned: 1 });
    expect(state.deleted).toEqual(['s2']);
  });

  it('bumps failure_count on a transient error, deletes at the cap', async () => {
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    const { db, state } = makeDb([
      { id: 's1', endpoint: 'e1', failure_count: 0 }, // -> bump to 1
      { id: 's2', endpoint: 'e2', failure_count: 4 }, // -> 5, at cap -> delete
    ]);
    const res = await sendPushToUser(db, 'u1', { title: 'hi' });
    expect(res).toEqual({ sent: 0, pruned: 1 });
    expect(state.deleted).toEqual(['s2']);
    expect(state.updates).toEqual([{ id: 's1', patch: { failure_count: 1 } }]);
  });

  it('no-ops with zero subscriptions', async () => {
    const { db } = makeDb([]);
    const res = await sendPushToUser(db, 'u1', { title: 'hi' });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(res).toEqual({ sent: 0, pruned: 0 });
  });
});
