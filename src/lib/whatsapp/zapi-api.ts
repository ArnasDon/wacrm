/**
 * Z-API HTTP client (self-service WhatsApp API, QR-code pairing).
 *
 * Unlike uazapi's reseller model, Z-API has no admin token and no
 * instance-creation call: each customer creates their own instance in
 * Z-API's own dashboard (app.z-api.io) and pastes Instance ID + Token
 * here. This client is purely a thin wrapper over the already-created
 * instance's endpoints.
 *
 * Endpoint paths and payload shapes below are taken from Z-API's own
 * docs (developer.z-api.io), fetched during implementation — not
 * guessed. Two things aren't literally spelled out anywhere in the
 * docs and are inferred from a pattern confirmed correct on every
 * endpoint we could verify directly (send-text, send-button-list,
 * send-option-list, update-every-webhooks, send-remove-reaction all
 * match "doc page slug == URL path segment" exactly):
 *   - status/qr-code/qr-code-image/me are GET; disconnect/restart are
 *     POST (REST convention for an action vs. a read, matching the
 *     analogous uazapi endpoints) — the docs' own wording ("verifique
 *     se enviou o POST ou GET") doesn't commit to one method in the
 *     rendered text for these four.
 *   - The status/qr-code endpoints returning a `{ challenge: {...} }`
 *     object instead of the normal shape (Z-API's "Passkey" 2FA
 *     challenge some devices require) is NOT handled here — it
 *     surfaces as a response missing the expected fields, which the
 *     provider adapter treats as "no QR yet". Revisit if real Z-API
 *     testing hits a device that requires it.
 *
 * Every send endpoint normalizes to `{ messageId }` — Z-API's own
 * response includes `zaapId`/`messageId`/`id` (the latter two always
 * equal), matching the `{ messageId }` shape uazapi-api.ts and
 * meta-api.ts already use.
 */

function baseUrl(instanceId: string, token: string): string {
  return `https://api.z-api.io/instances/${instanceId}/token/${token}`
}

function headers(clientToken?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  // Optional per Z-API's own security model — disabled by default per
  // account until the user turns it on in their Z-API dashboard. When
  // set, every request must carry it or Z-API rejects with
  // {"error": "null not allowed"}.
  if (clientToken) h['Client-Token'] = clientToken
  return h
}

interface ZapiErrorResponse {
  error?: string
}

async function throwZapiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as ZapiErrorResponse
    if (data.error) message = data.error
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface ZapiSendResult {
  messageId: string
}

function normalizeSendResult(data: { messageId?: string; id?: string }): ZapiSendResult {
  const messageId = data.messageId ?? data.id
  if (!messageId) throw new Error('Z-API did not return a message id')
  return { messageId: String(messageId) }
}

// ============================================================
// Instance status / QR pairing
// ============================================================

export interface ZapiInstanceStatusResult {
  connected: boolean
  /** Human-readable detail Z-API includes alongside `connected`. */
  detail?: string
}

/** GET /status — whether this instance is currently paired to a WhatsApp account. */
export async function getInstanceStatus(args: {
  instanceId: string
  token: string
  clientToken?: string
}): Promise<ZapiInstanceStatusResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/status`, {
    headers: headers(args.clientToken),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  return { connected: Boolean(data.connected), detail: data.error }
}

/**
 * GET /profile-picture?phone=... — the contact's current WhatsApp
 * profile photo URL. Confirmed via Z-API's own docs (developer.z-api.io
 * /contacts/get-profile-picture) and a search-confirmed endpoint path,
 * since the rendered docs page didn't spell out the literal path
 * itself. Returns null on any non-2xx (e.g. contact has no photo, or
 * privacy settings hide it) rather than throwing — a missing photo is
 * an expected outcome here, not an error worth surfacing.
 */
export async function getProfilePicture(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
}): Promise<{ url: string | null }> {
  const response = await fetch(
    `${baseUrl(args.instanceId, args.token)}/profile-picture?phone=${encodeURIComponent(args.phone)}`,
    { headers: headers(args.clientToken) },
  )
  if (!response.ok) return { url: null }
  const data = await response.json()
  return { url: typeof data.link === 'string' && data.link ? data.link : null }
}

/**
 * GET /qr-code — QR code as a data URL (`data:image/png;base64,...`),
 * ready to render directly in an <img>. Returns null once already
 * connected or mid-Passkey-challenge (see file header) rather than
 * throwing, since "no QR right now" is an expected polling state, not
 * an error.
 */
export async function getQrCode(args: {
  instanceId: string
  token: string
  clientToken?: string
}): Promise<{ qrCode: string | null }> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/qr-code`, {
    headers: headers(args.clientToken),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  return { qrCode: typeof data.value === 'string' ? data.value : null }
}

/** POST /disconnect — ends the WhatsApp session; instance + credentials survive for reconnect. */
export async function disconnectInstance(args: {
  instanceId: string
  token: string
  clientToken?: string
}): Promise<void> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/disconnect`, {
    method: 'POST',
    headers: headers(args.clientToken),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
}

// ============================================================
// Webhook configuration
// ============================================================

/**
 * PUT /update-every-webhooks — points every Z-API webhook type
 * (received, delivery, status, connected, disconnected) at the same
 * URL in one call. Mirrors uazapi-api.ts::configureWebhook's role;
 * Z-API's inbound events all carry a `type` discriminator
 * (ReceivedCallback/MessageStatusCallback/ConnectedCallback/
 * DisconnectedCallback) so one shared route can branch on it the same
 * way the uazapi webhook route branches on `event`.
 */
export async function configureWebhook(args: {
  instanceId: string
  token: string
  clientToken?: string
  url: string
}): Promise<void> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/update-every-webhooks`, {
    method: 'PUT',
    headers: headers(args.clientToken),
    body: JSON.stringify({ value: args.url, notifySentByMe: false }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
}

// ============================================================
// Sending
// ============================================================

export async function sendText(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  message: string
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-text`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({ phone: args.phone, message: args.message }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

export async function sendImage(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  /** URL or `data:image/...;base64,...` string — Z-API accepts either. */
  image: string
  caption?: string
  messageId?: string
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-image`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({
      phone: args.phone,
      image: args.image,
      caption: args.caption,
      messageId: args.messageId,
    }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

export async function sendVideo(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  video: string
  caption?: string
  messageId?: string
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-video`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({
      phone: args.phone,
      video: args.video,
      caption: args.caption,
      messageId: args.messageId,
    }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

export async function sendAudio(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  audio: string
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-audio`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({ phone: args.phone, audio: args.audio }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

/**
 * POST /send-document/{extension} — the file extension (pdf, xlsx, …)
 * is a URL path segment, not a body field, per Z-API's docs.
 */
export async function sendDocument(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  document: string
  extension: string
  fileName?: string
  caption?: string
  messageId?: string
}): Promise<ZapiSendResult> {
  const response = await fetch(
    `${baseUrl(args.instanceId, args.token)}/send-document/${args.extension}`,
    {
      method: 'POST',
      headers: headers(args.clientToken),
      body: JSON.stringify({
        phone: args.phone,
        document: args.document,
        fileName: args.fileName,
        caption: args.caption,
        messageId: args.messageId,
      }),
    },
  )
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

export async function sendReaction(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  messageId: string
  reaction: string
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-reaction`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({ phone: args.phone, reaction: args.reaction, messageId: args.messageId }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

/** POST /send-remove-reaction — removes a previously-sent reaction. */
export async function removeReaction(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  messageId: string
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-remove-reaction`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({ phone: args.phone, messageId: args.messageId }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

export interface ZapiButton {
  id: string
  label: string
}

/** POST /send-button-list — up to a few quick-reply buttons under a text body. */
export async function sendButtonList(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  message: string
  buttons: ZapiButton[]
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-button-list`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({
      phone: args.phone,
      message: args.message,
      buttonList: { buttons: args.buttons.map((b) => ({ id: b.id, label: b.label })) },
    }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}

export interface ZapiOption {
  id: string
  title: string
  description?: string
}

/** POST /send-option-list — a tap-to-expand list of selectable rows. */
export async function sendOptionList(args: {
  instanceId: string
  token: string
  clientToken?: string
  phone: string
  message: string
  title: string
  buttonLabel: string
  options: ZapiOption[]
}): Promise<ZapiSendResult> {
  const response = await fetch(`${baseUrl(args.instanceId, args.token)}/send-option-list`, {
    method: 'POST',
    headers: headers(args.clientToken),
    body: JSON.stringify({
      phone: args.phone,
      message: args.message,
      optionList: {
        title: args.title,
        buttonLabel: args.buttonLabel,
        options: args.options.map((o) => ({ id: o.id, title: o.title, description: o.description })),
      },
    }),
  })
  if (!response.ok) {
    await throwZapiError(response, `HTTP ${response.status}`)
  }
  return normalizeSendResult(await response.json())
}
