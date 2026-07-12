import type { AIProviderName } from "./services/prompt.types";
import { getActiveProvider } from "./services/provider.service";

export interface ProviderSelection {
  provider: AIProviderName;
  model: string;
}

export async function selectProvider(): Promise<ProviderSelection> {
  const config = await getActiveProvider();

  return {
    provider: config.provider,
    model: config.model,
  };
}