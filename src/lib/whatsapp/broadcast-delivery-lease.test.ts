import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LEASE_RPC_ATTEMPTS,
  acquireWizardDeliveryLease,
  isBroadcastDeliveryInFlight,
  renewWizardDeliveryLease,
} from './broadcast-delivery-lease';

const SERVER_LEASE = '2026-08-11T12:05:00.123456+00:00';

type RpcResponse = { data: unknown; error: { message: string } | null } | Error;

function rpcDb(...responses: RpcResponse[]) {
  const rpc = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected rpc call');
    if (next instanceof Error) throw next;
    return next;
  });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const noSleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);

describe('acquireWizardDeliveryLease', () => {
  it('takes the lease timestamp the database computed', async () => {
    const { db, rpc } = rpcDb({ data: SERVER_LEASE, error: null });
    expect(await acquireWizardDeliveryLease(db, 'bc-1', noSleep)).toEqual({
      status: 'held',
      lease: SERVER_LEASE,
    });
    expect(rpc).toHaveBeenCalledWith('acquire_broadcast_delivery_lease', {
      p_broadcast_id: 'bc-1',
    });
  });

  it('reports the lease as lost when a resume already holds the broadcast', async () => {
    const { db } = rpcDb({ data: null, error: null });
    expect(await acquireWizardDeliveryLease(db, 'bc-1', noSleep)).toEqual({ status: 'lost' });
  });
});

describe('renewWizardDeliveryLease', () => {
  it('renews against the lease the wizard holds', async () => {
    const { db, rpc } = rpcDb({ data: SERVER_LEASE, error: null });
    expect(await renewWizardDeliveryLease(db, 'bc-1', 'held-lease', noSleep)).toEqual({
      status: 'held',
      lease: SERVER_LEASE,
    });
    expect(rpc).toHaveBeenCalledWith('renew_broadcast_delivery_lease', {
      p_broadcast_id: 'bc-1',
      p_held: 'held-lease',
    });
  });

  it('reports the lease as lost once a resume has taken it over', async () => {
    const { db, rpc } = rpcDb({ data: null, error: null });
    expect(await renewWizardDeliveryLease(db, 'bc-1', 'held-lease', noSleep)).toEqual({
      status: 'lost',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure with backoff instead of giving the lease up', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const { db, rpc } = rpcDb(new Error('Failed to fetch'), { data: SERVER_LEASE, error: null });
    expect(await renewWizardDeliveryLease(db, 'bc-1', 'held-lease', sleep)).toEqual({
      status: 'held',
      lease: SERVER_LEASE,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('reports an error, not a lost lease, when every attempt fails', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const failures = Array.from({ length: LEASE_RPC_ATTEMPTS }, () => ({
      data: null,
      error: { message: 'upstream timeout' },
    }));
    const { db, rpc } = rpcDb(...failures);
    expect(await renewWizardDeliveryLease(db, 'bc-1', 'held-lease', sleep)).toEqual({
      status: 'error',
      message: 'upstream timeout',
    });
    expect(rpc).toHaveBeenCalledTimes(LEASE_RPC_ATTEMPTS);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000, 2000]);
  });
});

describe('isBroadcastDeliveryInFlight', () => {
  it('trusts the database clock', async () => {
    const { db, rpc } = rpcDb({ data: true, error: null });
    expect(await isBroadcastDeliveryInFlight(db, 'bc-1')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('broadcast_delivery_in_flight', { p_broadcast_id: 'bc-1' });
  });

  it('falls back to showing Resume when the check fails', async () => {
    const { db } = rpcDb({ data: null, error: { message: 'boom' } });
    expect(await isBroadcastDeliveryInFlight(db, 'bc-1')).toBe(false);
  });
});
