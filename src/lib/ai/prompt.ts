/**
 * Prompt assembly for the WhatsApp AI assistant (spec §7).
 *
 * Pure and fully deterministic: no I/O, no clock, no randomness, no
 * network. Given an account's config + its KB entries + the recent
 * conversation history + the inbound text, it builds the two pieces the
 * Anthropic wrapper hands to `messages.create`:
 *
 * 1. `buildSystemBlocks` → the `system` array. A stable
 *    persona/instructions text block first, then the assembled
 *    knowledge-base block carrying `cache_control: { type: 'ephemeral' }`
 *    so it bills at ~10% on cache hits (spec §7.2, §13). Ordering is
 *    deliberate: stable instructions first, the most-cacheable
 *    last-stable content (the KB) last.
 * 2. `buildMessages` → the `messages` array: the last N (default 10)
 *    history turns mapped oldest→newest to `user`/`assistant` roles,
 *    then the inbound customer text appended as the final `user` turn.
 *    History is NOT cached — it changes every turn (spec §7.3).
 *
 * Account isolation (spec §7.4, critical): KB entries arrive
 * ALREADY filtered by `account_id`. This module is deliberately blind to
 * tenancy — it includes exactly the entries it is handed, in the order
 * it is handed them, and never reaches for a global/shared KB. The unit
 * test asserts that "only and all provided entries appear, in order",
 * which is the testable form of the isolation guarantee.
 *
 * The shapes returned are the canonical Anthropic SDK param types
 * (`Anthropic.TextBlockParam`, `Anthropic.MessageParam`) so the wrapper
 * can pass them straight through with no remapping.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { type AiAssistantConfig, type KnowledgeBaseEntry } from "@/types";

/**
 * Default number of conversation history turns to include for context
 * (spec §7.3 / §13). Oldest→newest; the cap keeps token cost bounded.
 */
export const HISTORY_MESSAGE_LIMIT = 10;

/**
 * Delimiters around the assembled knowledge base. Clear, unambiguous
 * fences (spec §7.2: "wrapped in clear delimiters") so the model can
 * tell exactly where the grounding material begins and ends and can't
 * confuse KB content with instructions.
 */
const KB_HEADER = "===== KNOWLEDGE BASE (START) =====";
const KB_FOOTER = "===== KNOWLEDGE BASE (END) =====";

/**
 * Shown in place of the KB body when an account has no enabled entries.
 * The block is still emitted (and still cache-marked) so the prompt
 * structure is stable; the empty marker tells the model it has nothing
 * to ground on — which, combined with the "answer ONLY from the KB"
 * system prompt, drives it to `confident: false` rather than guessing.
 */
const KB_EMPTY_PLACEHOLDER = "(No knowledge base entries are available.)";

/**
 * Minimal history-message shape consumed by `buildMessages`. Decoupled
 * from the DB `Message` row on purpose — the caller projects whatever it
 * loaded down to just the sender + text, so this stays a pure function
 * with no dependency on the persistence layer.
 */
export interface PromptHistoryMessage {
  /** Who sent it: `customer` → `user`; `agent` / `bot` → `assistant`. */
  sender_type: "customer" | "agent" | "bot";
  /** The text body. Empty / missing entries are dropped (see below). */
  content_text?: string | null;
}

/**
 * Substitute the `{business_name}` placeholder in the system prompt with
 * the configured business name (spec §7.2). Falls back to a neutral
 * phrase when no name is set so the prompt never renders a literal
 * `{business_name}` to the model. `replace` with a string pattern only
 * swaps the first occurrence, so we use a global regex.
 */
function renderPersona(config: AiAssistantConfig): string {
  const businessName =
    typeof config.business_name === "string" &&
    config.business_name.trim().length > 0
      ? config.business_name.trim()
      : "our business";

  return config.system_prompt.replace(/\{business_name\}/g, businessName);
}

/**
 * Assemble the knowledge-base text from the enabled entries, in the
 * exact order received. Each entry renders as `## {title}\n{content}`
 * (spec §7.2); entries are separated by a blank line for readability.
 *
 * Disabled entries are skipped (spec §4.2: "Disabled entries are
 * excluded from the prompt"). Order is otherwise preserved verbatim —
 * no sorting, no dedup — so the assembled block is a faithful, ordered
 * projection of exactly what the caller passed.
 */
function assembleKnowledgeBase(entries: readonly KnowledgeBaseEntry[]): string {
  const rendered = entries
    .filter((entry) => entry.enabled)
    .map((entry) => `## ${entry.title}\n${entry.content}`);

  const body = rendered.length > 0 ? rendered.join("\n\n") : KB_EMPTY_PLACEHOLDER;

  return `${KB_HEADER}\n${body}\n${KB_FOOTER}`;
}

/**
 * Build the Anthropic `system` array (spec §7.2).
 *
 * Returns two text blocks, in order:
 * 1. The stable persona/instructions block (`config.system_prompt` with
 *    `{business_name}` substituted). NOT cache-marked here — the KB is
 *    the cache breakpoint, and a breakpoint caches everything up to and
 *    including it, so a single marker on the trailing KB block covers
 *    the whole stable prefix.
 * 2. The assembled knowledge base, carrying
 *    `cache_control: { type: 'ephemeral' }`.
 *
 * KB entries MUST already be filtered to the calling account (spec
 * §7.4). This function includes exactly the entries it is given.
 */
export function buildSystemBlocks(
  config: AiAssistantConfig,
  kbEntries: readonly KnowledgeBaseEntry[],
): Anthropic.TextBlockParam[] {
  const persona: Anthropic.TextBlockParam = {
    type: "text",
    text: renderPersona(config),
  };

  const knowledgeBase: Anthropic.TextBlockParam = {
    type: "text",
    text: assembleKnowledgeBase(kbEntries),
    cache_control: { type: "ephemeral" },
  };

  return [persona, knowledgeBase];
}

/**
 * Map a stored sender type to an Anthropic message role (spec §7.3):
 * the customer is the `user`; everything we send back (a human `agent`
 * or the `bot` itself) is the `assistant`.
 */
function roleFor(senderType: PromptHistoryMessage["sender_type"]): "user" | "assistant" {
  return senderType === "customer" ? "user" : "assistant";
}

/**
 * Build the Anthropic `messages` array (spec §7.3).
 *
 * Takes the conversation `history` (any length, oldest→newest), keeps
 * the last `HISTORY_MESSAGE_LIMIT` turns, maps each to a `user` /
 * `assistant` role, then appends `inboundText` as the final `user`
 * message. History turns with empty / whitespace-only text are dropped
 * (an empty `content` is not a valid message turn) BEFORE the cap is
 * applied, so the cap counts only real turns.
 *
 * The inbound message is always appended verbatim as the last `user`
 * turn — it is the message we are answering and must never be trimmed.
 */
export function buildMessages(
  history: readonly PromptHistoryMessage[],
  inboundText: string,
): Anthropic.MessageParam[] {
  const safeHistory = Array.isArray(history) ? history : [];

  const usable = safeHistory.filter(
    (msg): msg is PromptHistoryMessage =>
      typeof msg?.content_text === "string" &&
      msg.content_text.trim().length > 0,
  );

  const recent = usable.slice(-HISTORY_MESSAGE_LIMIT);

  const messages: Anthropic.MessageParam[] = recent.map((msg) => ({
    role: roleFor(msg.sender_type),
    content: msg.content_text as string,
  }));

  messages.push({ role: "user", content: inboundText });

  return messages;
}
