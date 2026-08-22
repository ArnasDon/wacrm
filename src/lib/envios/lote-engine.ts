/**
 * Pure helpers for the Envios queue engine — kept dependency-free so
 * they're unit-testable without a Supabase client (mirror of how
 * src/lib/whatsapp/encryption.ts is tested in isolation).
 */

/**
 * Smallest a lote is allowed to be when the list is actually split in
 * two. Below this, splitting would produce a lote too thin to be worth
 * a separate approval/pause step — and at the extreme (1 or 0 leads),
 * an empty lote that never completes (the cron tick has nothing to
 * advance) and permanently blocks lote 2, since lote 2 only unlocks
 * once lote 1 reaches `concluido` (see `isLote2Blocked`).
 */
export const MIN_LOTE_SIZE = 2;

/**
 * Splits a lead count into 2 lotes, rounding the first lote DOWN on an
 * odd count (spec: "arredondar o primeiro lote para baixo"). Returns
 * `[lote1Size, lote2Size]`.
 *
 * Only splits when both sides would reach `MIN_LOTE_SIZE` — otherwise
 * returns `[totalLeads, 0]`, signaling a single lote (the caller must
 * skip creating lote 2 entirely when its size is 0, not create it
 * empty).
 */
export function splitIntoLotes(totalLeads: number): [number, number] {
  if (totalLeads < MIN_LOTE_SIZE * 2) {
    return [totalLeads, 0];
  }
  const lote1 = Math.floor(totalLeads / 2);
  return [lote1, totalLeads - lote1];
}

export const MIN_ATTEMPT_DELAY_MS = 60_000;
export const MAX_ATTEMPT_DELAY_MS = 240_000;

/**
 * A real random delay in [60s, 240s] — never a fixed list of values
 * (spec's explicit anti-detection requirement). `Math.random()` is
 * fine here: this is pacing, not a security boundary.
 */
export function randomAttemptDelayMs(): number {
  return MIN_ATTEMPT_DELAY_MS + Math.random() * (MAX_ATTEMPT_DELAY_MS - MIN_ATTEMPT_DELAY_MS);
}

/** Lote 2 stays locked until lote 1 has fully finished (spec section 3). */
export function isLote2Blocked(lote1Status: string): boolean {
  return lote1Status !== 'concluido';
}

/** A lead still waiting to be sent — the subset `estimateRemainingMs` reasons about. */
export interface QueuedLeadForEta {
  status: string;
  next_attempt_at: string | null;
}

/**
 * Estimated time left to finish an active lote's queue, in ms — or
 * `null` when there's nothing left pending (the lote is about to
 * transition to `concluido` on the next cron tick).
 *
 * The cron tick only ever draws `next_attempt_at` for ONE lead ahead
 * at a time (the next one in line) — it doesn't pre-roll the whole
 * queue up front. So at most one pending lead has a known wait; every
 * lead after that is estimated using the range's mathematical average
 * (`(MIN_ATTEMPT_DELAY_MS + MAX_ATTEMPT_DELAY_MS) / 2`), and the
 * estimate self-corrects on every poll as the cron draws each next
 * interval for real.
 */
export function estimateRemainingMs(leads: QueuedLeadForEta[], now: number = Date.now()): number | null {
  const pending = leads.filter((l) => l.status === 'na_fila');
  if (pending.length === 0) return null;

  const avgDelayMs = (MIN_ATTEMPT_DELAY_MS + MAX_ATTEMPT_DELAY_MS) / 2;
  const scheduled = pending.find((l) => l.next_attempt_at !== null);
  if (!scheduled?.next_attempt_at) {
    return pending.length * avgDelayMs;
  }

  const knownWaitMs = Math.max(0, new Date(scheduled.next_attempt_at).getTime() - now);
  const remainingAfter = pending.length - 1;
  return knownWaitMs + remainingAfter * avgDelayMs;
}
