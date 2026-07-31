/**
 * Instagram Graph API client — DM integration.
 *
 * Uses the same Meta Graph API base (v21.0) as the WhatsApp integration.
 * Requires an Instagram Business Account connected to a Facebook Page,
 * and a Page Access Token with `instagram_manage_messages` permission.
 *
 * API Reference:
 *   https://developers.facebook.com/docs/instagram-api/guides/messaging
 */

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string };
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = (await response.json()) as MetaErrorResponse;
    if (data.error?.message) message = data.error.message;
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message);
}

// ============================================================
// Verification — fetch IG Business Account info
// ============================================================

export interface InstagramUserInfo {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
}

export interface VerifyInstagramCredentialsArgs {
  igUserId: string;
  accessToken: string;
}

/**
 * Verify Instagram credentials by fetching the IG Business Account
 * metadata. Throws if the token or IG user id is invalid.
 */
export async function verifyInstagramCredentials(
  args: VerifyInstagramCredentialsArgs
): Promise<InstagramUserInfo> {
  const { igUserId, accessToken } = args;
  const url = `${META_API_BASE}/${igUserId}?fields=id,username,name,profile_picture_url`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`);
  }
  return response.json();
}

// ============================================================
// Sending DMs
// ============================================================

export interface SendInstagramDmArgs {
  igUserId: string;
  accessToken: string;
  /** Instagram-scoped user id of the recipient (not their username). */
  recipientId: string;
  text: string;
}

export interface SendInstagramDmResult {
  messageId: string;
}

/**
 * Send a DM on Instagram.
 *
 * The `recipientId` must be the Instagram-scoped user id (a numeric
 * string), which comes from the webhook's `sender.id` field — NOT
 * the user's Instagram username.
 */
export async function sendInstagramDm(
  args: SendInstagramDmArgs
): Promise<SendInstagramDmResult> {
  const { igUserId, accessToken, recipientId, text } = args;
  const url = `${META_API_BASE}/${igUserId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!response.ok) {
    await throwMetaError(response, `Failed to send Instagram DM: ${response.status}`);
  }

  const data = await response.json();
  return { messageId: data.message_id ?? data.id ?? 'unknown' };
}

// ============================================================
// Webhook verification helpers
// ============================================================

/**
 * Build the Instagram webhook verification challenge response.
 * Same pattern as the WhatsApp webhook — Meta sends:
 *   ?hub.mode=subscribe&hub.challenge=<challenge>&hub.verify_token=<token>
 */
export interface InstagramWebhookVerifyParams {
  mode: string | null;
  challenge: string | null;
  verifyToken: string | null;
}

/**
 * Result of webhook verification.
 * - { verified: true, challenge } — pass this challenge string back as the response
 * - { verified: false } — verification failed
 */
export interface InstagramWebhookVerifyResult {
  verified: boolean;
  challenge?: string;
}

export function verifyInstagramWebhook(
  params: InstagramWebhookVerifyParams,
  expectedToken: string
): InstagramWebhookVerifyResult {
  if (
    params.mode === 'subscribe' &&
    params.challenge &&
    params.verifyToken === expectedToken
  ) {
    return { verified: true, challenge: params.challenge };
  }
  return { verified: false };
}

// ============================================================
// Inbound DM webhook types
// ============================================================

export interface InstagramSender {
  id: string;
  user_id?: string; // Instagram-scoped user id of the sender
}

export interface InstagramMessage {
  mid: string; // message id
  text?: string;
  is_echo?: boolean;
  quick_reply?: { payload: string };
  reply_to?: { mid: string };
  attachments?: Array<{
    type: string;
    payload: { url?: string; sticker_id?: string };
  }>;
}

export interface InstagramMessagingEntry {
  sender: InstagramSender;
  recipient: { id: string };
  timestamp: number;
  message?: InstagramMessage;
}

export interface InstagramWebhookEntry {
  id: string; // IG Business Account id
  time: number;
  messaging: InstagramMessagingEntry[];
}

export interface InstagramWebhookPayload {
  object: string; // "instagram"
  entry: InstagramWebhookEntry[];
}

