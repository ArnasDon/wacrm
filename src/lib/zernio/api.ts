/**
 * Zernio Inbox API helpers — shared by every channel that can be
 * connected through Zernio (zernio.com) instead of going direct to
 * Meta's Graph API. Zernio already completed Meta Business
 * Verification and re-exposes Instagram/Facebook/WhatsApp messaging
 * through one unified inbox API, so an account can connect without
 * going through that verification itself.
 *
 * Same conventions as the Meta API clients (`@/lib/instagram/api`,
 * `@/lib/whatsapp/meta-api`): one named-args object per function, no
 * positional params. Unlike Meta's Send API, which addresses a
 * recipient directly (IGSID, PSID, phone number), Zernio addresses an
 * existing *conversation* by its own opaque id — see the
 * `conversationId` param on every send call, sourced from
 * `conversations.zernio_conversation_id` (populated by the relevant
 * Zernio webhook route on first inbound message).
 *
 * Reference: https://docs.zernio.com
 */

const ZERNIO_API_BASE = 'https://zernio.com/api/v1'

export interface ZernioSendResult {
  /** Zernio's own internal message id (not the platform-native message id). */
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
  /** Which Zernio platform this account must be connected to (e.g. 'instagram', 'facebook', 'whatsapp'). */
  expectedPlatform: string
}

/**
 * Verify a Zernio-connected account by id, for a specific platform.
 * Zernio has no get-by-id account endpoint, so this lists every
 * account on the key and finds the match — used by each channel's
 * config route "Test Connection" and health check.
 */
export async function verifyZernioAccount(args: VerifyZernioAccountArgs): Promise<ZernioAccountInfo> {
  const { apiKey, accountId, expectedPlatform } = args
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
  if (match.platform !== expectedPlatform) {
    throw new Error(`This Zernio account is connected to "${match.platform}", not ${expectedPlatform}.`)
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

/** Send a free-form DM text message via Zernio's inbox API. */
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
  /** Caption — sent alongside the attachment as the `message` field. WhatsApp/Instagram/Facebook all accept this; ignored by Zernio for audio, same as Meta's own caption rule. */
  caption?: string
  /** WhatsApp-only: display file name for a document attachment. */
  filename?: string
}

/** Send an image, video, audio, or file attachment via a public URL. */
export async function sendZernioMedia(args: ZernioSendMediaArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, kind, link, caption, filename } = args
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
      ...(caption && kind !== 'audio' ? { message: caption } : {}),
      ...(kind === 'document' && filename ? { attachmentName: filename } : {}),
    }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.data?.messageId ?? data.messageId }
}

// ============================================================
// Quick replies / buttons (mirrors each channel's own Meta-imposed
// caps — Zernio forwards these to Meta as-is)
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

// ============================================================
// WhatsApp-only send variants
//
// WhatsApp's abstraction on Zernio's send endpoint differs from
// Instagram/Facebook's: `buttons` (postback type) is the simple
// reply-button field, mutually exclusive with `quickReplies`
// (Instagram/Facebook's chip field) and with `template`. `interactive`
// carries Meta's rich interactive object verbatim (used here for list
// messages, which have no `buttons`-field shortcut) and `template`
// carries the approved-template reference. See
// https://docs.zernio.com/messages/send-inbox-message.
// ============================================================

export interface ZernioSendTemplateArgs {
  apiKey: string
  conversationId: string
  accountId: string
  templateName: string
  language: string
  /** Meta-shaped components array (header/body/buttons parameters) — forwarded to Meta unchanged. Same array `buildSendComponents` produces for the direct-Meta send path. */
  components?: unknown[]
}

/** Send an approved WhatsApp template message via Zernio. */
export async function sendZernioTemplate(args: ZernioSendTemplateArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, templateName, language, components } = args
  const url = `${ZERNIO_API_BASE}/inbox/conversations/${conversationId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      accountId,
      template: {
        elements: [
          {
            name: templateName,
            language,
            ...(components && components.length > 0 ? { components } : {}),
          },
        ],
      },
    }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.data?.messageId ?? data.messageId }
}

export interface ZernioButton {
  /** Stable id echoed back on the button reply ID when tapped (≤ 256 chars, Meta's own limit). */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface ZernioSendButtonsArgs {
  apiKey: string
  conversationId: string
  accountId: string
  text: string
  /** 1–3 buttons — Meta's own reply-button cap, enforced by the caller before this. */
  buttons: ZernioButton[]
}

/** Send a WhatsApp reply-button message (Zernio's `buttons` field, type: postback). */
export async function sendZernioButtons(args: ZernioSendButtonsArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, text, buttons } = args
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
      buttons: buttons.map((b) => ({ type: 'postback', title: b.title, payload: b.id })),
    }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.data?.messageId ?? data.messageId }
}

export interface ZernioSendInteractiveArgs {
  apiKey: string
  conversationId: string
  accountId: string
  /** Meta's raw `interactive` object (verbatim — Zernio forwards it unchanged), e.g. `{ type: 'list', body, action, header?, footer? }`. */
  interactive: Record<string, unknown>
}

/** Send a raw WhatsApp interactive message (list messages — Zernio has no dedicated `list` field, just the `interactive` passthrough). */
export async function sendZernioInteractive(args: ZernioSendInteractiveArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, interactive } = args
  const url = `${ZERNIO_API_BASE}/inbox/conversations/${conversationId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ accountId, interactive }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.data?.messageId ?? data.messageId }
}

// ============================================================
// WhatsApp template CRUD — https://docs.zernio.com, "Create template" /
// "Update template" / "Delete template" / "List templates". Zernio
// fetches/submits these directly against the WhatsApp Cloud API using
// its own Meta App, so the request/response shapes mirror Meta's
// Business Management API almost exactly (same `components` array
// `buildMetaTemplatePayload` already produces for the direct-Meta path).
// ============================================================

export interface ZernioTemplateInfo {
  id: string
  name: string
  status: string
  category?: string
  language?: string
  components?: unknown[]
}

export interface ListZernioTemplatesArgs {
  apiKey: string
  accountId: string
}

export async function listZernioTemplates(args: ListZernioTemplatesArgs): Promise<ZernioTemplateInfo[]> {
  const { apiKey, accountId } = args
  const url = `${ZERNIO_API_BASE}/whatsapp/templates?${new URLSearchParams({ accountId })}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return data.templates ?? []
}

export interface CreateZernioTemplateArgs {
  apiKey: string
  accountId: string
  name: string
  category: string
  language: string
  components: unknown[]
}

export async function createZernioTemplate(args: CreateZernioTemplateArgs): Promise<ZernioTemplateInfo> {
  const { apiKey, accountId, name, category, language, components } = args
  const url = `${ZERNIO_API_BASE}/whatsapp/templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ accountId, name, category, language, components }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return data.template
}

export interface UpdateZernioTemplateArgs {
  apiKey: string
  accountId: string
  templateName: string
  components: unknown[]
}

export async function updateZernioTemplate(args: UpdateZernioTemplateArgs): Promise<ZernioTemplateInfo> {
  const { apiKey, accountId, templateName, components } = args
  const url = `${ZERNIO_API_BASE}/whatsapp/templates/${encodeURIComponent(templateName)}`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ accountId, components }),
  })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const data = await response.json()
  return data.template
}

export interface DeleteZernioTemplateArgs {
  apiKey: string
  accountId: string
  templateName: string
}

export async function deleteZernioTemplate(args: DeleteZernioTemplateArgs): Promise<void> {
  const { apiKey, accountId, templateName } = args
  const url = `${ZERNIO_API_BASE}/whatsapp/templates/${encodeURIComponent(templateName)}?${new URLSearchParams({ accountId })}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (response.status === 404) return
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
}

// ============================================================
// WhatsApp inbound media — unlike Instagram/Facebook, whose
// `attachments[].url` on `message.received` is a direct unauthenticated
// CDN link, WhatsApp media on Zernio must be fetched from an
// authenticated endpoint (Meta's own media store has no public URLs).
// Mirrors `getMediaUrl` + `downloadMedia` in `@/lib/whatsapp/meta-api`,
// collapsed into one call since Zernio's media endpoint streams the
// binary directly rather than a two-step "resolve URL, then fetch" dance.
// ============================================================

export interface DownloadZernioWhatsAppMediaArgs {
  apiKey: string
  accountId: string
  mediaId: string
}

export async function downloadZernioWhatsAppMedia(
  args: DownloadZernioWhatsAppMediaArgs,
): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
  const { apiKey, accountId, mediaId } = args
  const url = `${ZERNIO_API_BASE}/whatsapp/media/${encodeURIComponent(mediaId)}?${new URLSearchParams({ accountId })}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  return { buffer, contentType: response.headers.get('content-type') }
}
