/**
 * Evolution Go helpers — unofficial WhatsApp transport (self-hosted,
 * whatsmeow-based) that an account can pick instead of the Meta Cloud
 * API (see meta-api.ts). Mirrors meta-api.ts's function shapes
 * (named-params objects, `{ messageId }` return, throw-on-failure) so
 * send-message.ts can branch on `whatsapp_config.provider` with a
 * minimal diff.
 *
 * Endpoint surface confirmed against a live Evolution Go instance and
 * a working reference integration (evo-crm-community, same upstream
 * project as the "Evolution Go" ecosystem):
 *   Admin-authenticated (`apikey: <admin token>`):
 *     POST   /instance/create
 *     DELETE /instance/logout/:uuid
 *     DELETE /instance/delete/:uuid
 *   Instance-authenticated (`apikey: <instance token>`):
 *     POST /instance/connect   { subscribe: [...], webhookUrl }
 *     GET  /instance/qr        -> { base64, code, connected }
 *     POST /send/text          { number, text, delay, quoted? }
 *     POST /send/media         { number, url, caption, filename, type, delay, quoted? }
 *     POST /send/button        { number, title, description, footer, buttons, delay, quoted? }
 *     POST /send/list          { number, title, description, buttonText, footerText, sections, delay, quoted? }
 *   Send responses: { data: { Info: { ID: "..." } }, message: "success" }.
 */

import { randomUUID } from 'node:crypto'
import type { MessageTemplate } from '@/types'
import { extractVariableIndices } from './template-validators'
import type { SendTimeParams } from './template-send-builder'

export interface EvolutionSendResult {
  messageId: string
}

export interface EvolutionQuoted {
  messageId: string
  /** WhatsApp JID of whoever sent the quoted message, e.g. "37063949836@s.whatsapp.net". */
  participant: string
}

class EvolutionApiError extends Error {}

function trimBase(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '')
}

async function throwEvolutionError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const text = await response.text()
    if (text) message = `${fallback}: ${text.slice(0, 300)}`
  } catch {
    // body wasn't readable — keep the fallback
  }
  throw new EvolutionApiError(message)
}

function parseSendResponse(data: unknown): EvolutionSendResult {
  const id =
    data && typeof data === 'object' && data !== null
      ? (data as { data?: { Info?: { ID?: string } } }).data?.Info?.ID
      : undefined
  // Evolution Go can report success without echoing the message id back
  // (seen intermittently in the reference integration). A missing id
  // shouldn't fail an otherwise-successful send — fall back to a
  // synthetic, still-unique id so the row's message_id column (used
  // for reply-quoting and status matching) never collides.
  return { messageId: id || `evo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

// ============================================================
// Instance lifecycle (admin-authenticated)
// ============================================================

export interface CreateInstanceArgs {
  apiUrl: string
  adminToken: string
  instanceName: string
}

export interface CreateInstanceResult {
  instanceUuid: string
  instanceToken: string
}

export async function createInstance(
  args: CreateInstanceArgs
): Promise<CreateInstanceResult> {
  const { apiUrl, adminToken, instanceName } = args

  // Evolution Go doesn't generate instanceId/token server-side — the
  // caller mints both as UUIDs and sends them in the create request
  // (confirmed against the reference integration's create_instance_go).
  // The server may echo back its own token in the response; that one
  // wins if present, otherwise we keep the one we generated.
  const instanceUuid = randomUUID()
  const generatedToken = randomUUID()

  const response = await fetch(`${trimBase(apiUrl)}/instance/create`, {
    method: 'POST',
    headers: { apikey: adminToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceId: instanceUuid,
      name: instanceName,
      token: generatedToken,
      advancedSettings: {
        alwaysOnline: true,
        rejectCall: true,
        readMessages: true,
        ignoreGroups: false,
        ignoreStatus: true,
      },
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go create instance error: ${response.status}`)
  }
  const data = await response.json()
  const instanceToken: string =
    (data && typeof data === 'object' ? data.data?.token ?? data.token : undefined) ||
    generatedToken

  return { instanceUuid, instanceToken }
}

export interface ConnectInstanceArgs {
  apiUrl: string
  instanceToken: string
  /** Public URL this deployment's Evolution Go webhook route is reachable at. */
  webhookUrl: string
}

/**
 * Starts (or resumes) the WhatsApp session and registers our webhook
 * URL for it. Must be called before `getInstanceQr` — the QR code is
 * generated asynchronously right after connect.
 */
export async function connectInstance(args: ConnectInstanceArgs): Promise<void> {
  const { apiUrl, instanceToken, webhookUrl } = args
  const response = await fetch(`${trimBase(apiUrl)}/instance/connect`, {
    method: 'POST',
    headers: { apikey: instanceToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscribe: ['MESSAGE', 'READ_RECEIPT', 'CONNECTION'],
      webhookUrl,
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go connect instance error: ${response.status}`)
  }
}

export interface GetInstanceQrArgs {
  apiUrl: string
  instanceToken: string
}

export interface InstanceQrResult {
  base64: string | null
  code: string | null
}

/**
 * Single poll of the QR endpoint. The QR is generated asynchronously
 * right after connectInstance — callers should poll this every ~1-2s
 * (the reference integration retries up to 20x) until a QR shows up.
 *
 * Response shape (confirmed live, not just from the reference's
 * consumption code — an earlier version of this function trusted the
 * reference's internal variable names and got the field names wrong):
 *   { data: { qrcode: "data:image/png;base64,...", code: "2@..." }, message: "success" }
 * `qrcode` is already a full data: URI, not raw base64. This endpoint
 * never reports connection status (always omits/false) — use
 * `getInstanceInfo` for that.
 */
export async function getInstanceQr(args: GetInstanceQrArgs): Promise<InstanceQrResult> {
  const { apiUrl, instanceToken } = args
  const response = await fetch(`${trimBase(apiUrl)}/instance/qr`, {
    headers: { apikey: instanceToken, 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go get QR error: ${response.status}`)
  }
  const data = await response.json()
  const payload = data?.data ?? data
  return {
    base64: payload?.qrcode ?? null,
    code: payload?.code ?? null,
  }
}

export interface GetInstanceInfoArgs {
  apiUrl: string
  adminToken: string
  instanceUuid: string
}

export interface InstanceInfoResult {
  connected: boolean
  jid: string | null
}

/**
 * Authoritative connection status — GET /instance/info/:id, admin-
 * authenticated. Unlike `getInstanceQr` (which never reports
 * connected:true), this reflects whether the WhatsApp session behind
 * this instance is actually paired (non-empty `jid`).
 */
export async function getInstanceInfo(args: GetInstanceInfoArgs): Promise<InstanceInfoResult> {
  const { apiUrl, adminToken, instanceUuid } = args
  const response = await fetch(`${trimBase(apiUrl)}/instance/info/${instanceUuid}`, {
    headers: { apikey: adminToken, 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go get instance info error: ${response.status}`)
  }
  const data = await response.json()
  const payload = data?.data ?? data
  const jid: string | null = payload?.jid || null
  return { connected: Boolean(payload?.connected) || Boolean(jid), jid }
}

export interface InstanceLifecycleArgs {
  apiUrl: string
  adminToken: string
  instanceUuid: string
}

export async function logoutInstance(args: InstanceLifecycleArgs): Promise<void> {
  const { apiUrl, adminToken, instanceUuid } = args
  const response = await fetch(`${trimBase(apiUrl)}/instance/logout/${instanceUuid}`, {
    method: 'DELETE',
    headers: { apikey: adminToken },
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go logout instance error: ${response.status}`)
  }
}

export async function deleteInstance(args: InstanceLifecycleArgs): Promise<void> {
  const { apiUrl, adminToken, instanceUuid } = args
  const response = await fetch(`${trimBase(apiUrl)}/instance/delete/${instanceUuid}`, {
    method: 'DELETE',
    headers: { apikey: adminToken },
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go delete instance error: ${response.status}`)
  }
}

// ============================================================
// Sending (instance-authenticated)
// ============================================================

export interface SendTextMessageArgs {
  apiUrl: string
  instanceToken: string
  /** Digits-only, no "+" — same shape send-message.ts already passes to meta-api.ts. */
  to: string
  text: string
  quoted?: EvolutionQuoted
}

export async function sendTextMessage(args: SendTextMessageArgs): Promise<EvolutionSendResult> {
  const { apiUrl, instanceToken, to, text, quoted } = args
  const response = await fetch(`${trimBase(apiUrl)}/send/text`, {
    method: 'POST',
    headers: { apikey: instanceToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: to, text, delay: 0, ...(quoted ? { quoted } : {}) }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go send/text error: ${response.status}`)
  }
  return parseSendResponse(await response.json())
}

export type EvolutionMediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaMessageArgs {
  apiUrl: string
  instanceToken: string
  to: string
  kind: EvolutionMediaKind
  /** Public URL Evolution Go fetches at send time. */
  url: string
  caption?: string
  filename?: string
  quoted?: EvolutionQuoted
}

export async function sendMediaMessage(args: SendMediaMessageArgs): Promise<EvolutionSendResult> {
  const { apiUrl, instanceToken, to, kind, url, caption, filename, quoted } = args
  const response = await fetch(`${trimBase(apiUrl)}/send/media`, {
    method: 'POST',
    headers: { apikey: instanceToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: to,
      url,
      caption: caption || '',
      filename: filename || '',
      type: kind,
      delay: 0,
      ...(quoted ? { quoted } : {}),
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go send/media error: ${response.status}`)
  }
  return parseSendResponse(await response.json())
}

export interface EvolutionInteractiveButton {
  id: string
  title: string
}

export interface SendInteractiveButtonsArgs {
  apiUrl: string
  instanceToken: string
  to: string
  bodyText: string
  footerText?: string
  buttons: EvolutionInteractiveButton[]
  quoted?: EvolutionQuoted
}

export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs
): Promise<EvolutionSendResult> {
  const { apiUrl, instanceToken, to, bodyText, footerText, buttons, quoted } = args
  const response = await fetch(`${trimBase(apiUrl)}/send/button`, {
    method: 'POST',
    headers: { apikey: instanceToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: to,
      title: bodyText.slice(0, 60),
      description: bodyText,
      footer: footerText || '',
      buttons: buttons.map((b) => ({
        type: 'reply',
        displayText: b.title.slice(0, 20),
        id: b.id,
      })),
      delay: 0,
      ...(quoted ? { quoted } : {}),
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go send/button error: ${response.status}`)
  }
  return parseSendResponse(await response.json())
}

export interface EvolutionInteractiveListRow {
  id: string
  title: string
  description?: string
}

export interface EvolutionInteractiveListSection {
  title?: string
  rows: EvolutionInteractiveListRow[]
}

export interface SendInteractiveListArgs {
  apiUrl: string
  instanceToken: string
  to: string
  bodyText: string
  buttonLabel: string
  footerText?: string
  sections: EvolutionInteractiveListSection[]
  quoted?: EvolutionQuoted
}

export async function sendInteractiveList(
  args: SendInteractiveListArgs
): Promise<EvolutionSendResult> {
  const { apiUrl, instanceToken, to, bodyText, buttonLabel, footerText, sections, quoted } = args
  const response = await fetch(`${trimBase(apiUrl)}/send/list`, {
    method: 'POST',
    headers: { apikey: instanceToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: to,
      title: bodyText.slice(0, 60),
      description: bodyText,
      buttonText: buttonLabel,
      footerText: footerText || '',
      sections: sections.map((s) => ({
        title: s.title || '',
        rows: s.rows.map((r) => ({
          rowId: r.id,
          title: r.title.slice(0, 24),
          description: r.description || '',
        })),
      })),
      delay: 0,
      ...(quoted ? { quoted } : {}),
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution Go send/list error: ${response.status}`)
  }
  return parseSendResponse(await response.json())
}

// ============================================================
// Templates — Evolution Go has no template concept. Meta templates
// are rendered down to plain text (same behaviour as the reference
// evo-crm-community integration) and sent via sendTextMessage.
// ============================================================

/**
 * Renders an approved Meta template's body down to plain text for
 * providers with no template support, substituting {{1}}, {{2}}, …
 * with the same body values the Meta send-time builder would use.
 * Falls back to the bare template name if the template row isn't
 * available locally (e.g. malformed/unsynced row).
 */
export function renderTemplateAsText(
  template: MessageTemplate | null | undefined,
  fallbackName: string,
  params: SendTimeParams | undefined,
  legacyParams: string[] | undefined
): string {
  if (!template?.body_text) return fallbackName
  const values = params?.body ?? legacyParams ?? []
  const indices = extractVariableIndices(template.body_text)
  if (indices.length === 0) return template.body_text
  return template.body_text.replace(/\{\{(\d+)\}\}/g, (match, n) => {
    const i = Number(n) - 1
    return values[i] ?? match
  })
}
