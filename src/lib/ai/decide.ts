/**
 * The decision core (spec §5/§6).
 *
 * The second, post-LLM half of the assistant's "fail safe to a human"
 * bias. Once the model has answered via the forced `submit_answer` tool,
 * `decide` reduces its structured `AiModelResult` to a single, parseable
 * verdict: reply autonomously or escalate to a human.
 *
 * Per spec §6 the contract is deliberately strict — auto-send requires
 * BOTH halves of the model's self-report to hold:
 * - `confident === true` (the KB fully answers the question), AND
 * - a non-empty `answer` (there is actually something to send).
 *
 * Anything else — not confident, or confident but with an empty/blank
 * answer (a degenerate "confident-but-said-nothing" response) — escalates
 * with `reason: 'low_confidence'`. The customer is never left silent and
 * the bot never sends an empty message.
 *
 * Pure and fully deterministic: no I/O, no clock, no randomness, no
 * mutation of the input. All the logic worth testing lives here so it can
 * be exercised without a Supabase / Anthropic mock (mirrors
 * `src/lib/ai/guardrails.ts` and `src/lib/flows/fallback.ts`).
 */

import { type AiEscalationReason, type AiModelResult } from "@/types";

/** The two terminal actions the assistant can take on an inbound message. */
export type DecideAction = "reply" | "escalate";

/**
 * The verdict produced from a model result.
 *
 * - `{ action: 'reply', text }` — send `text` to the customer as a `bot`
 *   message. `text` is always present and non-empty when `action` is
 *   `'reply'`.
 * - `{ action: 'escalate', reason }` — hand the conversation to a human.
 *   `reason` is always the `'low_confidence'` escalation reason (the only
 *   post-LLM escalation `decide` itself produces; keyword / cap / error
 *   escalations are decided upstream). It maps straight onto
 *   `ai_reply_log.reason` / `conversations.ai_escalation_reason`.
 */
export type DecideResult =
  | { action: "reply"; text: string }
  | { action: "escalate"; reason: AiEscalationReason };

/**
 * Reduce the model's structured `submit_answer` result to a reply /
 * escalate decision.
 *
 * Returns `{ action: 'reply', text: answer }` ONLY when the model both
 * reported `confident === true` and supplied a non-empty (non-whitespace)
 * `answer`. Every other case — not confident, missing/blank answer, or a
 * malformed result object — escalates with `reason: 'low_confidence'`,
 * honouring the "any doubt → escalate, never send an empty reply" bias.
 */
export function decide(modelResult: AiModelResult): DecideResult {
  const confident = modelResult?.confident === true;
  const answer = typeof modelResult?.answer === "string" ? modelResult.answer : "";

  if (confident && answer.trim().length > 0) {
    return { action: "reply", text: answer };
  }

  return { action: "escalate", reason: "low_confidence" };
}
