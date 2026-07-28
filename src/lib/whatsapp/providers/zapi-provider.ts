/**
 * Thin adapter over `zapi-api.ts`, mirroring `uazapi-provider.ts`'s
 * role: maps the normalized `WhatsAppProvider` args onto Z-API's
 * endpoint shapes. Does NOT implement `MetaTemplateCapability` — like
 * uazapi, Z-API rides a self-managed number with no approved-template
 * pipeline.
 */

import {
  sendText,
  sendImage,
  sendVideo,
  sendAudio,
  sendDocument,
  sendReaction,
  removeReaction,
  sendButtonList,
  sendOptionList,
} from '../zapi-api'
import type {
  WhatsAppProvider,
  SendTextArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  ProviderMessageResult,
} from '../provider-types'

export interface ZapiProviderConfig {
  instanceId: string
  token: string
  /** Optional per-account Z-API security header; undefined when not configured. */
  clientToken?: string
}

/**
 * Best-effort file extension for Z-API's `/send-document/{extension}`
 * path segment — prefers the filename (e.g. "report.pdf" → "pdf"),
 * falls back to the link's own extension, and defaults to "pdf" as
 * the most common case when neither is present (Z-API requires
 * *some* extension in the path; there's no "unknown" option).
 */
function extractExtension(filename?: string, link?: string): string {
  const fromName = filename?.split('.').pop()
  if (fromName && fromName.length <= 8) return fromName.toLowerCase()
  const fromLink = link?.split('?')[0]?.split('.').pop()
  if (fromLink && fromLink.length <= 8) return fromLink.toLowerCase()
  return 'pdf'
}

export class ZapiProvider implements WhatsAppProvider {
  readonly kind = 'zapi' as const

  constructor(private readonly config: ZapiProviderConfig) {}

  private get creds() {
    return {
      instanceId: this.config.instanceId,
      token: this.config.token,
      clientToken: this.config.clientToken,
    }
  }

  sendText(args: SendTextArgs): Promise<ProviderMessageResult> {
    // Z-API's /send-text has no reply-context field — same
    // interface-parity-only note as uazapi's sendText.
    return sendText({ ...this.creds, phone: args.to, message: args.text })
  }

  sendMedia(args: SendMediaArgs): Promise<ProviderMessageResult> {
    switch (args.kind) {
      case 'image':
        return sendImage({
          ...this.creds,
          phone: args.to,
          image: args.link,
          caption: args.caption,
          messageId: args.contextMessageId,
        })
      case 'video':
        return sendVideo({
          ...this.creds,
          phone: args.to,
          video: args.link,
          caption: args.caption,
          messageId: args.contextMessageId,
        })
      case 'audio':
        // Z-API's /send-audio has no caption/reply-context param.
        return sendAudio({ ...this.creds, phone: args.to, audio: args.link })
      case 'document':
        return sendDocument({
          ...this.creds,
          phone: args.to,
          document: args.link,
          extension: extractExtension(args.filename, args.link),
          fileName: args.filename,
          caption: args.caption,
          messageId: args.contextMessageId,
        })
    }
  }

  sendReaction(args: SendReactionArgs): Promise<ProviderMessageResult> {
    // Z-API models "remove a reaction" as its own endpoint rather than
    // an empty-emoji send — same convention send-core.ts already
    // expects from providers (empty emoji = removal).
    if (!args.emoji) {
      return removeReaction({ ...this.creds, phone: args.to, messageId: args.targetMessageId })
    }
    return sendReaction({
      ...this.creds,
      phone: args.to,
      messageId: args.targetMessageId,
      reaction: args.emoji,
    })
  }

  sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<ProviderMessageResult> {
    // Z-API's button list has no separate header/footer field — same
    // drop-not-fold reasoning as uazapi's sendMenu adapter.
    return sendButtonList({
      ...this.creds,
      phone: args.to,
      message: args.bodyText,
      buttons: args.buttons.map((b) => ({ id: b.id, label: b.title })),
    })
  }

  sendInteractiveList(args: SendInteractiveListArgs): Promise<ProviderMessageResult> {
    // Z-API's option list is flat (one title, one options array) —
    // unlike uazapi's string-based menu, there's no inline section
    // marker convention to reuse, so a section's title (when present)
    // is folded into each of its rows' description instead of being
    // dropped silently.
    const options = args.sections.flatMap((section) =>
      section.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: section.title
          ? [section.title, row.description].filter(Boolean).join(' — ')
          : row.description,
      })),
    )
    return sendOptionList({
      ...this.creds,
      phone: args.to,
      message: args.bodyText,
      title: args.headerText ?? args.sections[0]?.title ?? args.buttonLabel,
      buttonLabel: args.buttonLabel,
      options,
    })
  }
}
