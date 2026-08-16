/**
 * Provider dispatch for outbound Instagram sends. Every caller that
 * used to call `@/lib/instagram/api`'s `sendTextMessage` /
 * `sendMediaMessage` / `sendQuickReplies` directly now goes through
 * here instead, so the "which provider is this account on" branch
 * lives in exactly one place rather than being copy-pasted into
 * `send-message.ts` and `engine-send.ts` separately.
 *
 * Meta and Zernio address the recipient differently — Meta's Send API
 * takes the customer's IGSID directly; Zernio addresses an existing
 * *conversation* by its own opaque id — so callers pass both and this
 * module picks whichever the row's `provider` needs.
 */

import { sendTextMessage, sendMediaMessage, sendQuickReplies, type InstagramMediaKind, type QuickReplyOption } from '@/lib/instagram/api'
import { sendZernioText, sendZernioMedia, sendZernioQuickReplies } from '@/lib/zernio/api'
import { decrypt } from '@/lib/whatsapp/encryption'

/** The subset of an `instagram_config` row this module needs. */
export interface InstagramConfigRow {
  provider: string | null // 'meta' | 'zernio' — null is legacy pre-migration-040 rows, treated as 'meta'
  ig_account_id: string | null
  access_token: string | null
  zernio_api_key: string | null
  zernio_account_id: string | null
}

export function isZernioProvider(config: InstagramConfigRow): boolean {
  return config.provider === 'zernio'
}

export interface SendTarget {
  config: InstagramConfigRow
  /** Recipient's Instagram-Scoped ID — used on the Meta path. */
  igsid: string
  /** Zernio's own conversation id (`conversations.zernio_conversation_id`) — used on the Zernio path. */
  zernioConversationId: string | null
}

function requireZernioConversation(target: SendTarget): string {
  if (!target.zernioConversationId) {
    throw new Error(
      'No Zernio conversation exists yet for this contact. The customer needs to message first before an agent, automation, or flow can reply.',
    )
  }
  return target.zernioConversationId
}

export interface ProviderSendResult {
  messageId: string
}

export async function sendInstagramText(target: SendTarget, text: string): Promise<ProviderSendResult> {
  const { config } = target
  if (isZernioProvider(config)) {
    const result = await sendZernioText({
      apiKey: decrypt(config.zernio_api_key!),
      conversationId: requireZernioConversation(target),
      accountId: config.zernio_account_id!,
      text,
    })
    return { messageId: result.messageId }
  }
  const result = await sendTextMessage({
    igAccountId: config.ig_account_id!,
    accessToken: decrypt(config.access_token!),
    to: target.igsid,
    text,
  })
  return { messageId: result.messageId }
}

export async function sendInstagramMedia(
  target: SendTarget,
  kind: InstagramMediaKind,
  link: string,
  opts: { caption?: string | null; filename?: string | null } = {},
): Promise<ProviderSendResult> {
  const { config } = target
  if (isZernioProvider(config)) {
    // Zernio's bridge supports a caption/filename on the underlying
    // channel it's relaying to — forward them here. The direct-Meta path
    // below can't: Instagram's own Send API attachment payload has no
    // caption/filename field at all, a platform limitation, not a gap
    // in this codebase.
    const result = await sendZernioMedia({
      apiKey: decrypt(config.zernio_api_key!),
      conversationId: requireZernioConversation(target),
      accountId: config.zernio_account_id!,
      kind,
      link,
      caption: opts.caption ?? undefined,
      filename: opts.filename ?? undefined,
    })
    return { messageId: result.messageId }
  }
  const result = await sendMediaMessage({
    igAccountId: config.ig_account_id!,
    accessToken: decrypt(config.access_token!),
    to: target.igsid,
    kind,
    link,
  })
  return { messageId: result.messageId }
}

export async function sendInstagramQuickReplies(
  target: SendTarget,
  text: string,
  quickReplies: QuickReplyOption[],
): Promise<ProviderSendResult> {
  const { config } = target
  if (isZernioProvider(config)) {
    const result = await sendZernioQuickReplies({
      apiKey: decrypt(config.zernio_api_key!),
      conversationId: requireZernioConversation(target),
      accountId: config.zernio_account_id!,
      text,
      quickReplies,
    })
    return { messageId: result.messageId }
  }
  const result = await sendQuickReplies({
    igAccountId: config.ig_account_id!,
    accessToken: decrypt(config.access_token!),
    to: target.igsid,
    text,
    quickReplies,
  })
  return { messageId: result.messageId }
}
