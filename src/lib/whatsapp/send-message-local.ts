import 'server-only';
import type { SqlConnection } from '@/lib/db/transaction';
import type { Contact, MessageTemplate } from '@/types';
import { queryRows } from '@/lib/db/rows';
import { getPool } from '@/lib/db/pool';
import { withAccount } from '@/lib/db/context';
import type { LocalAccountContext } from '@/lib/db/context';
import { resolveAccount } from '@/lib/db/context-core';
import { hasMinRole } from '@/lib/auth/roles';
import { decrypt, encrypt, isLegacyFormat } from './encryption';
import { isRecipientNotAllowedError, phoneVariants } from './phone-utils';
import { resolveContactSendTarget } from './wa-identity';
import { isMessageTemplate } from './template-row-guard';
import { templateBodyParams, templateContentText } from './template-body';
import { interactivePayloadPreviewText, type InteractiveMessagePayload } from './interactive';
import { sendInteractiveButtons, sendInteractiveList, sendMediaMessage, sendTemplateMessage, sendTextMessage, type MediaKind } from './meta-api';
import { SendMessageError, MEDIA_KINDS, validateSendMessageParams, type SendMessageParams } from './send-message-shared';
import type { SendTimeParams } from './template-send-builder';

interface SendContext {
  contact: Contact;
  phoneNumberId: string;
  encryptedToken: string;
  contextMessageId?: string;
  template: MessageTemplate | null;
  sendLanguage: string;
}

async function loadSendContext(db: SqlConnection, accountId: string, params: SendMessageParams): Promise<SendContext> {
  const conversations = await queryRows<{ id: string; contact: Contact }>(db,
    `SELECT c.id, to_jsonb(ct) AS contact FROM public.conversations c JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=$1 WHERE c.account_id=$1 AND c.id=$2`, [accountId, params.conversationId]);
  const conversation = conversations[0];
  if (!conversation) throw new SendMessageError('not_found', 'Conversation not found.', 404);
  if (!conversation.contact) throw new SendMessageError('not_found', 'Conversation contact not found.', 404);
  if (!resolveContactSendTarget(conversation.contact)) throw new SendMessageError('bad_request', conversation.contact.phone ? 'Invalid phone number format' : 'Contact has no phone number or WhatsApp user ID', 400);

  const configs = await queryRows<{ phone_number_id: string; access_token: string }>(db,
    'SELECT phone_number_id,access_token FROM public.whatsapp_config WHERE account_id=$1', [accountId]);
  const config = configs[0];
  if (!config) throw new SendMessageError('whatsapp_not_configured', 'WhatsApp not configured. Please set up your WhatsApp integration first.', 400);

  let contextMessageId: string | undefined;
  if (params.replyToMessageId) {
    const parents = await queryRows<{ message_id: string | null }>(db,
      'SELECT message_id FROM public.messages WHERE id=$1 AND conversation_id=$2', [params.replyToMessageId, params.conversationId]);
    if (!parents[0]) throw new SendMessageError('bad_request', 'reply_to_message_id not found in this conversation', 400);
    contextMessageId = parents[0].message_id ?? undefined;
  }

  let template: MessageTemplate | null = null;
  let sendLanguage = params.templateLanguage || 'en_US';
  if (params.messageType === 'template' && params.templateName) {
    const rows = await queryRows<{ template: MessageTemplate }>(db,
      'SELECT to_jsonb(t) AS template FROM public.message_templates t WHERE account_id=$1 AND name=$2 ORDER BY language', [accountId, params.templateName]);
    const templates = rows.map(row => row.template);
    const base = (language: string) => language.toLowerCase().split(/[_-]/)[0];
    if (params.templateLanguage) template = templates.find(row => row.language?.toLowerCase() === params.templateLanguage!.toLowerCase()) ?? templates.find(row => row.language && base(row.language) === base(params.templateLanguage!)) ?? null;
    else template = templates.find(row => row.language === 'en_US') ?? templates.find(row => row.language === 'en') ?? templates[0] ?? null;
    if (template && !isMessageTemplate(template)) throw new SendMessageError('template_malformed', 'Template row is malformed locally — run Sync from Meta in Settings to repair it.', 500);
    sendLanguage = params.templateLanguage || template?.language || 'en_US';
  }
  return { contact: conversation.contact, phoneNumberId: config.phone_number_id, encryptedToken: config.access_token, contextMessageId, template, sendLanguage };
}

async function sendToMeta(context: SendContext, params: SendMessageParams): Promise<{ messageId: string; workingPhone: string; originalPhone: string; isPhone: boolean }> {
  const target = resolveContactSendTarget(context.contact)!;
  const accessToken = decrypt(context.encryptedToken);
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(params.messageType);
  const attempt = async (to: string) => {
    if (params.messageType === 'template') return (await sendTemplateMessage({ phoneNumberId: context.phoneNumberId, accessToken, to, templateName: params.templateName!, language: context.sendLanguage, template: context.template ?? undefined, messageParams: params.templateMessageParams as SendTimeParams | undefined, params: params.templateParams, contextMessageId: context.contextMessageId })).messageId;
    if (isMediaKind) return (await sendMediaMessage({ phoneNumberId: context.phoneNumberId, accessToken, to, kind: params.messageType as MediaKind, link: params.mediaUrl!, caption: params.contentText || undefined, filename: params.filename || undefined, contextMessageId: context.contextMessageId })).messageId;
    if (params.messageType === 'interactive') {
      const payload = params.interactivePayload as InteractiveMessagePayload;
      if (payload.kind === 'buttons') return (await sendInteractiveButtons({ phoneNumberId: context.phoneNumberId, accessToken, to, bodyText: payload.body, headerText: payload.header || undefined, footerText: payload.footer || undefined, buttons: payload.buttons, contextMessageId: context.contextMessageId })).messageId;
      return (await sendInteractiveList({ phoneNumberId: context.phoneNumberId, accessToken, to, bodyText: payload.body, buttonLabel: payload.button_label, headerText: payload.header || undefined, footerText: payload.footer || undefined, sections: payload.sections, contextMessageId: context.contextMessageId })).messageId;
    }
    return (await sendTextMessage({ phoneNumberId: context.phoneNumberId, accessToken, to, text: params.contentText!, contextMessageId: context.contextMessageId })).messageId;
  };
  let lastError: unknown;
  for (const phone of target.isPhone ? phoneVariants(target.target) : [target.target]) {
    try { return { messageId: await attempt(phone), workingPhone: phone, originalPhone: target.target, isPhone: target.isPhone }; }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRecipientNotAllowedError(message)) throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'Unknown Meta API error';
  throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
}

type AccountMessageRunner = <T>(work: (db: SqlConnection) => Promise<T>) => Promise<T>;
export function sendLocalMessage(context: LocalAccountContext, params: SendMessageParams) {
  const run: AccountMessageRunner = work => withAccount(context, async db => {
    const current = await resolveAccount(db, context.userId);
    if (!hasMinRole(current.role, 'agent')) throw new SendMessageError('forbidden', 'Insufficient permissions.', 403);
    return work(db);
  });
  return sendAccountMessage(context, params, run);
}

/** Server service shared by role-checked dashboard and scope-checked API-key adapters. */
export async function sendAccountMessage(context: {accountId:string;userId:string}, params: SendMessageParams, run: AccountMessageRunner, options:{senderType?:'agent'|'bot';aiGenerated?:boolean}={}) {
  if (!params.conversationId) throw new SendMessageError('bad_request', 'conversation_id is required', 400);
  validateSendMessageParams(params);
  const loaded = await run(db => loadSendContext(db, context.accountId, params));
  const sent = await sendToMeta(loaded, params);
  const persistedText = params.messageType === 'interactive'
    ? (params.interactivePayload as InteractiveMessagePayload).body
    : params.messageType === 'template'
      ? templateContentText(loaded.template, templateBodyParams(params.templateParams, params.templateMessageParams), params.contentText)
      : params.contentText ?? null;
  const preview = params.messageType === 'interactive' ? interactivePayloadPreviewText(params.interactivePayload!) : persistedText || `[${params.messageType}]`;
  let messageId: string;
  try {
    messageId = await run(async db => {
    if (sent.isPhone && sent.workingPhone !== sent.originalPhone) await db.query('UPDATE public.contacts SET phone=$1 WHERE id=$2 AND account_id=$3', [sent.workingPhone, loaded.contact.id, context.accountId]);
    const inserted = await queryRows<{ id: string }>(db,
      `INSERT INTO public.messages(conversation_id,sender_type,sender_id,content_type,content_text,media_url,template_name,interactive_payload,message_id,status,reply_to_message_id,ai_generated)
       VALUES($1,$10,$2,$3,$4,$5,$6,$7,$8,'sent',$9,$11) RETURNING id`,
      [params.conversationId, context.userId, params.messageType, persistedText, params.mediaUrl || null, params.templateName || null, params.messageType === 'interactive' ? params.interactivePayload : null, sent.messageId, params.replyToMessageId || null,options.senderType??'agent',options.aiGenerated??false]);
    await db.query('UPDATE public.conversations SET last_message_text=$1,last_message_at=now(),updated_at=now() WHERE id=$2 AND account_id=$3', [preview, params.conversationId, context.accountId]);
    return inserted[0].id;
    });
  } catch (error) {
    console.error('[whatsapp/send] Accepted message could not be saved:', (error as {code?:string})?.code ?? 'internal');
    throw new SendMessageError('db_error', 'Message sent to WhatsApp but could not save it locally. Refresh the inbox before retrying.', 500);
  }
  if (isLegacyFormat(loaded.encryptedToken)) {
    try {
      await getPool('worker').query('UPDATE public.whatsapp_config SET access_token=$1,updated_at=now() WHERE account_id=$2 AND access_token=$3', [encrypt(decrypt(loaded.encryptedToken)), context.accountId, loaded.encryptedToken]);
    } catch { console.warn('[whatsapp/send] Legacy token upgrade failed.'); }
  }
  if(options.senderType!=='bot') try {
    await getPool('worker').query(`UPDATE public.flow_runs SET status='paused_by_agent',ended_at=now(),end_reason='agent_replied' WHERE account_id=$1 AND contact_id=$2 AND status='active'`, [context.accountId, loaded.contact.id]);
  } catch (error) { console.error('[flows] pause-on-agent-send failed:', error instanceof Error ? error.message : 'internal'); }
  return { messageId, whatsappMessageId: sent.messageId };
}
