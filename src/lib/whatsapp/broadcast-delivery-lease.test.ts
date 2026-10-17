import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DELIVERY_LOCK_STALE_MS,
  WIZARD_DELIVERY_LEASE_MS,
  isBroadcastDeliveryInFlight,
  renewWizardDeliveryLease,
  wizardDeliveryLeaseUntil,
} from './broadcast-delivery-lease';

const NOW = new Date('2026-08-11T12:00:00Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe('isBroadcastDeliveryInFlight', () => {
  it('is idle with no lock and no lease', () => {
    expect(isBroadcastDeliveryInFlight({}, NOW)).toBe(false);
    expect(
      isBroadcastDeliveryInFlight({ delivery_locked_at: null, delivery_lease_until: null }, NOW),
    ).toBe(false);
  });

  it('is busy while a wizard lease is live and idle once it lapses', () => {
    expect(isBroadcastDeliveryInFlight({ delivery_lease_until: at(1000) }, NOW)).toBe(true);
    expect(isBroadcastDeliveryInFlight({ delivery_lease_until: at(-1000) }, NOW)).toBe(false);
  });

  it('is busy while a server pass holds a fresh lock', () => {
    expect(isBroadcastDeliveryInFlight({ delivery_locked_at: at(-60_000) }, NOW)).toBe(true);
    expect(
      isBroadcastDeliveryInFlight({ delivery_locked_at: at(-DELIVERY_LOCK_STALE_MS - 1) }, NOW),
    ).toBe(false);
  });
});

describe('wizardDeliveryLeaseUntil', () => {
  it('leases the send for the wizard window', () => {
    expect(wizardDeliveryLeaseUntil(NOW)).toBe(at(WIZARD_DELIVERY_LEASE_MS));
  });
});

function leaseDb(matchedRows: unknown[]) {
  const calls: { update?: Record<string, unknown>; filters: Record<string, unknown> } = {
    filters: {},
  };
  const builder: Record<string, unknown> = {
    update: (row: Record<string, unknown>) => {
      calls.update = row;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      calls.filters[column] = value;
      return builder;
    },
    select: async () => ({ data: matchedRows, error: null }),
  };
  const db = { from: () => builder } as unknown as SupabaseClient;
  return { db, calls };
}

describe('renewWizardDeliveryLease', () => {
  it('extends the lease only while the wizard still holds it', async () => {
    const { db, calls } = leaseDb([{ id: 'bc-1' }]);
    const renewed = await renewWizardDeliveryLease(db, 'bc-1', at(-1000), NOW);
    expect(renewed).toBe(at(WIZARD_DELIVERY_LEASE_MS));
    expect(calls.update).toEqual({ delivery_lease_until: renewed });
    expect(calls.filters).toEqual({ id: 'bc-1', delivery_lease_until: at(-1000) });
  });

  it('reports the lease as lost once a resume has taken it over', async () => {
    const { db } = leaseDb([]);
    expect(await renewWizardDeliveryLease(db, 'bc-1', at(-1000), NOW)).toBeNull();
  });
});
