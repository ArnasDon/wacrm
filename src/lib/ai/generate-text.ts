import { AiError, type AiConfig, type AiUsage } from "./types";
import { generateAnthropic } from "./providers/anthropic";
import { generateOpenAi } from "./providers/openai";

export const MAX_AI_REPLY_CHARS = 16_000;

export interface GenerateTextArgs {
  config: AiConfig;
  systemPrompt: string;
  prompt: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export async function generateText(
  args: GenerateTextArgs,
): Promise<{ text: string; usage: AiUsage | null }> {
  const providerArgs = {
    apiKey: args.config.apiKey,
    model: args.config.model,
    systemPrompt: args.systemPrompt,
    messages: [{ role: "user" as const, content: args.prompt }],
    timeoutMs: 15_000,
    maxTokens: Math.min(Math.max(Math.trunc(args.maxTokens), 1), 1_024),
    signal: args.signal,
  };
  const result =
    args.config.provider === "openai"
      ? await generateOpenAi(providerArgs)
      : args.config.provider === "anthropic"
        ? await generateAnthropic(providerArgs)
        : null;
  if (!result) {
    throw new AiError(`Unsupported AI provider: ${args.config.provider}`, {
      code: "unsupported_provider",
      status: 400,
    });
  }
  const text = result.text.trim();
  if (!text) {
    throw new AiError("AI provider returned an empty response.", {
      code: "provider_error",
      status: 502,
    });
  }
  if (text.length > MAX_AI_REPLY_CHARS) {
    throw new AiError("AI provider response is too long.", {
      code: "provider_error",
      status: 502,
    });
  }
  return { text, usage: result.usage };
}
