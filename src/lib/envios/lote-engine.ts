/**
 * Pure helpers for the Envios queue engine — kept dependency-free so
 * they're unit-testable without a Supabase client (mirror of how
 * src/lib/whatsapp/encryption.ts is tested in isolation).
 */

/**
 * Splits a lead count into 2 lotes, rounding the first lote DOWN on an
 * odd count (spec: "arredondar o primeiro lote para baixo"). Returns
 * `[lote1Size, lote2Size]`.
 */
export function splitIntoLotes(totalLeads: number): [number, number] {
  const lote1 = Math.floor(totalLeads / 2);
  return [lote1, totalLeads - lote1];
}

export const MIN_ATTEMPT_DELAY_MS = 60_000;
export const MAX_ATTEMPT_DELAY_MS = 300_000;

/**
 * A real random delay in [60s, 300s] — never a fixed list of values
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
