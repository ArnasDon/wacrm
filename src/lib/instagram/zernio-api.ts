/**
 * Zernio Inbox API helpers — the alternate path for Instagram DMs when
 * Meta's direct Graph API (`@/lib/instagram/api`) isn't usable because
 * the account can't complete Meta Business Verification. Zernio
 * (zernio.com) already completed that verification and re-exposes
 * Instagram messaging through its own unified inbox API.
 *
 * Same conventions as `api.ts`: one named-args object per function, no
 * positional params. Unlike Meta's Send API, which addresses a
 * recipient by IGSID, Zernio addresses an existing *conversation* by
 * its own opaque id — see the `conversationId` param on every send
 * call, sourced from `conversations.zernio_conversation_id`
 * (populated by the Zernio webhook route on first inbound message).
 *
 * Reference: https://docs.zernio.com
 */

const ZERNIO_API_BASE = 'https://zernio.com/api/v1'

export interface ZernioSendResult {
  /** Zernio's own internal message id (not the platform/Instagram mid). */
  messageId: string
}

interface ZernioErrorResponse {
  error?: string
}

async function throwZernioError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as ZernioErrorResponse
    if (data.error) message = data.error
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// Account
// ============================================================

export interface ZernioAccountInfo {
  id: string
  platform: string
  username?: string
  displayName?: string
}

export interface VerifyZernioAccountArgs {
  apiKey: string
  accountId: string
}

/**
 * Verify a Zernio-connected Instagram account by id. Zernio has no
 * get-by-id account endpoint, so this lists every account on the key
 * and finds the match — used by the config route's "Test Connection"
 * and health check, mirroring `verifyIgAccount` in api.ts.
 */
export async function verifyZernioAccount(args: VerifyZernioAccountArgs): Promise<ZernioAccountInfo> {
  const { apiKey, accountId } = args
  const response = await fetch(`${ZERNIO_API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  const accounts: Array<{ _id: string; platform: string; username?: string; displayName?: string }> =
    data?.data?.accounts ?? data?.accounts ?? []
  const match = accounts.find((a) => a._id === accountId)
  if (!match) {
    throw new Error('No Zernio account with this ID was found for this API key.')
  }
  if (match.platform !== 'instagram') {
    throw new Error(`This Zernio account is connected to "${match.platform}", not Instagram.`)
  }
  return { id: match._id, platform: match.platform, username: match.username, displayName: match.displayName }
}

// ============================================================
// Sending
// ============================================================

export interface ZernioSendTextArgs {
  apiKey: string
  /** Zernio's opaque conversation id (`conversations.zernio_conversation_id`). */
  conversationId: string
  accountId: string
  text: string
}

/** Send a free-form Instagram DM text message via Zernio's inbox API. */
export async function sendZernioText(args: ZernioSendTextArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, text } = args
  const url = `${ZERNIO_API_BASE}/inbox/conversations/${conversationId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ accountId, message: text }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.data?.messageId ?? data.messageId }
}

export type ZernioMediaKind = 'image' | 'video' | 'audio' | 'document'

/** Zernio's attachment `attachmentType` field doesn't use "document" — it's "file". */
function toZernioAttachmentType(kind: ZernioMediaKind): string {
  return kind === 'document' ? 'file' : kind
}

export interface ZernioSendMediaArgs {
  apiKey: string
  conversationId: string
  accountId: string
  kind: ZernioMediaKind
  /** Publicly accessible URL Zernio fetches at send time. */
  link: string
}

/** Send an image, video, audio, or file attachment via a public URL. */
export async function sendZernioMedia(args: ZernioSendMediaArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, kind, link } = args
  if (!link) throw new Error('sendZernioMedia requires a link.')
  const url = `${ZERNIO_API_BASE}/inbox/conversations/${conversationId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      accountId,
      attachmentUrl: link,
      attachmentType: toZernioAttachmentType(kind),
    }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.data?.messageId ?? data.messageId }
}

// ============================================================
// Quick replies (mirrors INSTAGRAM_QUICK_REPLY_LIMITS in api.ts —
// Zernio forwards these to Meta as-is, so the same Meta-imposed caps
// apply on the Zernio path too)
// ============================================================

export interface ZernioQuickReplyOption {
  title: string
  payload: string
}

export interface ZernioSendQuickRepliesArgs {
  apiKey: string
  conversationId: string
  accountId: string
  text: string
  quickReplies: ZernioQuickReplyOption[]
}

export async function sendZernioQuickReplies(args: ZernioSendQuickRepliesArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, text, quickReplies } = args
  if (!text) throw new Error('sendZernioQuickReplies requires text.')
  if (quickReplies.length < 1 || quickReplies.length > 13) {
    throw new Error(`Quick replies require 1-13 options (got ${quickReplies.length}).`)
  }

  const url = `${ZERNIO_API_BASE}/inbox/conversations/${conversationId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      accountId,
      message: text,
      quickReplies: quickReplies.map((qr) => ({ title: qr.title, payload: qr.payload })),
    }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.data?.messageId ?? data.messageId }
}
