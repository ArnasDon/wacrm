import type { AIProvider } from "./gateway";

export interface ProviderSelection {

  provider: AIProvider;

}

export function selectProvider(): ProviderSelection {

  /**
   * Temporary strategy.
   *
   * Phase-2:
   *
   * - Intent
   * - Cost
   * - Health
   * - Fallback
   */

  return {

    provider: "gemini",

  };

}