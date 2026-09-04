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

import { SendMessageError } from '@/lib/messaging/types'

const ZERNIO_API_BASE = 'https://zernio.com/api/v1'

// No call here previously carried a timeout, so a slow/unresponsive
// Zernio endpoint just hung until whatever reverse proxy sits in front
// of the app (EasyPanel, in production) gave up first and returned its
// own bare 502 with no body — the send route's real error handling
// (SendMessageError → a proper JSON `{ error }`) never got a chance to
// run, so the dashboard could only show the unhelpful "HTTP 502"
// fallback. Bounding every call here well under a typical proxy
// timeout turns that into a clear, fast "Zernio API request timed out"
// the user actually sees.
//
// Budgets, all under a typical reverse-proxy timeout so a hung Zernio
// endpoint surfaces as a clean "Zernio API request timed out." rather
// than the proxy's own bodyless 502:
//   - send calls + template CRUD: a human is watching a spinner/toast,
//     so 12s.
//   - media download / account verification: nothing is blocked on a
//     toast and the payload can be large, so 20s.
const ZERNIO_TIMEOUT_MS = 20_000
const ZERNIO_SEND_TIMEOUT_MS = 12_000
const ZERNIO_TEMPLATE_TIMEOUT_MS = 12_000

export interface ZernioSendResult {
  /** Zernio's own internal message id (not the platform-native message id). */
  messageId: string
}

interface ZernioErrorResponse {
  error?: string
}

const ZERNIO_TIMEOUT_ERROR = 'Zernio API request timed out.'

/** `fetch` to Zernio's API, bounded by a timeout (default
 *  `ZERNIO_TIMEOUT_MS`; send calls pass the tighter
 *  `ZERNIO_SEND_TIMEOUT_MS`) and with network/timeout failures turned
 *  into a clear `Error` instead of a raw `TypeError`/`DOMException` —
 *  every call site below uses this instead of the bare global `fetch`.
 *
 *  Two layers of timeout on purpose: an `AbortSignal.timeout` that
 *  tells the runtime to tear the socket down, AND a `Promise.race`
 *  against a plain timer that GUARANTEES this function's promise
 *  settles at `timeoutMs` even in the rare case where the abort
 *  doesn't propagate (a connection wedged in TLS/DNS, an undici edge
 *  case). Without the second layer a wedged call could still outlast
 *  the reverse proxy in front of the app, which then answers the
 *  browser with a bare 502 (no body) before the route's real
 *  `{ error }` response is ever produced. */
async function zernioFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = ZERNIO_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const hardStop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(ZERNIO_TIMEOUT_ERROR))
    }, timeoutMs)
    // Don't let the timer keep the event loop alive on its own.
    timer.unref?.()
  })

  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), hardStop])
  } catch (err) {
    if (err instanceof Error && err.message === ZERNIO_TIMEOUT_ERROR) {
      throw err
    }
    if (
      err instanceof DOMException &&
      (err.name === 'TimeoutError' || err.name === 'AbortError')
    ) {
      throw new Error(ZERNIO_TIMEOUT_ERROR)
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach the Zernio API: ${message}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Thrown by `verifyZernioAccount`. `kind` lets a caller tell a real
 *  credential rejection ('auth') apart from a transient failure or a
 *  response-shape quirk it should not surface as "disconnected". */
export class ZernioVerifyError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'not_found' | 'platform_mismatch' | 'transient',
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ZernioVerifyError'
  }
}

/**
 * Pull a human-readable string out of whatever shape Zernio's error
 * body takes — a plain `{ error: "msg" }`, a nested `{ error: { message
 * } }` / Meta's `{ error: { error_user_msg } }`, or a top-level
 * `{ message }`. Never returns `"[object Object]"`: if there's no
 * string anywhere it falls back to the JSON of the error blob so the
 * real reason is at least legible.
 */
function zernioErrorText(data: unknown): string {
  if (typeof data === 'string') return data.trim()
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  const err = d.error
  const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null
  const candidates = [
    typeof err === 'string' ? err : undefined,
    typeof d.message === 'string' ? d.message : undefined,
    typeof d.detail === 'string' ? d.detail : undefined,
    errObj && typeof errObj.message === 'string' ? errObj.message : undefined,
    errObj && typeof errObj.error_user_msg === 'string' ? errObj.error_user_msg : undefined,
    errObj && typeof errObj.error_user_title === 'string' ? errObj.error_user_title : undefined,
  ]
  for (const c of candidates) {
    if (c && c.trim()) return c.trim()
  }
  try {
    const json = JSON.stringify(err ?? d)
    if (json && json !== '{}' && json !== 'null') return json.slice(0, 500)
  } catch {
    // circular / unserialisable — fall through
  }
  return ''
}

async function throwZernioError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data: unknown = await response.json()
    message = zernioErrorText(data) || fallback
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  // Surface Zernio's (really Meta's) actual message — e.g. "template
  // name (1) does not exist in en_US" — instead of a bare
  // "Zernio API error: 404" that the send route then collapses into an
  // unhelpful "HTTP 502". A 4xx is a permanent request problem (unknown
  // template, unknown conversation, bad params) so keep its status: the
  // client's retry helper won't spin on it, and the send route replies
  // with that status + this message. 5xx / unrecognised → 502, matching
  // the direct-Meta path in send-message.ts.
  const status =
    response.status >= 400 && response.status < 500 ? response.status : 502
  throw new SendMessageError('zernio_error', message, status)
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

interface ZernioAccountRow {
  _id?: string
  id?: string
  accountId?: string
  platform?: string
  username?: string
  displayName?: string
  name?: string
}

/** Every response envelope Zernio's `/accounts` has been seen to use. */
function extractAccounts(data: unknown): ZernioAccountRow[] {
  const d = data as Record<string, unknown> | null
  const candidates: unknown[] = [
    (d?.data as Record<string, unknown> | undefined)?.accounts,
    d?.accounts,
    d?.data,
    d,
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) return c as ZernioAccountRow[]
  }
  return []
}

function rowId(a: ZernioAccountRow): string | undefined {
  return a._id ?? a.id ?? a.accountId
}

/**
 * Verify a Zernio-connected account by id, for a specific platform.
 * Zernio has no get-by-id account endpoint, so this lists every
 * account on the key and finds the match — used by each channel's
 * config route "Test Connection" and health check.
 *
 * Tolerant on purpose: the id key (`_id` / `id` / `accountId`), the
 * response envelope, and the platform-string casing have all varied
 * across Zernio API revisions, and a channel that is demonstrably
 * live (its webhook is delivering) must not read as "disconnected"
 * just because this list call's shape drifted. Genuine credential
 * rejections still throw `ZernioVerifyError({ kind: 'auth' })`.
 */
export async function verifyZernioAccount(args: VerifyZernioAccountArgs): Promise<ZernioAccountInfo> {
  const { apiKey, accountId, expectedPlatform } = args

  let response: Response
  try {
    response = await zernioFetch(`${ZERNIO_API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (err) {
    // Network / timeout — transient, not a credential problem.
    throw new ZernioVerifyError(
      err instanceof Error ? err.message : 'Could not reach the Zernio API.',
      'transient',
    )
  }

  if (!response.ok) {
    let detail = `Zernio API error: ${response.status}`
    try {
      const body = (await response.json()) as ZernioErrorResponse
      if (body.error) detail = body.error
    } catch {
      /* non-JSON body */
    }
    const kind =
      response.status === 401 || response.status === 403 ? 'auth' : 'transient'
    throw new ZernioVerifyError(detail, kind, response.status)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ZernioVerifyError('Zernio API returned a non-JSON response.', 'transient')
  }

  const accounts = extractAccounts(data)
  const match = accounts.find((a) => rowId(a) === accountId)
  if (!match) {
    throw new ZernioVerifyError(
      'No Zernio account with this ID was found on this API key.',
      'not_found',
    )
  }
  if (
    match.platform &&
    match.platform.toLowerCase() !== expectedPlatform.toLowerCase()
  ) {
    throw new ZernioVerifyError(
      `This Zernio account is connected to "${match.platform}", not ${expectedPlatform}.`,
      'platform_mismatch',
    )
  }
  return {
    id: rowId(match) ?? accountId,
    platform: match.platform ?? expectedPlatform,
    username: match.username,
    displayName: match.displayName ?? match.name,
  }
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
  /** Instagram/Facebook only — see `SendMessageParams.humanAgentTag`'s
   *  own doc comment (`@/lib/messaging/types`) for the human-only,
   *  support-only restriction Meta imposes on this. */
  humanAgentTag?: boolean
}

/** Send a free-form DM text message via Zernio's inbox API. */
export async function sendZernioText(args: ZernioSendTextArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, text, humanAgentTag } = args
  const url = `${ZERNIO_API_BASE}/inbox/conversations/${conversationId}/messages`
  const response = await zernioFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      accountId,
      message: text,
      ...(humanAgentTag ? { messagingType: 'MESSAGE_TAG', messageTag: 'HUMAN_AGENT' } : {}),
    }),
  }, ZERNIO_SEND_TIMEOUT_MS)
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
  /** Instagram/Facebook only — see `ZernioSendTextArgs.humanAgentTag`. */
  humanAgentTag?: boolean
}

/** Send an image, video, audio, or file attachment via a public URL. */
export async function sendZernioMedia(args: ZernioSendMediaArgs): Promise<ZernioSendResult> {
  const { apiKey, conversationId, accountId, kind, link, caption, filename, humanAgentTag } = args
  if (!link) throw new Error('sendZernioMedia requires a link.')
  const url = `${ZERNIO_API_BASE}/inbox/conversations/${conversationId}/messages`
  const response = await zernioFetch(url, {
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
      ...(humanAgentTag ? { messagingType: 'MESSAGE_TAG', messageTag: 'HUMAN_AGENT' } : {}),
    }),
  }, ZERNIO_SEND_TIMEOUT_MS)
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
  const response = await zernioFetch(url, {
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
  }, ZERNIO_SEND_TIMEOUT_MS)
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
  const response = await zernioFetch(url, {
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
  }, ZERNIO_SEND_TIMEOUT_MS)
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
  const response = await zernioFetch(url, {
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
  }, ZERNIO_SEND_TIMEOUT_MS)
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
  const response = await zernioFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ accountId, interactive }),
  }, ZERNIO_SEND_TIMEOUT_MS)
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
  const response = await zernioFetch(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    ZERNIO_TEMPLATE_TIMEOUT_MS,
  )
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
  const response = await zernioFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ accountId, name, category, language, components }),
    },
    ZERNIO_TEMPLATE_TIMEOUT_MS,
  )
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
  const response = await zernioFetch(
    url,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ accountId, components }),
    },
    ZERNIO_TEMPLATE_TIMEOUT_MS,
  )
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
  const response = await zernioFetch(
    url,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    ZERNIO_TEMPLATE_TIMEOUT_MS,
  )
  if (response.status === 404) return // already gone on Zernio's side — treat as done
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
  const response = await zernioFetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!response.ok) {
    await throwZernioError(response, `Zernio API error: ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  return { buffer, contentType: response.headers.get('content-type') }
}
