// ============================================================
// Evolution API transport (UNOFFICIAL WhatsApp Web).
//
// A thin outbound client for a self-hosted Evolution API v2 instance,
// mirroring the shape of the Meta helpers in `meta-api.ts` (single
// fetch, throws on non-2xx, returns `{ messageId }`) so the shared
// `sendMessageToConversation` core can branch on `api_type` without
// caring which transport runs underneath.
//
// ⚠️ Evolution talks to WhatsApp Web on your behalf — this violates
// WhatsApp's Terms of Service and the number can be banned without
// warning. It's a zero-cost option for personal / testing use, not a
// drop-in for the official Cloud API.
//
// What this transport does NOT do (by design, for now):
//   - templates: a Meta-official concept with no Evolution equivalent.
//   - interactive buttons/lists: WhatsApp is deprecating them on the
//     Web protocol and Evolution's support is unreliable.
// The send core rejects those message types up front for Evolution
// with a clear error rather than silently dropping them.
// ============================================================

export interface EvolutionSendResult {
  /** The WhatsApp message id (`key.id`) Evolution echoes back. */
  messageId: string;
}

export interface EvolutionBaseArgs {
  /** Server base URL, no trailing slash (e.g. http://localhost:8080). */
  apiUrl: string;
  /** Instance name that identifies this connection on the server. */
  instanceName: string;
  /** The instance's apikey (stored encrypted in access_token). */
  apiKey: string;
  /** Recipient in E.164 (`+55…`) — the '+' is stripped for Evolution. */
  to: string;
}

export interface SendEvolutionTextArgs extends EvolutionBaseArgs {
  text: string;
}

/**
 * Evolution wants the recipient as bare digits (no '+', no separators).
 * A quoted-reply id or JID suffix is never appended here — Evolution
 * resolves the JID itself from the number.
 */
function toEvolutionNumber(to: string): string {
  return to.replace(/[^\d]/g, '');
}

function baseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

async function throwEvolutionError(
  response: Response,
  fallback: string
): Promise<never> {
  let detail = '';
  try {
    const body = await response.text();
    detail = body.slice(0, 500);
  } catch {
    /* ignore — use the fallback */
  }
  throw new Error(detail ? `${fallback}: ${detail}` : fallback);
}

/**
 * Extract the message id from an Evolution send response. v2 returns
 * `{ key: { id, remoteJid, fromMe }, ... }`; we tolerate a missing id
 * (some server builds omit it on success) by falling back to an empty
 * string so the caller can still persist the row.
 */
function extractMessageId(data: unknown): string {
  if (
    data &&
    typeof data === 'object' &&
    'key' in data &&
    data.key &&
    typeof data.key === 'object' &&
    'id' in data.key &&
    typeof (data.key as { id: unknown }).id === 'string'
  ) {
    return (data.key as { id: string }).id;
  }
  return '';
}

/**
 * Send a plain text message through an Evolution instance.
 * POST {apiUrl}/message/sendText/{instance} with the `apikey` header.
 */
export async function sendEvolutionText(
  args: SendEvolutionTextArgs
): Promise<EvolutionSendResult> {
  const { apiUrl, instanceName, apiKey, to, text } = args;
  const url = `${baseUrl(apiUrl)}/message/sendText/${encodeURIComponent(
    instanceName
  )}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    // Evolution v2 flattened the old `options` object — `delay` and
    // `presence` are top-level now. `presence: 'composing'` shows the
    // "typing…" indicator before the message lands, which reads more
    // human on a personal number.
    body: JSON.stringify({
      number: toEvolutionNumber(to),
      text,
      delay: 1000,
      presence: 'composing',
    }),
  });

  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`);
  }
  const data = await response.json();
  return { messageId: extractMessageId(data) };
}

export type EvolutionMediaKind = 'image' | 'video' | 'document' | 'audio';

export interface SendEvolutionMediaArgs extends EvolutionBaseArgs {
  kind: EvolutionMediaKind;
  /** Public URL Evolution fetches at send time. */
  link: string;
  /** Optional caption. Not applied to audio (voice notes carry none). */
  caption?: string;
  /** Document-only. File name shown in the recipient's chat. */
  filename?: string;
}

/**
 * Send an image, video, document, or audio through an Evolution
 * instance. Audio uses the dedicated `/message/sendWhatsAppAudio`
 * endpoint (renders as a playable voice note); the rest go through
 * `/message/sendMedia` with a `mediatype`.
 */
export async function sendEvolutionMedia(
  args: SendEvolutionMediaArgs
): Promise<EvolutionSendResult> {
  const { apiUrl, instanceName, apiKey, to, kind, link, caption, filename } =
    args;
  if (!link) throw new Error('sendEvolutionMedia requires a link.');

  const number = toEvolutionNumber(to);
  const headers = {
    'Content-Type': 'application/json',
    apikey: apiKey,
  };

  if (kind === 'audio') {
    const url = `${baseUrl(apiUrl)}/message/sendWhatsAppAudio/${encodeURIComponent(
      instanceName
    )}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number, audio: link, delay: 1000 }),
    });
    if (!response.ok) {
      await throwEvolutionError(
        response,
        `Evolution API error: ${response.status}`
      );
    }
    const data = await response.json();
    return { messageId: extractMessageId(data) };
  }

  const url = `${baseUrl(apiUrl)}/message/sendMedia/${encodeURIComponent(
    instanceName
  )}`;
  const body: Record<string, unknown> = {
    number,
    mediatype: kind,
    media: link,
    delay: 1000,
  };
  if (caption) body.caption = caption;
  if (kind === 'document' && filename) body.fileName = filename;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`);
  }
  const data = await response.json();
  return { messageId: extractMessageId(data) };
}
