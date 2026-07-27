/**
 * Thin adapter over `meta-api.ts` — the low-level Meta HTTP client is
 * untouched by this file. `MetaProvider` only maps the normalized
 * `WhatsAppProvider` args onto the named-param shape `meta-api.ts`
 * already expects, so `phoneNumberId`/`accessToken` don't have to be
 * threaded through every call site anymore.
 */

import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendReactionMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '../meta-api'
import type {
  WhatsAppProvider,
  SendTextArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendTemplateArgs,
  ProviderMessageResult,
} from '../provider-types'

export interface MetaProviderConfig {
  phoneNumberId: string
  accessToken: string
}

export class MetaProvider implements WhatsAppProvider {
  readonly kind = 'meta' as const

  constructor(private readonly config: MetaProviderConfig) {}

  sendText(args: SendTextArgs): Promise<ProviderMessageResult> {
    return sendTextMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      text: args.text,
      contextMessageId: args.contextMessageId,
    })
  }

  sendMedia(args: SendMediaArgs): Promise<ProviderMessageResult> {
    return sendMediaMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      kind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
      contextMessageId: args.contextMessageId,
    })
  }

  sendReaction(args: SendReactionArgs): Promise<ProviderMessageResult> {
    return sendReactionMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      targetMessageId: args.targetMessageId,
      emoji: args.emoji,
    })
  }

  sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<ProviderMessageResult> {
    return sendInteractiveButtons({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      bodyText: args.bodyText,
      headerText: args.headerText,
      footerText: args.footerText,
      buttons: args.buttons,
      contextMessageId: args.contextMessageId,
    })
  }

  sendInteractiveList(args: SendInteractiveListArgs): Promise<ProviderMessageResult> {
    return sendInteractiveList({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      bodyText: args.bodyText,
      buttonLabel: args.buttonLabel,
      headerText: args.headerText,
      footerText: args.footerText,
      sections: args.sections,
      contextMessageId: args.contextMessageId,
    })
  }

  /**
   * Meta-only capability — deliberately not part of `WhatsAppProvider`.
   * Reached only through the `isMetaProvider()` type guard.
   */
  sendTemplate(args: SendTemplateArgs): Promise<ProviderMessageResult> {
    return sendTemplateMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      templateName: args.templateName,
      language: args.language,
      params: args.params,
      template: args.template,
      messageParams: args.messageParams,
      contextMessageId: args.contextMessageId,
    })
  }
}
