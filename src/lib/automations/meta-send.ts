import {
  sendWorkerMessage,
  type WorkerSendIdentity,
} from '@/lib/whatsapp/send-message-worker';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
export function engineSendText(args: WorkerSendIdentity & { text: string }) {
  return sendWorkerMessage(args, {
    messageType: 'text',
    contentText: args.text,
  });
}
export function engineSendTemplate(
  args: WorkerSendIdentity & {
    templateName: string;
    language?: string;
    params?: string[];
  }
) {
  return sendWorkerMessage(args, {
    messageType: 'template',
    templateName: args.templateName,
    templateLanguage: args.language,
    templateParams: args.params,
  });
}
export function engineSendInteractive(
  args: WorkerSendIdentity & { payload: InteractiveMessagePayload }
) {
  return sendWorkerMessage(args, {
    messageType: 'interactive',
    interactivePayload: args.payload,
  });
}
