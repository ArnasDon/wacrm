import type { AIResponse } from "./types";
import type { AIContext } from "./context/builder";

import { generateAIReply } from "./providers/gemini";
import { generateChatGPTReply } from "./providers/chatgpt";

import { getActiveProvider } from "./services/provider.service";

export async function generateGatewayReply(
  context: AIContext,
): Promise<AIResponse> {

  const provider = await getActiveProvider();

  switch (provider.provider) {

    case "openai":
      return generateChatGPTReply(context);

    case "gemini":
    default:
      return generateAIReply(context);

  }

}