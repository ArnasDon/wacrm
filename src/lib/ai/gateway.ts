import type { AIResponse } from "./types";
import { generateAIReply } from "./providers/gemini";
import { generateChatGPTReply } from "./providers/chatgpt";

export type AIProvider = "gemini" | "openai";

export interface GatewayRequest {
  provider: AIProvider;
  message: string;
}

export async function generateReply(
  request: GatewayRequest
): Promise<AIResponse> {

  switch (request.provider) {

    case "openai":
      return generateChatGPTReply(request.message);

    case "gemini":
    default:
      return generateAIReply(request.message);

  }

}
