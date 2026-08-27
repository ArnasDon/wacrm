import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({ client: vi.fn(), sendEmail: vi.fn() }));
vi.mock('@/lib/platform/admin-client', () => ({ platformAdminClient: H.client }));
vi.mock('@/lib/email/send', () => ({ sendEmail: H.sendEmail }));

import { dispatchSystemAlert, resolveSystemAlert } from './alerts';

interface DbMock {
  builder: Record<string, unknown>;
  calls: { inserts: Record<string, unknown>[]; updates: Record<string, unknown>[] };
  setExisting: (v: unknown) => void;
  setInsertError: (v: unknown) => void;
}

function makeDb(): DbMock {
  const calls = { inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] };
  let existing: unknown = null;
  let insertError: unknown = null;

  const builder: Record<string, unknown> = {
    from() { return builder; },
    select() { return builder; },
    eq() { return builder; },
    is() { return builder; },
    maybeSingle() { return Promise.resolve({ data: existing, error: null }); },
    insert(payload: Record<string, unknown>) { calls.inserts.push(payload); return builder; },
    update(payload: Record<string, unknown>) { calls.updates.push(payload); return builder; },
    single() {
      return insertError
        ? Promise.resolve({ data: null, error: insertError })
        : Promise.resolve({ data: { id: 'new-alert-id' }, error: null });
    },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };

  return {
    builder,
    calls,
    setExisting: (v) => { existing = v; },
    setInsertError: (v) => { insertError = v; },
  };
}

let db: DbMock;

beforeEach(() => {
  db = makeDb();
  H.client.mockReset();
  H.client.mockReturnValue(db.builder);
  H.sendEmail.mockReset();
  H.sendEmail.mockResolvedValue(undefined);
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ALERT_CHAT_ID;
  delete process.env.ALERTS_EMAIL;
});

describe('dispatchSystemAlert', () => {
  it('opens a new alert row and stamps notified_at when none is active', async () => {
    db.setExisting(null);
    await dispatchSystemAlert({
      severity: 'warning',
      source: 'unit',
      title: 'thing broke',
      dedupKey: 'unit:1',
    });
    expect(db.calls.inserts).toHaveLength(1);
    expect(db.calls.inserts[0]).toMatchObject({
      dedup_key: 'unit:1',
      severity: 'warning',
      source: 'unit',
    });
    expect(db.calls.inserts[0].notified_at).toBeTruthy();
  });

  it('folds a repeat into the active row without re-notifying inside the throttle window', async () => {
    db.setExisting({ id: 'a1', occurrences: 2, notified_at: new Date().toISOString() });
    await dispatchSystemAlert({
      severity: 'warning',
      source: 'unit',
      title: 'still broken',
      dedupKey: 'unit:1',
      throttleMinutes: 30,
    });
    expect(db.calls.inserts).toHaveLength(0);
    expect(db.calls.updates).toHaveLength(1);
    expect(db.calls.updates[0].occurrences).toBe(3);
    expect(db.calls.updates[0]).not.toHaveProperty('notified_at');
  });

  it('re-notifies a still-open alert once the throttle window has passed', async () => {
    db.setExisting({
      id: 'a1',
      occurrences: 5,
      notified_at: new Date(Date.now() - 40 * 60_000).toISOString(),
    });
    await dispatchSystemAlert({
      severity: 'critical',
      source: 'unit',
      title: 'worse now',
      dedupKey: 'unit:1',
      throttleMinutes: 30,
    });
    expect(db.calls.updates).toHaveLength(1);
    expect(db.calls.updates[0].notified_at).toBeTruthy();
    expect(db.calls.updates[0].occurrences).toBe(6);
  });

  it('on a 23505 insert race bumps the winner and does not notify or throw', async () => {
    db.setExisting(null);
    db.setInsertError({ code: '23505', message: 'duplicate key' });
    await expect(
      dispatchSystemAlert({
        severity: 'warning',
        source: 'unit',
        title: 'race',
        dedupKey: 'unit:1',
      }),
    ).resolves.toMatchObject({ opened: false, notified: false });
    expect(db.calls.updates).toHaveLength(1);
    expect(db.calls.updates[0]).toHaveProperty('last_seen_at');
    expect(db.calls.updates[0]).not.toHaveProperty('notified_at');
  });

  it('reports opened:true when it creates a fresh row', async () => {
    db.setExisting(null);
    const r = await dispatchSystemAlert({
      severity: 'warning',
      source: 'unit',
      title: 'fresh',
      dedupKey: 'unit:1',
    });
    expect(r.opened).toBe(true);
    expect(r.alertId).toBe('new-alert-id');
  });

  it('swallows a client that throws', async () => {
    H.client.mockImplementation(() => {
      throw new Error('admin client unavailable');
    });
    await expect(
      dispatchSystemAlert({ severity: 'info', source: 'unit', title: 'x', dedupKey: 'unit:1' }),
    ).resolves.toMatchObject({ opened: false, notified: false, alertId: null });
  });
});

describe('resolveSystemAlert', () => {
  it('closes the active row for the key', async () => {
    await resolveSystemAlert('unit:1');
    expect(db.calls.updates).toHaveLength(1);
    expect(db.calls.updates[0]).toHaveProperty('resolved_at');
  });

  it('never throws when the client blows up', async () => {
    H.client.mockImplementation(() => {
      throw new Error('down');
    });
    await expect(resolveSystemAlert('unit:1')).resolves.toBeUndefined();
  });
});
