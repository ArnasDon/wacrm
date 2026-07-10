import type { AIProviderName } from "./prompt.types";

export interface AIConfiguration {

  provider: AIProviderName;

  model: string;

  promptVersion: number;

  prompt: string;

  enabled: boolean;

}

export async function getAIConfiguration(): Promise<AIConfiguration> {

  return {

    provider: "gemini",

    model: "gemini-2.5-flash",

    promptVersion: 1,

    prompt: "",

    enabled: true,

  };

}