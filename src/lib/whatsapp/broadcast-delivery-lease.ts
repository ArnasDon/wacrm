import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How long a `delivery_locked_at` stamp is honoured before it is read
 * as abandoned. Long enough that a legitimately slow pass is never
 * stolen from, short enough that a crashed one doesn't wedge the
 * campaign until someone touches the database.
 */
export const DELIVERY_LOCK_STALE_MS = 30 * 60 * 1000;

export const LEASE_RPC_ATTEMPTS = 3;
export const LEASE_RPC_BACKOFF_MS = 1000;

export type DeliveryLeaseResult =
  | { status: 'held'; lease: string }
  | { status: 'lost' }
  | { status: 'error'; message: string };

type Sleep = (ms: number) => Promise<unknown>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callLeaseRpc(
  db: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  sleep: Sleep
): Promise<DeliveryLeaseResult> {
  let lastError = '';
  for (let attempt = 1; attempt <= LEASE_RPC_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await db.rpc(fn, args);
      if (!error) {
        return typeof data === 'string' && data
          ? { status: 'held', lease: data }
          : { status: 'lost' };
      }
      lastError = error.message;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < LEASE_RPC_ATTEMPTS) {
      await sleep(LEASE_RPC_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  return { status: 'error', message: lastError };
}

export function acquireWizardDeliveryLease(
  db: SupabaseClient,
  broadcastId: string,
  sleep: Sleep = defaultSleep
): Promise<DeliveryLeaseResult> {
  return callLeaseRpc(
    db,
    'acquire_broadcast_delivery_lease',
    { p_broadcast_id: broadcastId },
    sleep
  );
}

export function renewWizardDeliveryLease(
  db: SupabaseClient,
  broadcastId: string,
  heldLease: string,
  sleep: Sleep = defaultSleep
): Promise<DeliveryLeaseResult> {
  return callLeaseRpc(
    db,
    'renew_broadcast_delivery_lease',
    { p_broadcast_id: broadcastId, p_held: heldLease },
    sleep
  );
}

export async function isBroadcastDeliveryInFlight(
  db: SupabaseClient,
  broadcastId: string
): Promise<boolean> {
  const { data, error } = await db.rpc('broadcast_delivery_in_flight', {
    p_broadcast_id: broadcastId,
  });
  if (error) return false;
  return data === true;
}
