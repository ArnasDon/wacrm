import { getHotMemory } from "@/lib/ai/memory/retriever";
import { getBusinessContext } from "./business";
import { getCustomerContext } from "./customer";
import { getKnowledgeContext } from "./knowledge";

export interface AIContext {
  message: string;

  accountId?: string;

  conversationId?: string;

  customer: {
    id?: string;
    name?: string;
    phone?: string;
  };

  business: {
    spaName: string;
    city: string;
    timezone?: string;
    language?: string;
    currency?: string;
  };

  memory: string[];

  knowledge: string[];
}

export interface BuildContextOptions {
  accountId?: string;
  contactId?: string;
  conversationId?: string;
}

export async function buildContext(
  message: string,
  options?: BuildContextOptions,
): Promise<AIContext> {

  const memory: string[] = [];

  if (options?.contactId) {

    const hotMemory = await getHotMemory(
      options.contactId,
    );

    if (hotMemory?.summary) {
      memory.push(hotMemory.summary);
    }

  }

  return {

    message,

    accountId: options?.accountId,

    conversationId: options?.conversationId,

    customer: await getCustomerContext(
  options?.contactId,
),

    business: await getBusinessContext(
  options?.accountId,
),

    memory,

    knowledge: await getKnowledgeContext(
  options?.accountId,
),

  };

}