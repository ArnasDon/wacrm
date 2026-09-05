import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from '@/lib/flows/meta-send';
import { toEngineError } from '@/lib/whatsapp/engine-error';
import { sendViaConnection } from '@/lib/whatsapp/send-core';
import {
  resolveTemplateRow,
  templateContentText,
} from '@/lib/whatsapp/template-body';
import { supabaseAdmin } from './admin-client';

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Thin wrappers over `sendViaConnection`, the shared send core, that
// keep this engine's own error vocabulary via `toEngineError`. Uses the
// service-role client because the engine has no cookies. Still resolves
// the local template row itself — only to compute the text persisted to
// `messages.content_text` / `conversations.last_message_text`, not for
// the payload sent to Meta.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_connections
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string;
  /** Original author of the automation/flow — used for INSERT audit
   *  columns (messages.sender_id-ish) and for resolving the agent's
   *  identity in logs. Not consulted for tenancy. */
  userId: string;
  conversationId: string;
  contactId: string;
  text: string;
}

interface SendTemplateArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  templateName: string;
  language?: string;
  params?: string[];
}

export async function engineSendText(
  args: SendTextArgs
): Promise<{ whatsapp_message_id: string }> {
  try {
    const result = await sendViaConnection(supabaseAdmin(), args.accountId, {
      conversationId: args.conversationId,
      contactId: args.contactId,
      message: { kind: 'text', text: args.text },
      senderType: 'bot',
    });
    return { whatsapp_message_id: result.providerMessageId };
  } catch (err) {
    throw toEngineError(err);
  }
}

export async function engineSendTemplate(
  args: SendTemplateArgs
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin();

  // Linha local lida SÓ para o corpo que persistimos — o payload que vai
  // para a Meta continua sendo `params` puro, deliberadamente. Uma linha
  // ausente ou malformada não impede o envio; só nos deixa sem como
  // reconstruir o texto que o cliente viu.
  const templateRow = (
    await resolveTemplateRow(
      db,
      args.accountId,
      args.templateName,
      args.language
    )
  ).row;

  const persistedText = templateContentText(templateRow, args.params ?? []);

  try {
    const result = await sendViaConnection(db, args.accountId, {
      conversationId: args.conversationId,
      contactId: args.contactId,
      message: {
        kind: 'template',
        templateName: args.templateName,
        // Idioma cru do autor da automação, não o resolvido.
        language: args.language,
        params: args.params,
        persistedText,
      },
      senderType: 'bot',
      // O núcleo resumiria com `persistedText || '[template]'`; este
      // engine sempre usou o nome do template no fallback.
      previewText: persistedText ?? `[template:${args.templateName}]`,
    });
    return { whatsapp_message_id: result.providerMessageId };
  } catch (err) {
    throw toEngineError(err);
  }
}

interface SendInteractiveArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  payload: InteractiveMessagePayload;
}

/**
 * Send an interactive (reply-buttons or list) message from the
 * automation engine.
 *
 * Delegates to the Flows interactive senders
 * (`engineSendInteractiveButtons` / `engineSendInteractiveList`), which
 * already own the account-scoped lookup, phone-variant retry, and the
 * `messages` insert with `interactive_payload` + `sender_type='bot'`.
 * Both engines want identical behaviour here, so there's one
 * implementation rather than a second hand-rolled copy that could drift.
 */
export async function engineSendInteractive(
  args: SendInteractiveArgs
): Promise<{ whatsapp_message_id: string }> {
  const { payload, accountId, userId, conversationId, contactId } = args;
  const common = { accountId, userId, conversationId, contactId };
  if (payload.kind === 'buttons') {
    return engineSendInteractiveButtons({
      ...common,
      bodyText: payload.body,
      headerText: payload.header,
      footerText: payload.footer,
      buttons: payload.buttons,
    });
  }
  return engineSendInteractiveList({
    ...common,
    bodyText: payload.body,
    buttonLabel: payload.button_label,
    headerText: payload.header,
    footerText: payload.footer,
    sections: payload.sections,
  });
}
