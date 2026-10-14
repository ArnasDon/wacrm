import { NextResponse, after } from 'next/server';
import { getPool, withTransaction } from '@/lib/db/pool';
import {
  resolveInboundThread,
  insertInboundMessage,
  saveInboundReaction,
  updateInboundStatus,
} from '@/lib/db/inbound';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { getMediaUrl } from '@/lib/whatsapp/meta-api';
import { mirrorInboundLocal } from '@/lib/whatsapp/mirror-inbound-local';
import {
  hasUsableIdentity,
  resolveInboundIdentity,
  type WaContactPayload,
} from '@/lib/whatsapp/wa-identity';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { applyTemplateEvent } from '@/lib/db/template-events';

// The `after()` callback in POST runs within this route's max duration.
// Inbound processing can fan out to per-media Meta verification calls, so
// give it headroom beyond the platform default (Vercel clamps this to the
// plan's ceiling). Tune as needed.
export const maxDuration = 60;

interface WhatsAppMessage {
  id: string;
  /**
   * Sender's phone number. **Optional since Meta's username rollout** —
   * a sender who has adopted a WhatsApp username and has no recent
   * interaction history with this business arrives with no phone number
   * at all, identified only by `from_user_id` (issue #519). See
   * `@/lib/whatsapp/wa-identity`.
   */
  from?: string;
  /** Sender's business-scoped user ID (BSUID). */
  from_user_id?: string;
  /** Sender's portfolio-level BSUID. */
  from_parent_user_id?: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: {
    id: string;
    mime_type: string;
    filename?: string;
    caption?: string;
  };
  audio?: { id: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  reaction?: { message_id: string; emoji: string };
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  /**
   * Set when the customer taps a QUICK_REPLY button on a *template*
   * message — a broadcast, or any template send. Meta uses a different
   * envelope from `interactive` above: `type: 'button'`, the label in
   * `button.text`, and the payload configured on the template's button
   * in `button.payload` (Meta's own template editor doesn't ask for a
   * payload and mirrors the label into it).
   */
  button?: { text?: string; payload?: string };
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string };
}

/** One entry of a failed status's `errors` array, as Meta sends it. */
interface MetaStatusError {
  code: number;
  title: string;
  message?: string;
  error_data?: { details?: string };
  href?: string;
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: { name?: string; username?: string };
        /** Absent for a username-only sender — see WhatsAppMessage.from. */
        wa_id?: string;
        user_id?: string;
        parent_user_id?: string;
      }>;
      messages?: WhatsAppMessage[];
      statuses?: Array<{
        id: string;
        status: string;
        timestamp: string;
        recipient_id: string;
        /**
         * Only present when `status === 'failed'`. Meta's reason for the
         * failure — `code` is a stable numeric error code (e.g. 131049),
         * `title` a short label, `error_data.details` the human-readable
         * explanation. See #535.
         */
        errors?: MetaStatusError[];
      }>;
    };
    field: string;
  }>;
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const challenge = searchParams.get('hub.challenge');
    const verifyToken = searchParams.get('hub.verify_token');

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      );
    }

    const { rows: configs } = await getPool('worker').query<{
      id: string;
      verify_token: string | null;
    }>('SELECT id,verify_token FROM public.whatsapp_config');

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    let matchedConfig: { id: string; verify_token: string | null } | null =
      null;
    for (const config of configs) {
      if (!config.verify_token) continue;
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config;
          break;
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (
        matchedConfig.verify_token &&
        isLegacyFormat(matchedConfig.verify_token)
      ) {
        const matched = matchedConfig;
        after(async () => {
          try {
            await getPool('worker').query(
              'UPDATE public.whatsapp_config SET verify_token=$2 WHERE id=$1 AND verify_token=$3',
              [matched.id, encrypt(verifyToken), matched.verify_token]
            );
          } catch {
            console.warn('[webhook] verify token upgrade failed');
          }
        });
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    );
  } catch (error) {
    console.error('Error in webhook GET verification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // 401 (not 200) — we want Meta's delivery dashboard to show failures
    // loudly if a misconfiguration causes signatures to stop matching,
    // rather than silently eating events.
    console.warn('[webhook] rejected request with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { entry?: WhatsAppWebhookEntry[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Process AFTER the response so we ack Meta within their ~20s timeout
  // (a slow ack triggers Meta retries + duplicate inserts), while still
  // guaranteeing the work runs to completion.
  //
  // This MUST use `after()` rather than a detached `processWebhook(body)`
  // promise: on serverless platforms (we run on Vercel) the function can
  // be frozen or terminated the moment the response is sent, so a floating
  // promise's DB writes are not guaranteed to finish. That dropped a
  // non-deterministic *subset* of inbound messages — contacts/conversations
  // were created but the message insert never landed, leaving conversations
  // that show in the inbox with an empty thread, and no logs to explain it
  // (see issue #301). `after()` hands the callback to the runtime, which
  // keeps the function alive until it resolves (within the route's
  // maxDuration).
  after(async () => {
    try {
      await processWebhook(body);
    } catch (error) {
      console.error('Error processing webhook:', error);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return;

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Template-lifecycle events (status / quality / components
      // updates from Meta) come in on a different change.field and
      // have a different value shape — route them through the
      // dedicated handler. Skip the messaging branches below so we
      // don't try to read message-shaped fields off a template event.
      // `entry.id` is the WABA id for template events — the handler
      // needs it to resolve the owning account when the template has
      // no local row yet (#534).
      if (
        [
          'message_template_status_update',
          'message_template_quality_update',
          'message_template_components_update',
        ].includes(change.field)
      ) {
        await withTransaction(
          (db) =>
            applyTemplateEvent(db, {
              field: change.field,
              value: change.value,
              wabaId: entry.id,
            }),
          'worker'
        );
        continue;
      }

      const value = change.value;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const { rows: configRows } = await getPool('worker').query(
        'SELECT * FROM public.whatsapp_config WHERE phone_number_id=$1',
        [phoneNumberId]
      );
      if (configRows.length !== 1) {
        console.warn(
          '[webhook] receiving number has no unique local configuration'
        );
        continue;
      }
      const config = configRows[0];
      for (const status of value.statuses ?? []) {
        const changed = await withTransaction(
          (db) => updateInboundStatus(db, config.account_id, status),
          'worker'
        );
        for (const row of changed)
          await dispatchWebhookEvent(
            getPool('worker'),
            config.account_id,
            'message.status_updated',
            {
              whatsapp_message_id: status.id,
              conversation_id: row.conversationId,
              status: status.status,
            }
          );
      }
      if (!value.messages) continue;

      const decryptedAccessToken = decrypt(config.access_token);

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i];
        const contact = value.contacts?.[i] || value.contacts?.[0];

        await processMessage(
          message,
          contact,
          // Tenancy — drives every contact / conversation lookup
          // and the engines' active-row dispatch.
          config.account_id,
          // Audit / sender-of-record — used as the user_id on row
          // inserts that need it for NOT NULL FK compliance. Always
          // the admin who saved the WhatsApp config.
          config.user_id,
          decryptedAccessToken,
          // Default ON: the column is NOT NULL DEFAULT TRUE, but a row
          // read before migration 039 lands would have it undefined,
          // and losing attachments is the failure mode worth avoiding.
          config.mirror_inbound_media !== false
        );
      }
    }
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: WaContactPayload | undefined,
  // Tenancy. Resolved from the matched whatsapp_config row; every
  // contact / conversation / message row created downstream is
  // stamped with this so any member of the account can see it.
  accountId: string,
  // Sender-of-record for inserts that need a NOT NULL user_id FK
  // (contacts, conversations). Always the admin who saved the
  // WhatsApp config; the choice is arbitrary post-017 but stable.
  configOwnerUserId: string,
  accessToken: string,
  // Per-account opt-out for the inbound-media mirror (migration 039).
  // See parseMessageContent for what it turns off.
  mirrorMedia: boolean
) {
  // Phone number OR business-scoped user ID — Meta sends only the
  // latter for a sender who has adopted a WhatsApp username (#519).
  const identity = resolveInboundIdentity(message, contact);
  if (!hasUsableIdentity(identity)) {
    // Neither key present. Creating a row anyway would mean an
    // unreachable contact that can never be matched again, so drop the
    // delivery loudly instead of silently accumulating them.
    console.error(
      '[webhook] inbound message carries neither a phone number nor a BSUID; skipping:',
      message.id
    );
    return;
  }

  const thread = await withTransaction(
    (db) => resolveInboundThread(db, accountId, configOwnerUserId, identity),
    'worker'
  );
  const contactRecord = { id: thread.contactId };
  const conversation = { id: thread.conversationId };
  const contactOutcome = { wasCreated: thread.contactCreated };
  if (thread.conversationCreated)
    await dispatchWebhookEvent(
      getPool('worker'),
      accountId,
      'conversation.created',
      {
        conversation_id: conversation.id,
        contact_id: contactRecord.id,
      }
    );
  if (message.type === 'reaction') {
    if (message.reaction?.message_id)
      await withTransaction(
        (db) =>
          saveInboundReaction(
            db,
            accountId,
            conversation.id,
            contactRecord.id,
            message.reaction!.message_id,
            message.reaction!.emoji
          ),
        'worker'
      );
    return;
  }
  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(
      message,
      accessToken,
      mirrorMedia ? { accountId, userId: configOwnerUserId } : null
    );
  const allowed = new Set([
    'text',
    'image',
    'document',
    'audio',
    'video',
    'location',
    'template',
    'interactive',
  ]);
  const contentType = allowed.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : message.type === 'button'
        ? 'interactive'
        : 'text';
  const inserted = await withTransaction(
    (db) =>
      insertInboundMessage(db, accountId, conversation.id, {
        metaId: message.id,
        timestamp: new Date(Number(message.timestamp) * 1000).toISOString(),
        contentType,
        text: contentText,
        mediaUrl,
        mediaType,
        interactiveReplyId,
        replyMetaId: message.context?.id ?? null,
      }),
    'worker'
  );
  if (!inserted) return;
  const isFirstInboundMessage = inserted.firstInbound;

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: interactiveReplyId,
          reply_title: contentText ?? '',
          meta_message_id: message.id,
        }
      : {
          kind: 'text',
          text: contentText ?? message.text?.body ?? '',
          meta_message_id: message.id,
        },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  // Fire any automations that react to this webhook event. All dispatches
  // run here (not earlier) so the contact, conversation, and inbound
  // message all exist before any step — including send_message — runs.
  // Fire-and-forget: a slow or failing automation must not block the
  // webhook's 200 OK response to Meta.
  const inboundText = contentText ?? message.text?.body ?? '';
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    // Interactive tap → fire the interactive_reply trigger too (only
    // meaningful when a button/list reply actually arrived). Enables
    // automation-only chained menus; when a Flow owns the menu it will
    // have consumed the reply and this is skipped.
    if (interactiveReplyId) {
      automationTriggers.push('interactive_reply');
    }
  }
  // new_contact_created fires only when the webhook just auto-created the
  // contact row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time. We dispatch both
  // so users can pick whichever semantic they want; an automation that
  // listens to only one trigger runs only when that trigger matches.
  if (contactOutcome.wasCreated)
    automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage)
    automationTriggers.unshift('first_inbound_message');
  // Awaited — not fire-and-forget. We're inside the route's `after()`
  // block, which only keeps the function alive for promises it can see, so
  // a detached dispatch can be frozen part-way through: the log row is
  // inserted, then the steps never run. That is issue #301's failure mode
  // recurring one level down, and it's what issue #409 reported as runs
  // logging zero steps. `runAutomationsForTrigger` owns its own try/catch
  // and never throws; the `.catch` is belt-and-braces so one trigger
  // type's failure can't skip the rest of the loop.
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        // Only set on interactive taps; drives the interactive_reply
        // trigger's exact-id match.
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err));
  }

  // AI auto-reply. Runs only for plain-text inbound the deterministic
  // flow runner did NOT consume (flows win over the LLM), and only when
  // the account has enabled it. Awaited inside `after()` (same reason as
  // the webhook dispatch below); `dispatchInboundToAiReply` owns its
  // eligibility gates + try/catch and never throws.
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
      // Lets the bot show "typing…" (and mark the message read) while
      // the reply is generated.
      inboundMessageId: message.id,
    });
  }

  // message.received webhook (public API). Awaited — not fire-and-forget
  // — because we're inside the route's `after()` block, which only keeps
  // the function alive for promises it can see; a detached promise could
  // be frozen before it delivers. `dispatchWebhookEvent` early-exits
  // when the account has no matching endpoint and never throws.
  // (conversation.created is emitted earlier, right after the thread is
  // opened.)
  await dispatchWebhookEvent(getPool('worker'), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: message.id,
    content_type: contentType,
    text: contentText,
  });
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string,
  // Tenancy + opt-out for the media mirror. Null disables mirroring
  // entirely, which is what the account-level toggle does.
  mirror: { accountId: string; userId: string } | null
): Promise<{
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  /**
   * For interactive button / list replies: the stable id of the tapped
   * option (whatever we put on the button when sending). Used by the
   * Flows engine to advance the per-contact run; persisted to
   * `messages.interactive_reply_id` so the inbox bubble can render the
   * tap with the right affordance. Null for everything else.
   */
  interactiveReplyId: string | null;
}> {
  // getMediaUrl signature is (mediaId, accessToken) — earlier code had
  // the args swapped, so every verification hit an invalid Meta URL and
  // fell through to the catch block, leaving mediaUrl as null. That's
  // why images showed up as empty bubbles in the inbox.
  //
  // Beyond verifying, this is where inbound media gets COPIED into the
  // `chat-media` bucket (issue #466). Meta deletes media ~30 days after
  // receipt, so the `/api/whatsapp/media/<id>` proxy URL we used to
  // store is a pointer with an expiry date on it — every inbound
  // attachment silently became "Photo unavailable" a month later.
  // Mirroring stores a durable public URL instead.
  //
  // The mirror is strictly best-effort. `mirrorInboundMedia` swallows
  // its own failures and returns null, and we fall back to the proxy
  // URL — a webhook that throws would have Meta retry the delivery and
  // re-run everything downstream, which is a far worse outcome than an
  // attachment that expires.
  const verifyAndBuildUrl = async (
    mediaId: string,
    fileName?: string | null
  ): Promise<string | null> => {
    try {
      const info = await getMediaUrl({ mediaId, accessToken });

      if (mirror) {
        const mirrored = await mirrorInboundLocal({
          userId: mirror.userId,
          accountId: mirror.accountId,
          mediaId,
          downloadUrl: info.url,
          accessToken,
          mimeType: info.mimeType,
          fileSize: info.fileSize,
          fileName,
          messageTimestamp: message.timestamp,
        });
        if (mirrored) return mirrored;
      }

      return `/api/whatsapp/media/${mediaId}`;
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  };

  // Default shape — each case overrides only the fields it cares about.
  // Keeps the new `interactiveReplyId` field DRY across every return site.
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  };

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null };

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        };
      }
      return empty;

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        };
      }
      return empty;

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          // The sender's own filename becomes the mirrored object's
          // name, so saving the attachment yields `invoice.pdf` even
          // when a caption displaced the filename in content_text.
          mediaUrl: await verifyAndBuildUrl(
            message.document.id,
            message.document.filename
          ),
          mediaType: message.document.mime_type,
        };
      }
      return empty;

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        };
      }
      return empty;

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        };
      }
      return empty;

    case 'location':
      if (message.location) {
        const loc = message.location;
        const locationText = [
          loc.name,
          loc.address,
          `${loc.latitude},${loc.longitude}`,
        ]
          .filter(Boolean)
          .join(' - ');
        return { ...empty, contentText: locationText };
      }
      return empty;

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null };

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message
      // we previously sent. Meta delivers `interactive.button_reply` for
      // 3-button messages and `interactive.list_reply` for list messages.
      // Use the human-readable title as contentText so the inbox bubble
      // renders the tap legibly ("Existing customer"), and stash the
      // stable id separately so the Flows engine can route on it.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply;
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        };
      }
      return { ...empty, contentText: '[Interactive reply]' };
    }

    case 'button': {
      // Quick-reply tap on a TEMPLATE message. Meta delivers these under
      // their own `button` envelope rather than `interactive` above, so
      // without this case they fell through to `default` and landed in
      // the inbox as "[Unsupported message type: button]" with a null
      // interactiveReplyId — which also meant the Flows engine and the
      // `interactive_reply` automation trigger never saw the tap, so
      // nothing chained off a broadcast reply (issue #478).
      //
      // `payload` is the stable value (the analogue of
      // `button_reply.id`); `text` is the visible label. Prefer the
      // payload for routing and the label for display, each falling
      // back to the other since a template may carry only one.
      const payload = message.button?.payload || null;
      const label = message.button?.text || null;
      return {
        ...empty,
        contentText: label || payload,
        interactiveReplyId: payload || label,
      };
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      };
  }
}
