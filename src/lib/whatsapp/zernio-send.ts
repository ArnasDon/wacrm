// ============================================================
// WhatsApp-via-Zernio send helpers — called from inside
// `sendMessageToConversation`'s `attempt()` closure (and the Flows/
// automations engines' WhatsApp branch) when `whatsapp_config.provider
// === 'zernio'`. Unlike the Meta-direct path, Zernio addresses a
// conversation by its own opaque id rather than a phone number, so
// there is no phone-variant retry here — see each function's
// `requireZernioConversation` guard.
// ============================================================

import {
  sendZernioText,
  sendZernioMedia,
  sendZernioTemplate,
  sendZernioButtons,
  sendZernioInteractive,
  type ZernioMediaKind,
} from '@/lib/zernio/api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSendComponents, type SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { MessageTemplate } from '@/types';

export interface WhatsAppZernioConfigRow {
  zernio_api_key: string;
  zernio_account_id: string;
}

export interface ZernioSendContext {
  config: WhatsAppZernioConfigRow;
  /** `conversations.zernio_conversation_id` — set by the Zernio webhook on first inbound message. */
  zernioConversationId: string | null;
}

function requireZernioConversation(ctx: ZernioSendContext): string {
  if (!ctx.zernioConversationId) {
    throw new Error(
      'No Zernio conversation exists yet for this contact. The customer needs to message first before an agent, automation, or flow can reply.',
    );
  }
  return ctx.zernioConversationId;
}

export async function sendWhatsAppTextViaZernio(
  ctx: ZernioSendContext,
  text: string,
): Promise<{ messageId: string }> {
  const apiKey = decrypt(ctx.config.zernio_api_key);
  return sendZernioText({
    apiKey,
    conversationId: requireZernioConversation(ctx),
    accountId: ctx.config.zernio_account_id,
    text,
  });
}

export async function sendWhatsAppMediaViaZernio(
  ctx: ZernioSendContext,
  kind: ZernioMediaKind,
  link: string,
  caption?: string,
  filename?: string,
): Promise<{ messageId: string }> {
  const apiKey = decrypt(ctx.config.zernio_api_key);
  return sendZernioMedia({
    apiKey,
    conversationId: requireZernioConversation(ctx),
    accountId: ctx.config.zernio_account_id,
    kind,
    link,
    caption,
    filename,
  });
}

export interface SendWhatsAppTemplateViaZernioArgs {
  templateName: string;
  language: string;
  /** Row from `message_templates` — when present, `buildSendComponents` fills header/body/button parameters, same as the direct-Meta path. */
  template?: MessageTemplate;
  messageParams?: SendTimeParams;
  /** Legacy body-only params, folded into `messageParams.body` when both are absent. */
  params?: string[];
}

export async function sendWhatsAppTemplateViaZernio(
  ctx: ZernioSendContext,
  args: SendWhatsAppTemplateViaZernioArgs,
): Promise<{ messageId: string }> {
  const { templateName, language, template, messageParams, params } = args;
  const apiKey = decrypt(ctx.config.zernio_api_key);

  let components: unknown[] = [];
  if (template) {
    components = buildSendComponents(template, {
      body: messageParams?.body ?? params,
      headerText: messageParams?.headerText,
      headerMediaUrl: messageParams?.headerMediaUrl,
      headerMediaId: messageParams?.headerMediaId,
      buttonParams: messageParams?.buttonParams,
    });
  } else if (params && params.length > 0) {
    components = [
      { type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) },
    ];
  }

  return sendZernioTemplate({
    apiKey,
    conversationId: requireZernioConversation(ctx),
    accountId: ctx.config.zernio_account_id,
    templateName,
    language,
    components,
  });
}

export async function sendWhatsAppInteractiveViaZernio(
  ctx: ZernioSendContext,
  payload: InteractiveMessagePayload,
): Promise<{ messageId: string }> {
  const apiKey = decrypt(ctx.config.zernio_api_key);
  const conversationId = requireZernioConversation(ctx);

  if (payload.kind === 'buttons') {
    return sendZernioButtons({
      apiKey,
      conversationId,
      accountId: ctx.config.zernio_account_id,
      text: payload.body,
      buttons: payload.buttons.map((b) => ({ id: b.id, title: b.title })),
    });
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: payload.body },
    action: {
      button: payload.button_label,
      sections: payload.sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  };
  if (payload.header) interactive.header = { type: 'text', text: payload.header };
  if (payload.footer) interactive.footer = { text: payload.footer };

  return sendZernioInteractive({ apiKey, conversationId, accountId: ctx.config.zernio_account_id, interactive });
}
