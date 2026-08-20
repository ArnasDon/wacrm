// One provider call, strict-JSON-in-prompt — same pattern as
// lead-analysis.ts's extractLeadIntelligence. Calls the existing
// provider adapters directly (providers/openai.ts / providers/anthropic.ts)
// unmodified; no new provider/integration.

import { generateOpenAi } from './providers/openai';
import { generateAnthropic } from './providers/anthropic';
import { aiRequestTimeoutMs } from './defaults';
import type { AiUsage } from './types';
import {
  buildTemplateFillSystemPrompt,
  buildTemplateFillUserPrompt,
  type TemplateFillPromptArgs,
} from './template-fill-prompt';
import { parseTemplateFillResult, type TemplateFillResult } from './template-fill-types';

export interface GenerateTemplateFillArgs extends TemplateFillPromptArgs {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  /** The exact variable numbers the response must (only) contain. */
  expectedIndices: number[];
}

export async function generateTemplateFill(
  args: GenerateTemplateFillArgs,
): Promise<{ result: TemplateFillResult | null; usage: AiUsage | null }> {
  const systemPrompt = buildTemplateFillSystemPrompt();
  const userPrompt = buildTemplateFillUserPrompt(args);

  const providerArgs = {
    apiKey: args.apiKey,
    model: args.model,
    systemPrompt,
    messages: [{ role: 'user' as const, content: userPrompt }],
    timeoutMs: aiRequestTimeoutMs(),
  };

  const { text, usage } =
    args.provider === 'openai'
      ? await generateOpenAi(providerArgs)
      : await generateAnthropic(providerArgs);

  return { result: parseTemplateFillResult(text, args.expectedIndices), usage };
}
