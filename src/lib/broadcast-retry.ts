/**
 * Retry policy for one batch of a broadcast fan-out.
 *
 * Deliberately narrow: a batch is retried ONLY on 429. That is the one
 * status where the route is known to have rejected the request before
 * calling Meta — `checkRateLimit` runs before any send — so replaying
 * the batch cannot double-message a customer. A 500, a timeout, or a
 * dropped connection may all have sent some or all of the batch
 * already; those recipients are recorded as failed for the operator to
 * review rather than silently messaged twice.
 */

/** Attempts per batch, including the first. */
export const BATCH_SEND_ATTEMPTS = 4;

/** Fallback wait when a 429 arrives without a usable Retry-After. */
const DEFAULT_RETRY_MS = 5_000;

/** Never sleep longer than this on one retry, whatever the header says. */
const MAX_RETRY_MS = 120_000;

/**
 * How long to wait before replaying a batch, or null if it must not be
 * replayed.
 *
 * @param status HTTP status of the failed attempt.
 * @param retryAfter Raw `Retry-After` header, if the response had one.
 */
export function batchRetryDelayMs(
  status: number,
  retryAfter: string | null,
): number | null {
  if (status !== 429) return null;

  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_MS;
  return Math.min(seconds * 1_000, MAX_RETRY_MS);
}
