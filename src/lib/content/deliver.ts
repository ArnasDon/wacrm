// ============================================================
// Content Studio post delivery — the content-backed sibling of
// `deliverBroadcast` (broadcast-core.ts). Sends free text/media
// (a Content Studio post, in the requested language's translation
// when one is set) instead of a Meta template, reusing everything
// else broadcasts already solved: the WhatsAppService abstraction
// (so this works identically in demo mode), the delivery-lock mutex
// (038), and `finalizeBroadcastStatus` (003/005's trigger-owned
// counts, still the source of truth here).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveWhatsAppService } from '@/lib/whatsapp/service';
import {
  simulateDemoDeliveryAndRead,
  simulateDemoBroadcastReaction,
  simulateDemoInboundMessage,
} from '@/lib/whatsapp/demo-simulate';
import {
  phoneVariants,
  sanitizePhoneForMeta,
  isValidE164,
} from '@/lib/whatsapp/phone-utils';
import { finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core';
import type { MediaKind } from '@/lib/whatsapp/meta-api';

interface DueContentBroadcast {
  id: string;
  account_id: string;
  content_id: string;
  language: string | null;
}

function mediaKindForContentType(contentType: string): MediaKind {
  if (contentType === 'video') return 'video';
  if (contentType === 'voice_note') return 'audio';
  // poster, image, product_post, campaign_post — all image-backed in
  // practice; text_post never reaches here (no media_url to send).
  return 'image';
}

/**
 * Send one due content-backed broadcast to every still-pending
 * recipient, then finalize the broadcast's and content's status.
 * Best-effort per recipient — one failure never aborts the rest
 * (same posture as `deliverBroadcast`).
 */
export async function deliverContentBroadcast(
  db: SupabaseClient,
  broadcast: DueContentBroadcast
): Promise<void> {
  const { data: content, error: contentErr } = await db
    .from('content')
    .select('id, body, media_url, content_type')
    .eq('id', broadcast.content_id)
    .maybeSingle();
  if (contentErr || !content) {
    console.error(
      `[content-deliver] content ${broadcast.content_id} missing for broadcast ${broadcast.id}:`,
      contentErr?.message
    );
    return;
  }

  // The requested language's translation, when one is set and exists —
  // falling back to the source body otherwise. Never overwrites either
  // row; purely a read-time choice of which text to send.
  let text: string | null = content.body;
  if (broadcast.language) {
    const { data: translation } = await db
      .from('content_translations')
      .select('body')
      .eq('content_id', broadcast.content_id)
      .eq('language', broadcast.language)
      .maybeSingle();
    if (translation?.body) text = translation.body;
  }

  const { service, isDemo } = await resolveWhatsAppService(
    db,
    broadcast.account_id
  );

  const { data: recipients, error: recError } = await db
    .from('broadcast_recipients')
    .select('id, contact_id, contact:contacts(phone)')
    .eq('broadcast_id', broadcast.id)
    .eq('status', 'pending');
  if (recError) {
    console.error(
      `[content-deliver] recipient load failed for ${broadcast.id}:`,
      recError.message
    );
    return;
  }

  interface RecipientRow {
    id: string;
    contact_id: string;
    contact: { phone?: string | null } | { phone?: string | null }[] | null;
  }

  for (const row of (recipients ?? []) as RecipientRow[]) {
    const c = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    const sanitized = sanitizePhoneForMeta(c?.phone ?? '');

    if (!isValidE164(sanitized)) {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: 'No valid phone number on contact',
        })
        .eq('id', row.id);
      continue;
    }

    let sentMessageId: string | null = null;
    let errorMessage: string | null = null;
    try {
      const toVariants = phoneVariants(sanitized);
      const result = content.media_url
        ? await service.sendMedia({
            toVariants,
            kind: mediaKindForContentType(content.content_type),
            link: content.media_url,
            caption: text ?? undefined,
          })
        : await service.sendText({ toVariants, text: text ?? '' });
      sentMessageId = result.messageId;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
    }

    if (sentMessageId) {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', row.id);
      if (isDemo) {
        await simulateDemoDeliveryAndRead(sentMessageId);
        // Bounded probabilities — not every recipient reacts or
        // replies, so a demo campaign doesn't look unrealistically
        // uniform. Independent chances, both deliberately modest.
        if (Math.random() < 0.3) {
          await simulateDemoBroadcastReaction(
            broadcast.account_id,
            broadcast.id,
            row.contact_id
          );
        }
        if (Math.random() < 0.15) {
          await simulateDemoInboundMessage(
            broadcast.account_id,
            row.contact_id
          );
        }
      }
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: errorMessage || 'Unknown error',
        })
        .eq('id', row.id);
    }
  }

  await finalizeBroadcastStatus(db, broadcast.id);

  // Reflect the outcome onto the source content item. A piece of
  // content can have more than one scheduled broadcast (e.g. one per
  // language) — only flip it to a terminal state once none are left
  // pending, so a still-scheduled Urdu post doesn't get overwritten to
  // "Published" the moment the English one sends.
  const { count: stillScheduled } = await db
    .from('broadcasts')
    .select('id', { count: 'exact', head: true })
    .eq('content_id', broadcast.content_id)
    .eq('status', 'scheduled');

  if (!stillScheduled) {
    const { data: finalBroadcast } = await db
      .from('broadcasts')
      .select('status')
      .eq('id', broadcast.id)
      .maybeSingle();
    await db
      .from('content')
      .update({
        status: finalBroadcast?.status === 'failed' ? 'Failed' : 'Published',
      })
      .eq('id', broadcast.content_id);
  }
}
