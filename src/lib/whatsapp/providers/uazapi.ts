/**
 * Uazapi provider — HTTP client for the Uazapi REST API implementing
 * the provider-agnostic `WhatsAppProvider` interface.
 *
 * Capability gaps vs. Meta (see docs/uazapi-integration-plan.md):
 *   - No approved templates / 24h window. `sendTemplate` renders the
 *     template name + params as plain text and sends via /send/text.
 *   - Message ids are `owner:messageid` (composite) — always persist
 *     the full string returned by Uazapi; it's required for replies.
 *   - Media download is an explicit POST (no CDN URL handed to us).
 */

import type {
  WhatsAppProvider,
  SendTextArgs,
  SendMediaArgs,
  SendTemplateArgs,
  DownloadMediaArgs,
  DownloadMediaResult,
  SendResult,
} from './types'

export interface UazapiProviderConfig {
  instanceToken: string
  baseUrl: string
}

interface UazapiSendResponse {
  id?: string
  messageid?: string
  response?: { status?: string; message?: string }
}

async function throwUazapiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = await response.json()
    if (typeof data?.error === 'string') message = data.error
    else if (typeof data?.message === 'string') message = data.message
  } catch {
    // not JSON — keep fallback
  }
  throw new Error(message)
}

export class UazapiProvider implements WhatsAppProvider {
  readonly name = 'uazapi' as const

  constructor(private readonly config: UazapiProviderConfig) {}

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      token: this.config.instanceToken,
    }
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`
  }

  async sendText(args: SendTextArgs): Promise<SendResult> {
    const body: Record<string, unknown> = {
      number: args.to,
      text: args.text,
    }
    if (args.replyToExternalId) body.replyid = args.replyToExternalId

    const response = await fetch(this.url('/send/text'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      await throwUazapiError(response, `Uazapi API error: ${response.status}`)
    }
    const data = (await response.json()) as UazapiSendResponse
    return { externalMessageId: data.id || data.messageid || '' }
  }

  async sendMedia(args: SendMediaArgs): Promise<SendResult> {
    const body: Record<string, unknown> = {
      number: args.to,
      type: args.kind,
      file: args.link,
    }
    if (args.caption) body.text = args.caption
    if (args.kind === 'document' && args.filename) body.docName = args.filename
    if (args.replyToExternalId) body.replyid = args.replyToExternalId

    const response = await fetch(this.url('/send/media'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      await throwUazapiError(response, `Uazapi API error: ${response.status}`)
    }
    const data = (await response.json()) as UazapiSendResponse
    return { externalMessageId: data.id || data.messageid || '' }
  }

  /**
   * Uazapi has no template/approval concept — render as plain text.
   * `params` are appended positionally in place of {{1}}, {{2}}, ...
   * style placeholders is out of scope for the MVP; callers pass an
   * already-rendered body via `templateName` when they need Uazapi
   * fallback text (see send-message.ts).
   */
  async sendTemplate(args: SendTemplateArgs): Promise<SendResult> {
    const text = [args.templateName, ...(args.params || [])].filter(Boolean).join('\n')
    return this.sendText({
      to: args.to,
      text,
      replyToExternalId: args.replyToExternalId,
    })
  }

  async downloadMedia(args: DownloadMediaArgs): Promise<DownloadMediaResult> {
    const response = await fetch(this.url('/message/download'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ id: args.mediaRef, return_base64: true }),
    })
    if (!response.ok) {
      await throwUazapiError(response, `Uazapi media download failed: ${response.status}`)
    }
    const data = (await response.json()) as { base64?: string; mimetype?: string; mimeType?: string }
    if (!data.base64) {
      throw new Error('Uazapi media download returned no base64 payload')
    }
    return {
      buffer: Buffer.from(data.base64, 'base64'),
      contentType: data.mimetype || data.mimeType || 'application/octet-stream',
    }
  }

  /** Validates the instance token by hitting /instance/status. */
  async verifyConnection(): Promise<{ connected: boolean; loggedIn: boolean }> {
    const response = await fetch(this.url('/instance/status'), {
      headers: this.headers(),
    })
    if (!response.ok) {
      await throwUazapiError(response, `Uazapi API error: ${response.status}`)
    }
    const data = (await response.json()) as { status?: { connected?: boolean; loggedIn?: boolean } }
    return {
      connected: Boolean(data.status?.connected),
      loggedIn: Boolean(data.status?.loggedIn),
    }
  }
}
