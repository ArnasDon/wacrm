/**
 * Provider-agnostic WhatsApp sending interface.
 *
 * Both `meta.ts` and `uazapi.ts` implement this so every call site
 * (send-message.ts, automations, flows, broadcasts) can send without
 * knowing which provider is behind a given `whatsapp_config` row.
 *
 * Capability gaps between providers are absorbed HERE, not by the
 * caller:
 *   - Meta templates require Meta approval + only work inside the 24h
 *     window. Uazapi has no such concept — `sendTemplate` on the
 *     Uazapi implementation renders the template body as plain text.
 *   - Meta's message id is a plain `wamid`; Uazapi's is a composite
 *     `owner:messageid`. Callers must treat `externalMessageId` as an
 *     opaque string and pass it back verbatim (e.g. for `replyTo`).
 */

export type MediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendResult {
  /** Provider's id for the sent message — Meta's `wamid`, or Uazapi's `owner:messageid`. */
  externalMessageId: string
}

export interface SendTextArgs {
  to: string
  text: string
  /** externalMessageId of the message being replied to (quote preview). */
  replyToExternalId?: string
}

export interface SendMediaArgs {
  to: string
  kind: MediaKind
  /** Public URL the provider fetches at send time. */
  link: string
  caption?: string
  /** Document-only file name. */
  filename?: string
  replyToExternalId?: string
}

export interface SendTemplateArgs {
  to: string
  templateName: string
  language?: string
  /** Body variable values, positional. */
  params?: string[]
  replyToExternalId?: string
  /**
   * Meta-only: the local `message_templates` row (header/button
   * components). Ignored by providers without a template concept
   * (Uazapi falls back to plain text using `templateName` + `params`).
   */
  templateRow?: unknown
  /** Meta-only: structured per-send values (header text/media, button params). */
  messageParams?: unknown
}

export interface DownloadMediaArgs {
  /** Provider-specific media reference — Meta media id, or Uazapi externalMessageId. */
  mediaRef: string
}

export interface DownloadMediaResult {
  buffer: Buffer
  contentType: string
}

export interface WhatsAppProvider {
  readonly name: 'meta' | 'uazapi'
  sendText(args: SendTextArgs): Promise<SendResult>
  sendMedia(args: SendMediaArgs): Promise<SendResult>
  /** Meta: real approved template. Uazapi: falls back to plain text. */
  sendTemplate(args: SendTemplateArgs): Promise<SendResult>
  downloadMedia(args: DownloadMediaArgs): Promise<DownloadMediaResult>
}
