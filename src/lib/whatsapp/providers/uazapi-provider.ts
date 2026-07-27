/**
 * Thin adapter over `uazapi-api.ts`, the low-level uazapi HTTP client.
 * Mirrors `meta-provider.ts`'s role: maps the normalized
 * `WhatsAppProvider` args onto uazapi's endpoint shapes. Does NOT
 * implement `MetaTemplateCapability` — pre-approved templates have no
 * uazapi equivalent (see provider-types.ts).
 */

import { sendText, sendMedia, sendMenu, sendReaction } from '../uazapi-api'
import type {
  WhatsAppProvider,
  SendTextArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  ProviderMessageResult,
} from '../provider-types'

export interface UazapiProviderConfig {
  instanceId: string
  token: string
  baseUrl: string
}

export class UazapiProvider implements WhatsAppProvider {
  readonly kind = 'uazapi' as const

  constructor(private readonly config: UazapiProviderConfig) {}

  sendText(args: SendTextArgs): Promise<ProviderMessageResult> {
    // uazapi's /send/text has no reply-context field equivalent to
    // Meta's `context.message_id` — the message still sends, just
    // without the quote-preview affordance. `contextMessageId` is
    // accepted here only for interface parity.
    return sendText({
      baseUrl: this.config.baseUrl,
      token: this.config.token,
      number: args.to,
      text: args.text,
    })
  }

  sendMedia(args: SendMediaArgs): Promise<ProviderMessageResult> {
    // Meta auto-renders an 'audio' kind as a playable voice note;
    // uazapi needs the explicit 'ptt' type for the same rendering
    // (its plain 'audio' type renders as a regular file attachment).
    const type = args.kind === 'audio' ? 'ptt' : args.kind
    return sendMedia({
      baseUrl: this.config.baseUrl,
      token: this.config.token,
      number: args.to,
      type,
      file: args.link,
      text: args.caption,
      docName: args.kind === 'document' ? args.filename : undefined,
    })
  }

  sendReaction(args: SendReactionArgs): Promise<ProviderMessageResult> {
    return sendReaction({
      baseUrl: this.config.baseUrl,
      token: this.config.token,
      number: args.to,
      targetMessageId: args.targetMessageId,
      emoji: args.emoji,
    })
  }

  sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<ProviderMessageResult> {
    // uazapi has no separate header field on /send/menu — headerText
    // is dropped rather than folded into the body, since it would
    // otherwise silently double up if the caller already expects it
    // rendered as a distinct header line on Meta.
    const choices = args.buttons.map((b) => `${b.title}|${b.id}`)
    return sendMenu({
      baseUrl: this.config.baseUrl,
      token: this.config.token,
      number: args.to,
      type: 'button',
      text: args.bodyText,
      choices,
      footerText: args.footerText,
    })
  }

  sendInteractiveList(args: SendInteractiveListArgs): Promise<ProviderMessageResult> {
    const choices: string[] = []
    for (const section of args.sections) {
      if (section.title) choices.push(`[${section.title}]`)
      for (const row of section.rows) {
        choices.push(
          row.description ? `${row.title}|${row.id}|${row.description}` : `${row.title}|${row.id}`,
        )
      }
    }
    return sendMenu({
      baseUrl: this.config.baseUrl,
      token: this.config.token,
      number: args.to,
      type: 'list',
      text: args.bodyText,
      choices,
      footerText: args.footerText,
      listButton: args.buttonLabel,
    })
  }
}
