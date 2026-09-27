import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { recordTestSendStatus } from './template-test-sends';

function db(row: { id: string; statuses: unknown[] } | null, updates: unknown[], fail = false) {
  return {
    from: () => {
      if (fail) throw new Error('boom');
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: row, error: null });
      b.update = (patch: unknown) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('recordTestSendStatus', () => {
  it('appends the raw status webhook to its test send', async () => {
    const updates: unknown[] = [];
    const sent = { id: 'wamid.1', status: 'sent', pricing: { billable: true } };
    await recordTestSendStatus(db({ id: 't1', statuses: [{ id: 'wamid.1', status: 'accepted' }] }, updates), {
      id: 'wamid.1',
      status: 'delivered',
    });
    await recordTestSendStatus(db({ id: 't1', statuses: [] }, updates), sent);
    expect(updates[0]).toEqual({
      statuses: [{ id: 'wamid.1', status: 'accepted' }, { id: 'wamid.1', status: 'delivered' }],
      last_status: 'delivered',
    });
    expect(updates[1]).toEqual({ statuses: [sent], last_status: 'sent' });
  });

  it('does nothing for a real (non-test) message', async () => {
    const updates: unknown[] = [];
    await recordTestSendStatus(db(null, updates), { id: 'wamid.x', status: 'read' });
    expect(updates).toEqual([]);
  });

  it('never throws into webhook processing', async () => {
    await expect(recordTestSendStatus(db(null, [], true), { id: 'w', status: 'sent' })).resolves.toBeUndefined();
  });
});
