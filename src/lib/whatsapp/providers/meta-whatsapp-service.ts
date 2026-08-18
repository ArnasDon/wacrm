// ============================================================
// MetaWhatsAppService — the real Meta Cloud API implementation of
// WhatsAppService. Thin adapter over `@/lib/whatsapp/meta-api`'s
// existing, already-tested send functions: this class changes WHO
// calls them, not what they do, so it carries zero behaviour change
// versus the inline calls it replaces at each call site.
//
// Owns the phone-variant retry (Meta-specific: sandbox numbers /
// numbers saved with vs. without a trunk "0" both need this to land),
// which used to be duplicated at every call site.
// ============================================================

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendReactionMessage,
  type MetaSendResult,
} from '@/lib/whatsapp/meta-api';
import { isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils';
import type {
  WhatsAppService,
  WhatsAppSendResult,
  SendTextInput,
  SendTemplateInput,
  SendMediaInput,
  SendInteractiveButtonsInput,
  SendInteractiveListInput,
  SendReactionInput,
} from '@/lib/whatsapp/service';

export interface MetaWhatsAppServiceConfig {
  phoneNumberId: string;
  accessToken: string;
}

export class MetaWhatsAppService implements WhatsAppService {
  readonly isDemo = false as const;

  constructor(private readonly config: MetaWhatsAppServiceConfig) {}

  /**
   * Try each phone variant in order; only a "recipient not in allowed
   * list" error is worth another variant, any other failure (bad
   * template, rate limit, invalid token, ...) is not retryable and
   * propagates immediately. Same semantics every caller had inline
   * before this class existed.
   */
  private async withPhoneRetry(
    toVariants: string[],
    attempt: (phone: string) => Promise<MetaSendResult>
  ): Promise<WhatsAppSendResult> {
    let lastError: unknown = null;
    for (const variant of toVariants) {
      try {
        const result = await attempt(variant);
        return { messageId: result.messageId, workingPhone: variant };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('No phone variant succeeded');
  }

  async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
    return this.withPhoneRetry(input.toVariants, (to) =>
      sendTextMessage({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to,
        text: input.text,
        contextMessageId: input.contextMessageId,
      })
    );
  }

  async sendTemplate(input: SendTemplateInput): Promise<WhatsAppSendResult> {
    return this.withPhoneRetry(input.toVariants, (to) =>
      sendTemplateMessage({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to,
        templateName: input.templateName,
        language: input.language,
        params: input.params,
        template: input.template,
        messageParams: input.messageParams,
        contextMessageId: input.contextMessageId,
      })
    );
  }

  async sendMedia(input: SendMediaInput): Promise<WhatsAppSendResult> {
    return this.withPhoneRetry(input.toVariants, (to) =>
      sendMediaMessage({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to,
        kind: input.kind,
        link: input.link,
        caption: input.caption,
        filename: input.filename,
        contextMessageId: input.contextMessageId,
      })
    );
  }

  async sendInteractiveButtons(
    input: SendInteractiveButtonsInput
  ): Promise<WhatsAppSendResult> {
    return this.withPhoneRetry(input.toVariants, (to) =>
      sendInteractiveButtons({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to,
        bodyText: input.bodyText,
        headerText: input.headerText,
        footerText: input.footerText,
        buttons: input.buttons,
        contextMessageId: input.contextMessageId,
      })
    );
  }

  async sendInteractiveList(
    input: SendInteractiveListInput
  ): Promise<WhatsAppSendResult> {
    return this.withPhoneRetry(input.toVariants, (to) =>
      sendInteractiveList({
        phoneNumberId: this.config.phoneNumberId,
        accessToken: this.config.accessToken,
        to,
        bodyText: input.bodyText,
        buttonLabel: input.buttonLabel,
        headerText: input.headerText,
        footerText: input.footerText,
        sections: input.sections,
        contextMessageId: input.contextMessageId,
      })
    );
  }

  async sendReaction(input: SendReactionInput): Promise<WhatsAppSendResult> {
    const result = await sendReactionMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: input.to,
      targetMessageId: input.targetMessageId,
      emoji: input.emoji,
    });
    return { messageId: result.messageId, workingPhone: input.to };
  }
}
