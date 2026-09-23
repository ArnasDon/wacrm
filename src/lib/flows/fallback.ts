/**
 * Fallback-policy resolver.
 *
 * Pure logic that decides what the engine does when a customer reply
 * doesn't match any option on the current `send_buttons` / `send_list`
 * node. Lifted out of `engine.ts` so it can be unit-tested without a
 * Supabase / Meta mock.
 *
 * The policy lives on `flows.fallback_policy` (JSONB) and is loaded
 * with the run; defaults filled in by `resolveFallbackPolicy` so an
 * older flow row (or a partial JSONB blob) doesn't crash the runner.
 */

import { DEFAULT_FALLBACK_POLICY, type FlowFallbackPolicy } from './types';

export type FallbackAction =
  /** Re-send the same prompt and wait again. */
  | { type: 'reprompt' }
  /** End the run with status='handed_off', flip conversation to pending. */
  | { type: 'handoff' }
  /** End the run with status='completed' (the `end` exhaust option). */
  | { type: 'end' }
  /** Do nothing — the message wasn't for us. */
  | { type: 'ignore' };

/**
 * Merge a partial / null fallback_policy from the DB with the v1
 * defaults. The DB column defaults the *whole* JSONB to the right
 * shape, but rows authored before this default landed, or rows
 * manually edited to a subset, would otherwise crash the runner.
 */
export function resolveFallbackPolicy(raw: unknown): FlowFallbackPolicy {
  if (!raw || typeof raw !== 'object') return DEFAULT_FALLBACK_POLICY;
  const r = raw as Partial<FlowFallbackPolicy>;
  return {
    on_unknown_reply:
      r.on_unknown_reply === 'handoff' ||
      r.on_unknown_reply === 'ignore' ||
      r.on_unknown_reply === 'reprompt'
        ? r.on_unknown_reply
        : DEFAULT_FALLBACK_POLICY.on_unknown_reply,
    max_reprompts:
      typeof r.max_reprompts === 'number' && r.max_reprompts >= 0
        ? Math.floor(r.max_reprompts)
        : DEFAULT_FALLBACK_POLICY.max_reprompts,
    on_timeout_hours:
      typeof r.on_timeout_hours === 'number' && r.on_timeout_hours > 0
        ? r.on_timeout_hours
        : DEFAULT_FALLBACK_POLICY.on_timeout_hours,
    on_exhaust:
      r.on_exhaust === 'handoff' || r.on_exhaust === 'end'
        ? r.on_exhaust
        : DEFAULT_FALLBACK_POLICY.on_exhaust,
  };
}

/**
 * Decide the action when the customer's reply doesn't match a button
 * id on the current node. The engine increments `reprompt_count` and
 * persists, then calls this with the NEW count.
 *
 * - `on_unknown_reply: 'ignore'` → always ignore. Useful for a flow
 *   that should keep running even if the customer types something
 *   off-script in between taps (rare; default is reprompt).
 * - `on_unknown_reply: 'handoff'` → immediately escalate. No retries.
 * - `on_unknown_reply: 'reprompt'` → re-send the prompt up to
 *   `max_reprompts` times, then apply `on_exhaust`.
 */
export function decideFallback(args: {
  policy: FlowFallbackPolicy;
  /** Reprompt count AFTER incrementing (so 1 = first reprompt). */
  reprompt_count: number;
}): FallbackAction {
  const { policy, reprompt_count } = args;

  if (policy.on_unknown_reply === 'ignore') return { type: 'ignore' };
  if (policy.on_unknown_reply === 'handoff') return { type: 'handoff' };

  // 'reprompt' — guarded by max_reprompts.
  if (reprompt_count <= policy.max_reprompts) {
    return { type: 'reprompt' };
  }
  return policy.on_exhaust === 'end' ? { type: 'end' } : { type: 'handoff' };
}
