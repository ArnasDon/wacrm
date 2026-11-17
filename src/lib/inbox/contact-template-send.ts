import type { MessageTemplate } from "@/types";
import type { TemplateSendValues } from "@/components/inbox/template-picker";

export function contactTemplateSendBody(
  contactId: string,
  template: Pick<MessageTemplate, "name" | "language">,
  values: TemplateSendValues,
) {
  return {
    contact_id: contactId,
    message_type: "template",
    template_name: template.name,
    template_language: template.language,
    template_message_params: {
      body: values.body,
      headerText: values.headerText,
      buttonParams: values.buttonParams,
    },
    template_params: values.body,
  };
}

export type ContactTemplateSendResult =
  | { ok: true; conversationId: string | null }
  | { ok: false; reason: string };

export async function sendContactTemplate(
  contactId: string,
  template: Pick<MessageTemplate, "name" | "language">,
  values: TemplateSendValues,
  fetchImpl: typeof fetch = fetch,
): Promise<ContactTemplateSendResult> {
  const res = await fetchImpl("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contactTemplateSendBody(contactId, template, values)),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, reason: payload?.error || `HTTP ${res.status}` };
  }
  const conversationId =
    typeof payload?.conversation_id === "string" ? payload.conversation_id : null;
  return { ok: true, conversationId };
}
