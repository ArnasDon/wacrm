import type { AiConfig } from "@/lib/ai/types";
import { loadAiConfig } from "@/lib/ai/config";
import {
  generateText,
  type GenerateTextArgs,
} from "@/lib/ai/generate-text";

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

interface AiReplyDependencies {
  loadConfig?: (db: never, accountId: string) => Promise<AiConfig | null>;
  generate?: (
    args: GenerateTextArgs,
  ) => Promise<{ text: string; usage: unknown }>;
}

export interface FlowAiReplyArgs {
  accountId: string;
  conversationId: string | null;
  effectId: string;
  operationId: string;
  claimToken: string;
  systemPrompt: string;
  prompt: string;
  inputVariables: readonly string[];
  vars: Readonly<Record<string, unknown>>;
  context?: unknown;
  maxTokens: number;
  signal?: AbortSignal;
}

const MAX_PROMPT_CODE_POINTS = 12_000;
const MAX_PROMPT_BYTES = 24_000;
const MAX_VALUE_CODE_POINTS = 4_096;
const MAX_VALUE_BYTES = 8_192;
const MAX_VALUE_DEPTH = 4;
const MAX_COLLECTION_ENTRIES = 50;

function assertTextBudget(
  text: string,
  maxCodePoints: number,
  maxBytes: number,
): void {
  if (
    Array.from(text).length > maxCodePoints ||
    new TextEncoder().encode(text).byteLength > maxBytes
  ) {
    throw new Error("AI prompt exceeds the execution budget.");
  }
}

function normalizePromptValue(
  value: unknown,
  depth = 0,
  stack: WeakSet<object> = new WeakSet(),
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") {
    throw new Error("AI prompt context contains an unsupported value.");
  }
  if (depth >= MAX_VALUE_DEPTH) {
    throw new Error("AI prompt context exceeds the depth limit.");
  }
  if (stack.has(value)) {
    throw new Error("AI prompt context contains a circular value.");
  }
  const entries = Array.isArray(value)
    ? value
    : Object.entries(value);
  if (entries.length > MAX_COLLECTION_ENTRIES) {
    throw new Error("AI prompt context exceeds the collection limit.");
  }
  stack.add(value);
  const normalized = Array.isArray(value)
    ? value.map((entry) => normalizePromptValue(entry, depth + 1, stack))
    : Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          normalizePromptValue(entry, depth + 1, stack),
        ]),
      );
  stack.delete(value);
  return normalized;
}

function serializePromptValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  const normalized = normalizePromptValue(value);
  const serialized =
    typeof normalized === "string"
      ? normalized
      : JSON.stringify(normalized);
  assertTextBudget(
    serialized,
    MAX_VALUE_CODE_POINTS,
    MAX_VALUE_BYTES,
  );
  return serialized;
}

function renderDeclaredVariables(
  template: string,
  vars: Readonly<Record<string, unknown>>,
  declared: ReadonlySet<string>,
): string {
  return template.replace(
    /\{\{vars\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g,
    (_match, key: string) => {
      if (!declared.has(key)) return "";
      const value = vars[key];
      return serializePromptValue(value);
    },
  );
}

function compileAiPrompt(args: FlowAiReplyArgs): {
  systemPrompt: string;
  prompt: string;
} {
  const declared = new Set(args.inputVariables);
  const systemPrompt = renderDeclaredVariables(
    args.systemPrompt,
    args.vars,
    declared,
  );
  const renderedPrompt = renderDeclaredVariables(
    args.prompt,
    args.vars,
    declared,
  );
  const context =
    args.context === undefined
      ? ""
      : `\n\nContext:\n${serializePromptValue(args.context)}`;
  const prompt = `${renderedPrompt}${context}`;
  assertTextBudget(
    `${systemPrompt}\n${prompt}`,
    MAX_PROMPT_CODE_POINTS,
    MAX_PROMPT_BYTES,
  );
  return { systemPrompt, prompt };
}

export async function generateFlowAiReply(
  db: RpcClient,
  args: FlowAiReplyArgs,
  dependencies: AiReplyDependencies = {},
): Promise<{ text: string }> {
  if (!args.conversationId) {
    throw new Error("AI reply requires a conversation.");
  }
  const compiled = compileAiPrompt(args);
  const config = await (dependencies.loadConfig ?? loadAiConfig)(
    db as never,
    args.accountId,
  );
  if (!config) throw new Error("AI is not configured for this account.");

  const claimArgs = {
    p_effect_id: args.effectId,
    p_operation_id: args.operationId,
    p_claim_token: args.claimToken,
    p_conversation_id: args.conversationId,
    p_max_replies: config.autoReplyMaxPerConversation,
  };
  let claim:
    | { allowed?: boolean; is_owner?: boolean }
    | undefined;
  let claimError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db.rpc(
      "claim_flow_ai_reply_credit",
      claimArgs,
    );
    claimError = error;
    claim = Array.isArray(data)
      ? (data[0] as typeof claim)
      : undefined;
    if (!error && claim) break;
  }
  if (claimError || !claim) {
    throw new Error(claimError?.message ?? "AI credit claim failed.");
  }
  if (claim.is_owner !== true) {
    throw new Error("AI reply credit claim is owned by another invocation.");
  }
  if (claim.allowed !== true) {
    throw new Error("AI reply credit cap reached.");
  }

  const generated = await (dependencies.generate ?? generateText)({
    config,
    systemPrompt: compiled.systemPrompt,
    prompt: compiled.prompt,
    maxTokens: args.maxTokens,
    signal: args.signal,
  });
  return { text: generated.text };
}
