/**
 * Meta Instagram Messaging API helpers.
 *
 * Same conventions as `@/lib/whatsapp/meta-api`: every function takes a
 * single named-args object (no positional params, so a typo surfaces as
 * a TypeScript error instead of a runtime rejection from Meta), and the
 * same Graph API base/version — WhatsApp and Instagram are both Meta
 * Graph API products under one App.
 *
 * Deliberately NOT ported from meta-api.ts: message templates, the
 * 24-hour-window distinction, and 2FA phone registration — none of
 * those concepts exist for Instagram DMs. Instagram's send surface is
 * closer to WhatsApp's free-form text/media sends plus "quick replies"
 * (its analogue of WhatsApp's interactive buttons, capped at 13
 * options instead of 3).
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.instagram.com/${META_API_VERSION}`

export interface InstagramSendResult {
  messageId: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// Account
// ============================================================

export interface VerifyIgAccountArgs {
  igAccountId: string
  accessToken: string
}

export interface IgAccountInfo {
  id: string
  username?: string
  name?: string
  profile_picture_url?: string
}

/**
 * Verify an Instagram Business Account ID by fetching its public
 * metadata. Used by the config route's "Test Connection" and health
 * check, mirroring `verifyPhoneNumber` in meta-api.ts.
 */
export async function verifyIgAccount(args: VerifyIgAccountArgs): Promise<IgAccountInfo> {
  const { igAccountId, accessToken } = args
  const url = `${META_API_BASE}/${igAccountId}?fields=id,username,name,profile_picture_url`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

export interface GetIgUserProfileArgs {
  /** The Instagram-Scoped ID (IGSID) of the person who messaged the business. */
  igsid: string
  accessToken: string
}

/**
 * Best-effort fetch of a customer's Instagram username/display name,
 * for `contacts.instagram_username`. Meta only allows this lookup for
 * users within the messaging window, so callers should treat a
 * failure as "no username available" rather than an error — this
 * never throws.
 */
export async function getIgUserProfile(
  args: GetIgUserProfileArgs
): Promise<{ name?: string; username?: string } | null> {
  const { igsid, accessToken } = args
  try {
    const url = `${META_API_BASE}/${igsid}?fields=name,username`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return null
    const data = await response.json()
    return { name: data.name, username: data.username }
  } catch {
    return null
  }
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  igAccountId: string
  accessToken: string
  /** The recipient's Instagram-Scoped ID (IGSID). */
  to: string
  text: string
}

/** Send a free-form Instagram DM text message. */
export async function sendTextMessage(args: SendTextMessageArgs): Promise<InstagramSendResult> {
  const { igAccountId, accessToken, to, text } = args
  const url = `${META_API_BASE}/${igAccountId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: to },
      message: { text },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.message_id }
}

export type InstagramMediaKind = 'image' | 'video' | 'audio' | 'document'

/** Instagram's attachment `type` field doesn't use "document" — it's "file". */
function toAttachmentType(kind: InstagramMediaKind): string {
  return kind === 'document' ? 'file' : kind
}

export interface SendMediaMessageArgs {
  igAccountId: string
  accessToken: string
  to: string
  kind: InstagramMediaKind
  /** Public URL Meta fetches at send time. */
  link: string
}

/**
 * Send an image, video, audio, or file attachment via a public URL.
 * Instagram DMs have no caption field on media messages (unlike
 * WhatsApp) — send a separate text message first if a caption-like
 * message is needed.
 */
export async function sendMediaMessage(args: SendMediaMessageArgs): Promise<InstagramSendResult> {
  const { igAccountId, accessToken, to, kind, link } = args
  if (!link) throw new Error('sendMediaMessage requires a link.')
  const url = `${META_API_BASE}/${igAccountId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: to },
      message: {
        attachment: {
          type: toAttachmentType(kind),
          payload: { url: link, is_reusable: true },
        },
      },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.message_id }
}

// ============================================================
// Quick replies (Instagram's analogue of WhatsApp interactive buttons)
// ============================================================
//
// Not wired into the shared send path yet — see
// docs/instagram-integration/PROGRESS.md, Phase 8/11 notes. Exposed
// here so automations/flows (Phase 5) can use it directly for
// menu-style prompts without waiting on inbox UI support for
// rendering/composing quick replies.

export const INSTAGRAM_QUICK_REPLY_LIMITS = {
  maxOptions: 13,
  titleMaxLength: 20,
  payloadMaxLength: 1000,
  textMaxLength: 1000,
} as const

export interface QuickReplyOption {
  /** Visible label (≤ 20 chars per Meta). */
  title: string
  /** Opaque value echoed back in the webhook when tapped (≤ 1000 chars). */
  payload: string
}

export interface SendQuickRepliesArgs {
  igAccountId: string
  accessToken: string
  to: string
  text: string
  /** 1–13 options. Validated against Meta's limits before sending. */
  quickReplies: QuickReplyOption[]
}

/**
 * Send a text message with up to 13 tappable quick-reply chips. The
 * customer taps one and Meta delivers a webhook with
 * `message.quick_reply.payload` set to the matching option's payload.
 */
export async function sendQuickReplies(args: SendQuickRepliesArgs): Promise<InstagramSendResult> {
  const { igAccountId, accessToken, to, text, quickReplies } = args
  if (!text) throw new Error('sendQuickReplies requires text.')
  if (text.length > INSTAGRAM_QUICK_REPLY_LIMITS.textMaxLength) {
    throw new Error(`Quick-reply text exceeds ${INSTAGRAM_QUICK_REPLY_LIMITS.textMaxLength} chars.`)
  }
  if (quickReplies.length < 1 || quickReplies.length > INSTAGRAM_QUICK_REPLY_LIMITS.maxOptions) {
    throw new Error(
      `Quick replies require 1-${INSTAGRAM_QUICK_REPLY_LIMITS.maxOptions} options (got ${quickReplies.length}).`
    )
  }
  for (const qr of quickReplies) {
    if (!qr.title) throw new Error('Quick reply missing title.')
    if (qr.title.length > INSTAGRAM_QUICK_REPLY_LIMITS.titleMaxLength) {
      throw new Error(
        `Quick reply title "${qr.title}" exceeds ${INSTAGRAM_QUICK_REPLY_LIMITS.titleMaxLength} chars.`
      )
    }
    if (!qr.payload) throw new Error(`Quick reply "${qr.title}" missing payload.`)
    if (qr.payload.length > INSTAGRAM_QUICK_REPLY_LIMITS.payloadMaxLength) {
      throw new Error(
        `Quick reply payload for "${qr.title}" exceeds ${INSTAGRAM_QUICK_REPLY_LIMITS.payloadMaxLength} chars.`
      )
    }
  }

  const url = `${META_API_BASE}/${igAccountId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: to },
      message: {
        text,
        quick_replies: quickReplies.map((qr) => ({
          content_type: 'text',
          title: qr.title,
          payload: qr.payload,
        })),
      },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.message_id }
}
