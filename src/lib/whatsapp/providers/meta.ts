/**
 * Meta provider — thin adapter over `meta-api.ts` implementing the
 * provider-agnostic `WhatsAppProvider` interface. Behaviour for Meta
 * accounts is unchanged; this only renames/reshapes the return values
 * so callers can treat Meta and Uazapi identically.
 */

import type {
  WhatsAppProvider,
  SendTextArgs,
  SendMediaArgs,
  SendTemplateArgs,
  DownloadMediaArgs,
  DownloadMediaResult,
  SendResult,
  ReactArgs,
} from './types'
import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendReactionMessage,
  getMediaUrl,
  downloadMedia as downloadMetaMedia,
  type MediaKind,
} from '../meta-api'
import type { MessageTemplate } from '@/types'
import type { SendTimeParams } from '../template-send-builder'

export interface MetaProviderConfig {
  phoneNumberId: string
  accessToken: string
}

export class MetaProvider implements WhatsAppProvider {
  readonly name = 'meta' as const

  constructor(private readonly config: MetaProviderConfig) {}

  async sendText(args: SendTextArgs): Promise<SendResult> {
    const result = await sendTextMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      text: args.text,
      contextMessageId: args.replyToExternalId,
    })
    return { externalMessageId: result.messageId }
  }

  async sendMedia(args: SendMediaArgs): Promise<SendResult> {
    const result = await sendMediaMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      kind: args.kind as MediaKind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
      contextMessageId: args.replyToExternalId,
    })
    return { externalMessageId: result.messageId }
  }

  async sendTemplate(args: SendTemplateArgs): Promise<SendResult> {
    const result = await sendTemplateMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      templateName: args.templateName,
      language: args.language || 'en_US',
      params: args.params,
      template: args.templateRow as MessageTemplate | undefined,
      messageParams: args.messageParams as SendTimeParams | undefined,
      contextMessageId: args.replyToExternalId,
    })
    return { externalMessageId: result.messageId }
  }

  async downloadMedia(args: DownloadMediaArgs): Promise<DownloadMediaResult> {
    const { url } = await getMediaUrl({
      mediaId: args.mediaRef,
      accessToken: this.config.accessToken,
    })
    const { buffer, contentType } = await downloadMetaMedia({
      downloadUrl: url,
      accessToken: this.config.accessToken,
    })
    return { buffer, contentType }
  }

  async reactToMessage(args: ReactArgs): Promise<void> {
    await sendReactionMessage({
      phoneNumberId: this.config.phoneNumberId,
      accessToken: this.config.accessToken,
      to: args.to,
      targetMessageId: args.targetExternalId,
      emoji: args.emoji,
    })
  }
}
