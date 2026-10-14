import { validateInteractivePayload, type InteractiveMessagePayload } from './interactive';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = ['text', 'template', 'interactive', ...MEDIA_KINDS] as const;

export class SendMessageError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'SendMessageError';
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[];
  templateMessageParams?: unknown;
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export function validateSendMessageParams(params: Pick<SendMessageParams, 'messageType' | 'contentText' | 'mediaUrl' | 'templateName' | 'interactivePayload'>): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } = params;
  if (!messageType) throw new SendMessageError('bad_request', 'message_type is required', 400);
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);
  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) throw new SendMessageError('bad_request', `Unsupported message_type "${messageType}"`, 400);
  if (messageType === 'text' && !contentText) throw new SendMessageError('bad_request', 'content_text is required for text messages', 400);
  if (messageType === 'template' && !templateName) throw new SendMessageError('bad_request', 'template_name is required for template messages', 400);
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) throw new SendMessageError('bad_request', result.error, 400);
  }
  if (isMediaKind && !mediaUrl) throw new SendMessageError('bad_request', `media_url is required for ${messageType} messages`, 400);
  if (isMediaKind && messageType !== 'audio' && contentText && contentText.length > 1024) throw new SendMessageError('bad_request', 'Caption exceeds the 1024-character limit', 400);
}
