/**
 * Z-API WhatsApp client.
 *
 * Z-API uses a fixed base URL with the instance id and instance token
 * in the path, plus the account Client-Token in the request headers.
 * Keep this module credential-explicit so call sites never depend on
 * process-wide provider state.
 */

export interface ZapiCredentials {
  instanceId: string
  instanceToken: string
  clientToken: string
}

export interface ZapiSendResult {
  messageId: string
  zaapId?: string
}

export interface ZapiInstanceInfo {
  id?: string
  token?: string
  name?: string
  connected?: boolean
  phone?: string
  connectedPhone?: string
  paymentStatus?: string
  connectedCallbackUrl?: string
  deliveryCallbackUrl?: string
  disconnectedCallbackUrl?: string
  messageStatusCallbackUrl?: string
  receivedCallbackUrl?: string
  [key: string]: unknown
}

function getBaseUrl(credentials: ZapiCredentials): string {
  return `https://api.z-api.io/instances/${encodeURIComponent(credentials.instanceId)}/token/${encodeURIComponent(credentials.instanceToken)}`
}

function buildHeaders(credentials: ZapiCredentials): Record<string, string> {
  return {
    'Client-Token': credentials.clientToken,
    'Content-Type': 'application/json',
  }
}

interface ZapiErrorBody {
  error?: string
  message?: string
  value?: unknown
}

async function throwZapiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as ZapiErrorBody
    if (typeof data.message === 'string' && data.message.trim()) {
      message = data.message
    } else if (typeof data.error === 'string' && data.error.trim()) {
      message = data.error
    }
  } catch {
    // Response body was not JSON.
  }
  throw new Error(`Z-API error (${response.status}): ${message}`)
}

async function postJson(
  credentials: ZapiCredentials,
  path: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${getBaseUrl(credentials)}${path}`, {
    method: 'POST',
    headers: buildHeaders(credentials),
    body: JSON.stringify(body),
  })
  if (!res.ok) await throwZapiError(res, fallback)
  return (await res.json()) as Record<string, unknown>
}

async function putJson(
  credentials: ZapiCredentials,
  path: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${getBaseUrl(credentials)}${path}`, {
    method: 'PUT',
    headers: buildHeaders(credentials),
    body: JSON.stringify(body),
  })
  if (!res.ok) await throwZapiError(res, fallback)
  return (await res.json()) as Record<string, unknown>
}

function normalizeSendResult(data: Record<string, unknown>): ZapiSendResult {
  const messageId =
    typeof data.messageId === 'string'
      ? data.messageId
      : typeof data.id === 'string'
        ? data.id
        : typeof data.zaapId === 'string'
          ? data.zaapId
          : ''
  return {
    messageId,
    zaapId: typeof data.zaapId === 'string' ? data.zaapId : undefined,
  }
}

export interface SendTextArgs {
  credentials: ZapiCredentials
  phone: string
  text: string
  replyTo?: string
}

export async function sendText(args: SendTextArgs): Promise<ZapiSendResult> {
  const body: Record<string, unknown> = {
    phone: args.phone,
    message: args.text,
  }
  if (args.replyTo) body.messageId = args.replyTo

  const data = await postJson(
    args.credentials,
    '/send-text',
    body,
    'Failed to send text message'
  )
  return normalizeSendResult(data)
}

export interface SendImageArgs {
  credentials: ZapiCredentials
  phone: string
  url: string
  caption?: string
  replyTo?: string
}

export async function sendImage(args: SendImageArgs): Promise<ZapiSendResult> {
  const body: Record<string, unknown> = {
    phone: args.phone,
    image: args.url,
  }
  if (args.caption) body.caption = args.caption
  if (args.replyTo) body.messageId = args.replyTo

  const data = await postJson(args.credentials, '/send-image', body, 'Failed to send image')
  return normalizeSendResult(data)
}

export interface SendVideoArgs {
  credentials: ZapiCredentials
  phone: string
  url: string
  caption?: string
  replyTo?: string
}

export async function sendVideo(args: SendVideoArgs): Promise<ZapiSendResult> {
  const body: Record<string, unknown> = {
    phone: args.phone,
    video: args.url,
  }
  if (args.caption) body.caption = args.caption
  if (args.replyTo) body.messageId = args.replyTo

  const data = await postJson(args.credentials, '/send-video', body, 'Failed to send video')
  return normalizeSendResult(data)
}

export interface SendDocumentArgs {
  credentials: ZapiCredentials
  phone: string
  url: string
  filename?: string
  caption?: string
  replyTo?: string
}

function documentExtension(filename?: string): string {
  const ext = filename?.split('.').pop()?.trim().toLowerCase()
  if (ext && /^[a-z0-9]{1,12}$/.test(ext)) return ext
  return 'pdf'
}

export async function sendDocument(args: SendDocumentArgs): Promise<ZapiSendResult> {
  const body: Record<string, unknown> = {
    phone: args.phone,
    document: args.url,
  }
  if (args.filename) body.fileName = args.filename
  if (args.caption) body.caption = args.caption
  if (args.replyTo) body.messageId = args.replyTo

  const data = await postJson(
    args.credentials,
    `/send-document/${documentExtension(args.filename)}`,
    body,
    'Failed to send document'
  )
  return normalizeSendResult(data)
}

export interface SendAudioArgs {
  credentials: ZapiCredentials
  phone: string
  url: string
  replyTo?: string
}

export async function sendAudio(args: SendAudioArgs): Promise<ZapiSendResult> {
  const body: Record<string, unknown> = {
    phone: args.phone,
    audio: args.url,
  }
  if (args.replyTo) body.messageId = args.replyTo

  const data = await postJson(
    args.credentials,
    '/send-audio',
    body,
    'Failed to send audio'
  )
  return normalizeSendResult(data)
}

export interface SendReactionArgs {
  credentials: ZapiCredentials
  phone: string
  messageId: string
  emoji: string
}

export async function sendReaction(args: SendReactionArgs): Promise<ZapiSendResult> {
  const data = await postJson(
    args.credentials,
    '/send-reaction',
    {
      phone: args.phone,
      messageId: args.messageId,
      reaction: args.emoji,
    },
    'Failed to send reaction'
  )
  const result = normalizeSendResult(data)
  return { ...result, messageId: result.messageId || args.messageId }
}

export async function getInstance(
  credentials: ZapiCredentials
): Promise<ZapiInstanceInfo> {
  const res = await fetch(`${getBaseUrl(credentials)}/me`, {
    method: 'GET',
    headers: buildHeaders(credentials),
  })
  if (!res.ok) await throwZapiError(res, 'Failed to get instance data')
  return (await res.json()) as ZapiInstanceInfo
}

function normalizeQrValue(value: string): { value: string; mimetype: string } {
  const dataUrl = value.match(/^data:([^;]+);base64,(.+)$/)
  if (dataUrl) return { mimetype: dataUrl[1], value: dataUrl[2] }
  return { mimetype: 'image/png', value }
}

export async function getQrCode(
  credentials: ZapiCredentials
): Promise<{ value: string; mimetype: string }> {
  const res = await fetch(`${getBaseUrl(credentials)}/qr-code/image`, {
    method: 'GET',
    headers: buildHeaders(credentials),
  })
  if (!res.ok) await throwZapiError(res, 'Failed to get QR code')
  const data = (await res.json()) as Record<string, unknown>
  const raw =
    typeof data.qrcode === 'string'
      ? data.qrcode
      : typeof data.qrCode === 'string'
        ? data.qrCode
        : typeof data.value === 'string'
          ? data.value
          : ''
  return normalizeQrValue(raw)
}

export async function updateAllWebhooks(args: {
  credentials: ZapiCredentials
  url: string
  notifySentByMe?: boolean
}): Promise<void> {
  await putJson(
    args.credentials,
    '/update-every-webhooks',
    {
      value: args.url,
      notifySentByMe: args.notifySentByMe ?? false,
    },
    'Failed to update webhooks'
  )
}
