import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { supabaseAdmin } from './admin-client';

interface CommonArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
}

/**
 * Flows delegate to the shared conversation sender. This keeps provider
 * pinning, BSUID mapping, persistence, and retries identical to Inbox,
 * automations, and AI replies.
 */
export async function engineSendText(
  args: CommonArgs & { text: string; aiGenerated?: boolean }
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendMessageToConversation(supabaseAdmin(), args.accountId, {
    conversationId: args.conversationId,
    messageType: 'text',
    contentText: args.text,
    senderType: 'bot',
    aiGenerated: args.aiGenerated,
  });
  return { whatsapp_message_id: result.whatsappMessageId };
}

export async function engineSendMedia(
  args: CommonArgs & {
    kind: MediaKind;
    link: string;
    caption?: string;
    filename?: string;
  }
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendMessageToConversation(supabaseAdmin(), args.accountId, {
    conversationId: args.conversationId,
    messageType: args.kind,
    mediaUrl: args.link,
    contentText: args.caption,
    filename: args.filename,
    senderType: 'bot',
  });
  return { whatsapp_message_id: result.whatsappMessageId };
}

export async function engineSendInteractiveButtons(
  args: CommonArgs & {
    bodyText: string;
    buttons: InteractiveButton[];
    headerText?: string;
    footerText?: string;
  }
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendMessageToConversation(supabaseAdmin(), args.accountId, {
    conversationId: args.conversationId,
    messageType: 'interactive',
    interactivePayload: {
      kind: 'buttons', body: args.bodyText, buttons: args.buttons,
      header: args.headerText, footer: args.footerText,
    },
    senderType: 'bot',
  });
  return { whatsapp_message_id: result.whatsappMessageId };
}

export async function engineSendInteractiveList(
  args: CommonArgs & {
    bodyText: string;
    buttonLabel: string;
    sections: InteractiveListSection[];
    headerText?: string;
    footerText?: string;
  }
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendMessageToConversation(supabaseAdmin(), args.accountId, {
    conversationId: args.conversationId,
    messageType: 'interactive',
    interactivePayload: {
      kind: 'list', body: args.bodyText, button_label: args.buttonLabel,
      sections: args.sections, header: args.headerText, footer: args.footerText,
    },
    senderType: 'bot',
  });
  return { whatsapp_message_id: result.whatsappMessageId };
}
