import { generateAIReply } from "./providers/gemini";
import { getRuleBasedReply } from "./rule-router";

export async function routeToAI(message: string) {

  const rule = getRuleBasedReply(message);

  if (rule) {
    return rule;
  }

  // Gemini handles everything for now.
  return generateAIReply(message);
}
