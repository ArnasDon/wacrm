import type { Message, MessageTemplate, TemplateButton } from '@/types';

export type TemplateMessageHeader =
  | { type: 'text'; text: string }
  | { type: 'image' | 'video' | 'document'; url: string | null };

export interface TemplateMessageView {
  header: TemplateMessageHeader | null;
  footer: string | null;
  buttons: TemplateButton[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bodyMatches(body: string, text: string): boolean {
  const literal = body.split(/\{\{\d+\}\}/).map(escapeRegExp);
  return new RegExp(`^${literal.join('[\\s\\S]*?')}$`).test(text);
}

export function matchMessageTemplate(
  message: Pick<Message, 'template_name' | 'content_text'>,
  templates: MessageTemplate[]
): MessageTemplate | null {
  if (!message.template_name) return null;
  const named = templates.filter((t) => t.name === message.template_name);
  if (named.length <= 1) return named[0] ?? null;
  const text = message.content_text;
  return (
    (text ? named.find((t) => bodyMatches(t.body_text, text)) : undefined) ??
    named[0]
  );
}

export function templateMessageView(
  message: Pick<Message, 'media_url'>,
  template: MessageTemplate | null
): TemplateMessageView {
  const headerType = template?.header_type;
  let header: TemplateMessageHeader | null = null;
  if (headerType === 'text') {
    header = template?.header_content
      ? { type: 'text', text: template.header_content }
      : null;
  } else if (headerType) {
    header = {
      type: headerType,
      url: message.media_url || template?.header_media_url || null,
    };
  }
  return {
    header,
    footer: template?.footer_text || null,
    buttons: template?.buttons ?? [],
  };
}

export function templateNamesInMessages(
  messages: Pick<Message, 'content_type' | 'template_name'>[]
): string[] {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.content_type === 'template' && m.template_name) {
      names.add(m.template_name);
    }
  }
  return [...names].sort();
}
