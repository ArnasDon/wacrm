/**
 * Pure helpers for the Envios queue engine — kept dependency-free so
 * they're unit-testable without a Supabase client (mirror of how
 * src/lib/whatsapp/encryption.ts is tested in isolation).
 */

/**
 * Smallest a lote is allowed to be when the list is split across more
 * than one lote. Below this, splitting would produce a lote too thin to
 * be worth a separate approval/pause step — and at the extreme (an
 * empty lote), a lote that never reaches `concluido` (the cron tick has
 * nothing to advance) and permanently blocks every lote after it, since
 * a lote only unlocks once every lower-numbered lote is `concluido`
 * (see `isLoteBlocked`).
 */
export const MIN_LOTE_SIZE = 2;

/** Upper bound on how many lotes a single Envio can be split into (UI + DB CHECK, migration 080). */
export const MAX_LOTES = 20;

/**
 * Splits a lead count into `numLotes` lotes as evenly as possible,
 * rounding earlier lotes DOWN on an uneven count (spec: "arredondar o
 * primeiro lote para baixo", generalized — any remainder leads land on
 * the LAST lotes instead of the first). Returns an array of lote sizes
 * summing to `totalLeads`.
 *
 * Never returns an empty lote: if `totalLeads` can't support
 * `numLotes` lotes at `MIN_LOTE_SIZE` each, the requested count is
 * silently reduced to the largest feasible number (at least 1) — the
 * returned array's length may be smaller than `numLotes`.
 */
export function splitIntoLotes(totalLeads: number, numLotes: number = 2): number[] {
  if (totalLeads <= 0) return [0];

  const requested = Math.max(1, Math.min(Math.trunc(numLotes) || 1, MAX_LOTES));
  const feasible = Math.max(1, Math.min(requested, Math.floor(totalLeads / MIN_LOTE_SIZE) || 1));

  const base = Math.floor(totalLeads / feasible);
  const remainder = totalLeads % feasible;
  return Array.from({ length: feasible }, (_, i) => (i < feasible - remainder ? base : base + 1));
}

/**
 * Which message variant (0-based index into the uploaded `messages`
 * array) a lead at `positionInLote` should get — a simple round-robin
 * rotation, evaluated separately per lote (spec: "distribuir as
 * variantes de forma rotativa/igualitária... dentro de cada lote").
 * `variantCount <= 1` always returns 0 (no rotation needed).
 */
export function variantIndexForPosition(positionInLote: number, variantCount: number): number {
  if (variantCount <= 1) return 0;
  return positionInLote % variantCount;
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

/** The minimal shape needed to reason about lote ordering/blocking. */
export interface LoteForBlocking {
  numero_lote: number;
  status: string;
}

/**
 * A lote stays locked until every lower-numbered lote in the same
 * Envio has reached `concluido` (spec section 3, generalized from the
 * old fixed lote-1/lote-2 rule to N lotes) — dispatch is strictly
 * sequential, one lote at a time.
 */
export function isLoteBlocked(numeroLote: number, lotes: LoteForBlocking[]): boolean {
  return lotes.some((l) => l.numero_lote < numeroLote && l.status !== 'concluido');
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
