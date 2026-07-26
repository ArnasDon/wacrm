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
  maxTokens: number;
  signal?: AbortSignal;
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
      return value === undefined || value === null ? "" : String(value);
    },
  );
}

export async function generateFlowAiReply(
  db: RpcClient,
  args: FlowAiReplyArgs,
  dependencies: AiReplyDependencies = {},
): Promise<{ text: string }> {
  if (!args.conversationId) {
    throw new Error("AI reply requires a conversation.");
  }
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

  const declared = new Set(args.inputVariables);
  const generated = await (dependencies.generate ?? generateText)({
    config,
    systemPrompt: renderDeclaredVariables(
      args.systemPrompt,
      args.vars,
      declared,
    ),
    prompt: renderDeclaredVariables(args.prompt, args.vars, declared),
    maxTokens: args.maxTokens,
    signal: args.signal,
  });
  return { text: generated.text };
}
