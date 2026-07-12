import type { AIProviderName } from "./prompt.types";

export interface ProviderConfiguration {
  provider: AIProviderName;
  model: string;
  enabled: boolean;
  priority: number;
}

export async function getActiveProvider(): Promise<ProviderConfiguration> {
  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL ?? "gpt-5-nano",
    enabled: true,
    priority: 1,
  };
}