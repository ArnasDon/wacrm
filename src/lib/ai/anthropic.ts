/**
 * Thin wrapper around `@anthropic-ai/sdk` (spec §5/§7.1, §11).
 *
 * The only place in `src/lib/ai/` that talks to Anthropic. It forces a
 * single `submit_answer` tool so the model's decision comes back as a
 * structured `tool_use` block (no JSON-in-text scraping — spec §7.1),
 * parses that block into the canonical `AiModelResult`, and surfaces the
 * token `usage` the orchestrator records in `ai_reply_log`.
 *
 * Deliberately thin: prompt assembly lives in `prompt.ts`, the
 * reply/escalate verdict in `decide.ts`, orchestration in `reply.ts`.
 * This module just does the network round-trip and the parse, so it is
 * trivially mockable — `callAssistant` accepts an injected `client`
 * (default a real `Anthropic` instance) and the reply tests pass a stub
 * instead of hitting the network (spec §14).
 *
 * The API key is read LAZILY (spec §11): the SDK is constructed only on
 * first real call, so a missing `ANTHROPIC_API_KEY` never crashes
 * `next build` or module load — it just means AI is effectively off. A
 * missing key throws the typed `MissingApiKeyError`; the orchestrator's
 * try/catch turns that (like any other failure) into a fail-safe
 * escalation to a human (spec §6, §12).
 */

import Anthropic from "@anthropic-ai/sdk";

import { type AiModelResult } from "@/types";

/** The forced tool's name (spec §7.1). */
export const SUBMIT_ANSWER_TOOL_NAME = "submit_answer";

/**
 * Thrown when `ANTHROPIC_API_KEY` is absent at call time. Typed (not a
 * bare `Error`) so callers can distinguish "AI is not configured" from a
 * transient API failure if they ever need to — and so it reads clearly
 * in the audit log. Mirrors the typed-error convention in
 * `src/lib/auth/account.ts`.
 */
export class MissingApiKeyError extends Error {
  constructor(message = "ANTHROPIC_API_KEY is not configured") {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Token usage from the Anthropic `usage` block, projected to the three
 * counts the audit log cares about (spec §4.4 / §13). The SDK reports
 * `input_tokens` / `cache_read_input_tokens` as nullable; we normalise
 * `null` to `0` so the caller always gets numbers.
 */
export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}

/** Arguments for {@link callAssistant}. */
export interface CallAssistantArgs {
  /** Anthropic model id (e.g. `claude-sonnet-4-6`) — from account config. */
  model: string;
  /**
   * The `system` array built by `prompt.buildSystemBlocks` (persona +
   * cache-marked KB block). Passed straight through.
   */
  system: Anthropic.TextBlockParam[];
  /**
   * The `messages` array built by `prompt.buildMessages` (history +
   * inbound). Passed straight through.
   */
  messages: Anthropic.MessageParam[];
  /**
   * Optional injected client (default a real `Anthropic` instance, built
   * lazily). Tests pass a stub so no network call happens (spec §14).
   */
  client?: Pick<Anthropic, "messages">;
}

/** The wrapper's result: the model's verdict plus the token usage. */
export interface CallAssistantResult extends AiModelResult {
  usage: AiUsage;
}

/**
 * Cap on the model's output. The `submit_answer` payload is small (a
 * single support reply plus a short rationale), so this is generous —
 * it bounds runaway generation without truncating a normal reply.
 */
const MAX_OUTPUT_TOKENS = 1024;

/**
 * The single tool the model is forced to call (spec §7.1). Its
 * `input_schema` is the structured decision contract: the reply to send,
 * a strict confidence flag, and a short rationale for the audit log.
 */
const SUBMIT_ANSWER_TOOL: Anthropic.Tool = {
  name: SUBMIT_ANSWER_TOOL_NAME,
  description:
    "Submit your decision for this customer message. Call this exactly " +
    "once. Set `confident` to true ONLY if the knowledge base fully and " +
    "clearly answers the question; otherwise set it to false and leave " +
    "`answer` empty so the conversation is handed to a human.",
  input_schema: {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description:
          "The reply to send the customer. Empty string if you are not " +
          "confident the knowledge base answers the question.",
      },
      confident: {
        type: "boolean",
        description:
          "True ONLY if the knowledge base fully answers the question.",
      },
      reason: {
        type: "string",
        description: "Short rationale for the decision, for the audit log.",
      },
    },
    required: ["answer", "confident", "reason"],
  },
};

/**
 * Force Claude to answer through the single `submit_answer` tool
 * (spec §7.1).
 */
const SUBMIT_ANSWER_TOOL_CHOICE: Anthropic.ToolChoiceTool = {
  type: "tool",
  name: SUBMIT_ANSWER_TOOL_NAME,
};

/** Process-wide lazily-constructed real client. Reused across calls. */
let _client: Anthropic | null = null;

/**
 * Lazily construct (and memoise) the real Anthropic client.
 *
 * Reads `ANTHROPIC_API_KEY` at CALL TIME, not module load (spec §11): a
 * missing key throws {@link MissingApiKeyError} here rather than crashing
 * the build. The key is passed explicitly so the failure mode is our
 * typed error, not the SDK's own "missing key" throw.
 */
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new MissingApiKeyError();
  }
  if (!_client) {
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Coerce the SDK's nullable usage counts into a plain numeric
 * {@link AiUsage}. `input_tokens` / `cache_read_input_tokens` can be
 * `null`; normalise to `0`.
 */
function toUsage(usage: Anthropic.Usage): AiUsage {
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Extract and validate the `submit_answer` payload from the response
 * content. Throws if no matching `tool_use` block is present or its input
 * is not the expected shape — the orchestrator's try/catch turns that
 * into a fail-safe escalation rather than sending a malformed reply.
 */
function parseToolUse(content: Anthropic.ContentBlock[]): AiModelResult {
  const block = content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === SUBMIT_ANSWER_TOOL_NAME,
  );

  if (!block) {
    throw new Error(
      `Anthropic response contained no '${SUBMIT_ANSWER_TOOL_NAME}' tool_use block`,
    );
  }

  const input = block.input;
  if (typeof input !== "object" || input === null) {
    throw new Error(
      `'${SUBMIT_ANSWER_TOOL_NAME}' tool_use input was not an object`,
    );
  }

  const { answer, confident, reason } = input as Record<string, unknown>;
  if (
    typeof answer !== "string" ||
    typeof confident !== "boolean" ||
    typeof reason !== "string"
  ) {
    throw new Error(
      `'${SUBMIT_ANSWER_TOOL_NAME}' tool_use input did not match the expected schema`,
    );
  }

  return { answer, confident, reason };
}

/**
 * Call Claude for a single customer message and return its structured
 * decision plus token usage (spec §7.1).
 *
 * Forces the `submit_answer` tool via
 * `tool_choice: { type: 'tool', name: 'submit_answer' }`, so the model
 * MUST respond with one `tool_use` block whose `input` is
 * `{ answer, confident, reason }`. The block is parsed and validated;
 * anything unexpected (missing block, wrong shape) throws so the caller
 * escalates instead of guessing.
 *
 * Pass `client` to inject a stub in tests; omit it to use the real,
 * lazily-built client (which reads `ANTHROPIC_API_KEY` and throws
 * {@link MissingApiKeyError} if it is absent).
 */
export async function callAssistant({
  model,
  system,
  messages,
  client,
}: CallAssistantArgs): Promise<CallAssistantResult> {
  const anthropic = client ?? getClient();

  const response = await anthropic.messages.create({
    model: model as Anthropic.Model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages,
    tools: [SUBMIT_ANSWER_TOOL],
    tool_choice: SUBMIT_ANSWER_TOOL_CHOICE,
  });

  const result = parseToolUse(response.content);

  return {
    ...result,
    usage: toUsage(response.usage),
  };
}
