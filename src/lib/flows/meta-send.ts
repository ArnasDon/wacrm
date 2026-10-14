import type { SqlConnection } from '@/lib/db/transaction';
import { queryRows } from '@/lib/db/rows';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sendWorkerMessage,
  type WorkerSendIdentity,
} from '@/lib/whatsapp/send-message-worker';
import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api';
export async function loadAccountMetaCredentials(
  db: SqlConnection,
  accountId: string
) {
  const [config] = await queryRows<{
    phone_number_id: string;
    access_token: string;
  }>(
    db,
    'SELECT phone_number_id,access_token FROM public.whatsapp_config WHERE account_id=$1',
    [accountId]
  );
  if (!config) throw new Error('WhatsApp not configured for this account');
  return {
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  };
}
export function engineSendText(
  args: WorkerSendIdentity & { text: string; aiGenerated?: boolean }
) {
  return sendWorkerMessage(
    args,
    { messageType: 'text', contentText: args.text },
    args.aiGenerated
  );
}
export function engineSendMedia(
  args: WorkerSendIdentity & {
    kind: MediaKind;
    link: string;
    caption?: string;
    filename?: string;
  }
) {
  return sendWorkerMessage(args, {
    messageType: args.kind,
    mediaUrl: args.link,
    contentText: args.caption,
    filename: args.filename,
  });
}
export function engineSendInteractiveButtons(
  args: WorkerSendIdentity & {
    bodyText: string;
    buttons: InteractiveButton[];
    headerText?: string;
    footerText?: string;
  }
) {
  return sendWorkerMessage(args, {
    messageType: 'interactive',
    interactivePayload: {
      kind: 'buttons',
      body: args.bodyText,
      buttons: args.buttons,
      header: args.headerText,
      footer: args.footerText,
    },
  });
}
export function engineSendInteractiveList(
  args: WorkerSendIdentity & {
    bodyText: string;
    buttonLabel: string;
    sections: InteractiveListSection[];
    headerText?: string;
    footerText?: string;
  }
) {
  return sendWorkerMessage(args, {
    messageType: 'interactive',
    interactivePayload: {
      kind: 'list',
      body: args.bodyText,
      button_label: args.buttonLabel,
      sections: args.sections,
      header: args.headerText,
      footer: args.footerText,
    },
  });
}
