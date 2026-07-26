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

  const { data: claimed, error } = await db.rpc("claim_ai_reply_slot", {
    conversation_id: args.conversationId,
    max_replies: config.autoReplyMaxPerConversation,
  });
  if (error) throw new Error(error.message ?? "AI credit claim failed.");
  if (claimed !== true) throw new Error("AI reply credit cap reached.");

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
