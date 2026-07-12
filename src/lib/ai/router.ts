import { buildContext } from "./context/builder";
import { generateGatewayReply } from "./gateway";
import { getRuleBasedReply } from "./rule-router";

import { saveHotMemory } from "./memory/engine";
import { summarizeConversation } from "./memory/summarizer";

export interface RouteToAIRequest {
  message: string;
  accountId?: string;
  contactId?: string;
  conversationId?: string;
}

export async function routeToAI(
  request: RouteToAIRequest,
) {
  const rule = getRuleBasedReply(request.message);

  if (rule) {
    return rule;
  }

  const context = await buildContext(
  request.message,
  {
    accountId: request.accountId,
    contactId: request.contactId,
    conversationId: request.conversationId,
  },
);

  const response = await generateGatewayReply(context);

if (
  request.accountId &&
  request.contactId
) {

  const summary =
    await summarizeConversation({
      customerMessage: request.message,
      aiReply: response.reply,
    });

  await saveHotMemory({
    accountId: request.accountId,
    contactId: request.contactId,
    conversationId:
      request.conversationId,
    summary,
    updatedBy: "ai",
  });

}

return response;
}
