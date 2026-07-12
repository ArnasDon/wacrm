export interface ConversationSummaryInput {
  customerMessage: string;
  aiReply: string;
}

export async function summarizeConversation(
  input: ConversationSummaryInput,
): Promise<string> {

  const customer = input.customerMessage.trim();
  const reply = input.aiReply.trim();

  return [
    `Customer: ${customer}`,
    `AI: ${reply}`,
  ].join("\n");
}