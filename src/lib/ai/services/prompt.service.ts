import { supabaseAdmin } from "@/lib/automations/admin-client";

import type {
  PromptRequest,
  PromptResponse,
} from "./prompt.types";

const DEFAULT_PROMPT = `
You are Relaxio Spa's AI Sales Assistant.

Primary goals:

- Convert enquiries into bookings.
- Reply naturally.
- Reply briefly.
- Ask only ONE question at a time.
- Never generate long paragraphs.
- Use the customer's language.
- Escalate complex issues to human support.
`;

async function loadDatabasePrompt(
  request: PromptRequest,
): Promise<PromptResponse | null> {

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("ai_prompts")
    .select("system_prompt, version")
    .eq("provider", request.provider)
    .eq("enabled", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    prompt: data.system_prompt,
    version: data.version,
  };
}

function buildPrompt(
  request: PromptRequest,
): string {

  const sections: string[] = [];

  sections.push(DEFAULT_PROMPT);

  if (request.context?.business) {
    sections.push(`
Business

Spa: ${request.context.business.spaName}
City: ${request.context.business.city}
`);
  }

  if (request.context?.customer?.name) {
    sections.push(`
Customer

Name: ${request.context.customer.name}
`);
  }

  if (request.context?.memory?.length) {
    sections.push(`
Customer Memory

${request.context.memory.join("\n")}
`);
  }

  if (request.context?.knowledge?.length) {
    sections.push(`
Knowledge Base

${request.context.knowledge.join("\n")}
`);
  }

  sections.push(`
Customer Message

${request.context?.message ?? ""}
`);

  return sections.join("\n\n");
}

export async function getSystemPrompt(
  request: PromptRequest,
): Promise<PromptResponse> {

  const databasePrompt =
    await loadDatabasePrompt(request);

  if (databasePrompt) {
    return databasePrompt;
  }

  return {
    prompt: buildPrompt(request),
    version: 2,
  };
}