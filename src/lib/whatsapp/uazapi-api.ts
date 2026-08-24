/**
 * uazapi HTTP client (unofficial WhatsApp API, QR-code pairing).
 *
 * Mirrors `meta-api.ts`'s shape: one function per endpoint, named-arg
 * style, every credential (`baseUrl`, `token`, `adminToken`) passed
 * in explicitly rather than read from env/DB internally — same
 * discipline `meta-api.ts` follows with `phoneNumberId`/`accessToken`.
 * Callers (send-core.ts, the /api/uazapi/* routes) resolve `baseUrl`/
 * `adminToken` once via `resolveUazapiPlatformCredentials()`
 * (uazapi-platform-config.ts) and pass them down, so this file stays
 * a stateless, DB-free HTTP client. Plain `Error` thrown on non-2xx
 * so the shared retry/error handling in `send-core.ts` doesn't need
 * to branch on provider-specific error shapes. Every send/status
 * response is normalized to `{ messageId }` at this layer (uazapi's
 * own field is the lowercase `messageid`) — same reason `meta-api.ts`
 * normalizes Meta's response shape itself rather than leaving it to
 * the provider adapter.
 *
 * Reseller credential model (see migration 037): this wacrm
 * deployment holds ONE uazapi admin subscription. `adminToken` is
 * used ONLY by `createInstance` (instance management) — enforce in
 * review that it never reaches anything client-side. Every other
 * function authenticates with the per-instance `token` that
 * `createInstance` returns and that gets encrypted into
 * `whatsapp_config.uazapi_token`.
 */

interface UazapiErrorResponse {
  error?: string
}

async function throwUazapiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as UazapiErrorResponse
    if (data.error) message = data.error
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface UazapiSendResult {
  messageId: string
}

export type UazapiInstanceStatus = 'disconnected' | 'connecting' | 'connected' | 'hibernated'

// ============================================================
// Instance lifecycle (admin token — server-only, instance management)
// ============================================================

export interface CreateInstanceArgs {
  baseUrl: string
  adminToken: string
  name: string
}

export interface CreateInstanceResult {
  instanceId: string
  token: string
}

/**
 * POST /instance/init — provisions a new uazapi instance for one
 * account.
 *
 * Was `/instance/create` — uazapi (now "uazapiGO") renamed this
 * endpoint at some point; the old path apparently still resolves to
 * *something* on their router, but returns a bare 401 instead of a
 * 404, which read exactly like an invalid admin token. Confirmed via
 * uazapi's own docs/community tooling (docs.uazapi.com's
 * `instance~init` slug, and the n8n uazapi node's "Instance: Create"
 * operation, which both point at `/instance/init`) and by the account
 * owner successfully creating an instance by hand from uazapi's own
 * dashboard with the same Admin Token our server kept rejecting —
 * proof the token itself was always fine.
 */
export async function createInstance(
  args: CreateInstanceArgs,
): Promise<CreateInstanceResult> {
  const response = await fetch(`${args.baseUrl}/instance/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      admintoken: args.adminToken,
    },
    body: JSON.stringify({ name: args.name }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  const instanceId = data.instance?.id
  const token = data.token
  if (!instanceId || !token) {
    throw new Error('uazapi did not return an instance id/token')
  }
  return { instanceId: String(instanceId), token: String(token) }
}

/** DELETE /instance — removes the instance entirely. */
export async function deleteInstance(args: { baseUrl: string; token: string }): Promise<void> {
  const response = await fetch(`${args.baseUrl}/instance`, {
    method: 'DELETE',
    headers: { token: args.token },
  })
  // A 404 means it's already gone on uazapi's side — treat as success,
  // mirroring meta-api.ts::deleteMessageTemplate's same convention.
  if (!response.ok && response.status !== 404) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
}

// ============================================================
// Connection / QR pairing (per-instance token)
// ============================================================

export interface ConnectInstanceArgs {
  baseUrl: string
  token: string
  /** When set, requests a pairing CODE instead of a QR image. */
  phone?: string
}

export interface ConnectInstanceResult {
  status: UazapiInstanceStatus
  qrcode?: string
  paircode?: string
}

/** POST /instance/connect — starts pairing, returns a QR image or pairing code. */
export async function connectInstance(
  args: ConnectInstanceArgs,
): Promise<ConnectInstanceResult> {
  const response = await fetch(`${args.baseUrl}/instance/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: args.token,
    },
    body: JSON.stringify(args.phone ? { phone: args.phone } : {}),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  const instance = data.instance ?? {}
  return {
    status: (instance.status as UazapiInstanceStatus) ?? 'connecting',
    qrcode: instance.qrcode || undefined,
    paircode: instance.paircode || undefined,
  }
}

export interface InstanceStatusResult {
  status: UazapiInstanceStatus
  qrcode?: string
  paircode?: string
  /** The personal WhatsApp number that scanned the QR, once connected. */
  pairedPhone?: string
}

/** GET /instance/status — poll target while connecting; also reports the live state once connected. */
export async function getInstanceStatus(args: {
  baseUrl: string
  token: string
}): Promise<InstanceStatusResult> {
  const response = await fetch(`${args.baseUrl}/instance/status`, {
    headers: { token: args.token },
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  const instance = data.instance ?? {}
  const jid = data.status?.jid as { user?: string } | null | undefined
  return {
    status: (instance.status as UazapiInstanceStatus) ?? 'disconnected',
    qrcode: instance.qrcode || undefined,
    paircode: instance.paircode || undefined,
    pairedPhone: jid?.user || undefined,
  }
}

/** POST /instance/disconnect — ends the session; instance + credentials survive for reconnect. */
export async function disconnectInstance(args: { baseUrl: string; token: string }): Promise<void> {
  const response = await fetch(`${args.baseUrl}/instance/disconnect`, {
    method: 'POST',
    headers: { token: args.token },
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
}

// ============================================================
// Webhook configuration
// ============================================================

/**
 * POST /webhook (simple mode — no `action`/`id`, manages the single
 * per-instance webhook). Pointed at the new
 * /api/uazapi/webhook/[accountId]/[secret] route (Phase 3) —
 * `excludeMessages: ['wasSentByApi']` avoids echo loops the same way
 * the Meta side already guards against re-processing its own sends.
 */
export async function configureWebhook(args: {
  baseUrl: string
  token: string
  url: string
}): Promise<void> {
  const response = await fetch(`${args.baseUrl}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: args.token,
    },
    body: JSON.stringify({
      enabled: true,
      url: args.url,
      events: ['messages', 'messages_update', 'connection'],
      excludeMessages: ['wasSentByApi'],
    }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
}

// ============================================================
// Sending
// ============================================================

export async function sendText(args: {
  baseUrl: string
  token: string
  number: string
  text: string
}): Promise<UazapiSendResult> {
  const response = await fetch(`${args.baseUrl}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: args.token },
    body: JSON.stringify({ number: args.number, text: args.text }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  const messageId = data.messageid ?? data.id
  if (!messageId) throw new Error('uazapi did not return a message id')
  return { messageId: String(messageId) }
}

export type UazapiMediaType = 'image' | 'video' | 'document' | 'audio' | 'ptt'

export async function sendMedia(args: {
  baseUrl: string
  token: string
  number: string
  type: UazapiMediaType
  file: string
  text?: string
  docName?: string
}): Promise<UazapiSendResult> {
  const response = await fetch(`${args.baseUrl}/send/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: args.token },
    body: JSON.stringify({
      number: args.number,
      type: args.type,
      file: args.file,
      text: args.text,
      docName: args.docName,
    }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  const messageId = data.messageid ?? data.id
  if (!messageId) throw new Error('uazapi did not return a message id')
  return { messageId: String(messageId) }
}

export async function sendReaction(args: {
  baseUrl: string
  token: string
  number: string
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}): Promise<UazapiSendResult> {
  const response = await fetch(`${args.baseUrl}/message/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: args.token },
    body: JSON.stringify({ number: args.number, text: args.emoji, id: args.targetMessageId }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  // The reaction endpoint's success payload doesn't guarantee a fresh
  // id the same way /send/* does — fall back to the target id so
  // callers always get a stable string back.
  const messageId = data.messageid ?? data.id ?? args.targetMessageId
  return { messageId: String(messageId) }
}

/**
 * POST /message/download — resolves a public URL for an inbound
 * media message. Mirrors the two-step Meta flow (getMediaUrl +
 * downloadMedia) conceptually, but uazapi collapses it into one call
 * that can return a link directly (`return_link: true`). uazapi
 * retains media in its own storage for ~2 days per its docs, so
 * storing the returned URL directly as `messages.media_url` is safe
 * for that window — unlike Meta's short-lived authenticated CDN URLs,
 * which is why the Meta path needs its own long-lived proxy route and
 * this one doesn't.
 */
export async function downloadMessageMedia(args: {
  baseUrl: string
  token: string
  messageId: string
}): Promise<{ fileUrl: string | null; mimetype?: string }> {
  const response = await fetch(`${args.baseUrl}/message/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: args.token },
    body: JSON.stringify({ id: args.messageId, return_link: true, return_base64: false }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  return { fileUrl: data.fileURL || null, mimetype: data.mimetype }
}

// ============================================================
// Contacts
// ============================================================

export interface UazapiContact {
  jid: string
  contact_name?: string
  contact_FirstName?: string
}

/**
 * GET /contacts?contactScope=address_book — the WhatsApp numbers this
 * instance's connected phone has saved to its own address book, with
 * the name saved for each (`contact_name`) — confirmed against
 * uazapi's published response example (docs.uazapi.com/tag/Contatos).
 * `contactScope` also accepts `outside_address_book`/`all`, but
 * `address_book` is the one that actually matches "a name this phone
 * saved for this contact" rather than a self-reported WhatsApp
 * display name — see contact-name-sync.ts, which is the only caller.
 */
export async function listContacts(args: {
  baseUrl: string
  token: string
  contactScope?: 'address_book' | 'outside_address_book' | 'all'
}): Promise<UazapiContact[]> {
  const scope = args.contactScope ?? 'address_book'
  const response = await fetch(
    `${args.baseUrl}/contacts?contactScope=${encodeURIComponent(scope)}`,
    { headers: { token: args.token } },
  )
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  return Array.isArray(data) ? (data as UazapiContact[]) : []
}

export interface UazapiChat {
  wa_chatid: string
  wa_name?: string
  name?: string
  image?: string
  imagePreview?: string
  wa_isGroup?: boolean
  wa_isGroup_community?: boolean
}

/**
 * POST /chat/find — looks up one chat's own metadata by id, used to
 * resolve a WhatsApp group/community's real name + photo (`wa_name`/
 * `image`) at the moment its first message creates a contact row for
 * it — see chat-classify.ts and contact-name-sync.ts's own reasoning
 * for why the per-message `senderName` field isn't the right source
 * for a group's name (it's the individual participant who sent that
 * message, not the group itself). Confirmed against uazapi's
 * published response example (docs.uazapi.com/endpoint/post/chat~find).
 */
export async function findChat(args: {
  baseUrl: string
  token: string
  chatId: string
}): Promise<UazapiChat | null> {
  const response = await fetch(`${args.baseUrl}/chat/find`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: args.token },
    body: JSON.stringify({ wa_chatid: args.chatId, limit: 1 }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  const chats = Array.isArray(data?.chats) ? data.chats : []
  return (chats[0] as UazapiChat | undefined) ?? null
}

/**
 * POST /send/menu — covers both interactive buttons and lists. The
 * caller (UazapiProvider) is responsible for encoding `choices` into
 * uazapi's string-based format:
 *   buttons: "title|id"
 *   list rows: "title|id" or "title|id|description", with
 *              "[Section Title]" entries marking new sections.
 */
export async function sendMenu(args: {
  baseUrl: string
  token: string
  number: string
  type: 'button' | 'list'
  text: string
  choices: string[]
  footerText?: string
  listButton?: string
}): Promise<UazapiSendResult> {
  const response = await fetch(`${args.baseUrl}/send/menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: args.token },
    body: JSON.stringify({
      number: args.number,
      type: args.type,
      text: args.text,
      choices: args.choices,
      footerText: args.footerText,
      listButton: args.listButton,
    }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `HTTP ${response.status}`)
  }
  const data = await response.json()
  const messageId = data.messageid ?? data.id
  if (!messageId) throw new Error('uazapi did not return a message id')
  return { messageId: String(messageId) }
}
