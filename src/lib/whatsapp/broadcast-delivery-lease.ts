import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * How long a `delivery_locked_at` stamp is honoured before it is read
 * as abandoned. Long enough that a legitimately slow pass is never
 * stolen from, short enough that a crashed one doesn't wedge the
 * campaign until someone touches the database.
 */
export const DELIVERY_LOCK_STALE_MS = 30 * 60 * 1000;

export const WIZARD_DELIVERY_LEASE_MS = 5 * 60 * 1000;

export function wizardDeliveryLeaseUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + WIZARD_DELIVERY_LEASE_MS).toISOString();
}

export function isBroadcastDeliveryInFlight(
  broadcast: {
    delivery_locked_at?: string | null;
    delivery_lease_until?: string | null;
  },
  now: Date = new Date()
): boolean {
  const lockedAt = broadcast.delivery_locked_at
    ? new Date(broadcast.delivery_locked_at).getTime()
    : NaN;
  if (lockedAt > now.getTime() - DELIVERY_LOCK_STALE_MS) return true;
  const leaseUntil = broadcast.delivery_lease_until
    ? new Date(broadcast.delivery_lease_until).getTime()
    : NaN;
  return leaseUntil > now.getTime();
}

export async function renewWizardDeliveryLease(
  db: SupabaseClient,
  broadcastId: string,
  heldLease: string,
  now: Date = new Date()
): Promise<string | null> {
  const nextLease = wizardDeliveryLeaseUntil(now);
  const { data, error } = await db
    .from('broadcasts')
    .update({ delivery_lease_until: nextLease })
    .eq('id', broadcastId)
    .eq('delivery_lease_until', heldLease)
    .select('id');
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return nextLease;
}
