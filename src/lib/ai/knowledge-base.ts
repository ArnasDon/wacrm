/**
 * Knowledge-base data access for the AI assistant (spec §4.2, §5).
 *
 * Two pieces:
 *
 * 1. `loadEnabledEntries` — a thin service-role read of the *enabled*
 *    `knowledge_base_entries` for one account. Strict per-account
 *    isolation is enforced here at the query level (`.eq("account_id",
 *    accountId)`) and again, structurally, in `prompt.ts` — there is no
 *    global/shared KB in v1 (spec §7.4, §12).
 *
 * 2. `estimateTokens` — the chars/4 heuristic used for the Settings size
 *    meter and the `token_estimate` cache column (spec §4.2, §9). Pure.
 *
 * The webhook path runs as service-role and bypasses RLS exactly as the
 * Flows and automations engines already do (spec §4 / §12).
 */

import { type KnowledgeBaseEntry } from '@/types';

import { supabaseAdmin } from './admin-client';

/**
 * Divisor for the rough token estimate. ~4 characters per token is the
 * standard English heuristic; it intentionally over- rather than
 * under-counts so the size meter trips conservatively (spec §4.2 / §9).
 */
const CHARS_PER_TOKEN = 4;

/**
 * Load the *enabled* knowledge-base entries for an account, ordered
 * oldest→newest (`created_at` ascending) so the assembled prompt is
 * stable and reproducible across calls.
 *
 * Disabled entries are excluded at the query level (spec §4.2: "Disabled
 * entries are excluded from the prompt") — `prompt.ts` also filters
 * defensively, but not sending them over the wire keeps the payload lean.
 *
 * Returns an empty array on any DB error so the caller can still proceed:
 * an empty KB drives the model to `confident: false` rather than guessing
 * (spec §7.2), which is the safe fail-to-human outcome (spec §1).
 */
export async function loadEnabledEntries(
  accountId: string
): Promise<KnowledgeBaseEntry[]> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('knowledge_base_entries')
    .select('*')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[ai] loadEnabledEntries error:', error.message);
    return [];
  }

  return (data as KnowledgeBaseEntry[] | null) ?? [];
}

/**
 * Estimate the token count of a piece of text with the chars/4 heuristic
 * (spec §4.2). Pure and deterministic — no tokenizer, no I/O. Used for the
 * cached `token_estimate` column and the Settings size meter.
 *
 * Returns `0` for empty / non-string input so callers can sum estimates
 * across entries without guarding each one. Uses `Math.ceil` so any
 * non-empty text counts as at least one token.
 */
export function estimateTokens(text: string): number {
  if (typeof text !== 'string' || text.length === 0) {
    return 0;
  }

  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
