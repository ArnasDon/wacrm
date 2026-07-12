import type { AIContext } from "@/lib/ai/context/builder";

export type AIProviderName =
  | "gemini"
  | "openai"
  | "claude"
  | "deepseek"
  | "grok";

export type PromptScope =
  | "global"
  | "account"
  | "intent";

export interface PromptDefinition {

  id: string;

  name: string;

  provider: AIProviderName;

  scope: PromptScope;

  intent?: string;

  version: number;

  enabled: boolean;

  systemPrompt: string;

  createdAt?: string;

  updatedAt?: string;

}

export interface PromptRequest {

  accountId?: string;

  provider: AIProviderName;

  intent?: string;

  context: AIContext;

}

export interface PromptResponse {

  prompt: string;

  version: number;

}