// ============================================================
// Campaign messages in the inbox.
//
// A campaign message is a real message in the customer's WhatsApp chat,
// so it belongs in the inbox thread — otherwise a reply to it arrives
// out of context (nothing before it, a swipe-reply quoting nothing).
//
// Two paths, both cheap enough for 1 000 msg/s and both best-effort
// (a failure here never blocks or slows sending):
//
//   * Eager — CampaignInboxLogger: after sends, batch-insert the message
//     into conversations that ALREADY exist for (contact, number). New
//     conversations are not created here: a 20 000-recipient campaign
//     would otherwise add 20 000 threads to every open inbox.
//   * Lazy — backfillCampaignMessages: when a customer writes in, the
//     campaign messages we sent them from that number (last 30 days) are
//     put into the thread first, at their send time, so the reply sits
//     right under the message it answers.
//
// Both upsert on (conversation_id, message_id), so neither path can
// duplicate a message, and delivery/read webhooks then update it like
// any other outbound message.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { renderTemplateBody } from '@/lib/whatsapp/template-body';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';
import { resolveSendParams, type AdvancedCampaignConfig } from './advanced';

const CHUNK = 300;
const FLUSH_MS = 1_000;
const MAX_BUFFER = 5_000;
const BACKFILL_DAYS = 30;

/** What the customer saw: the template body with its values filled in. */
export function campaignMessageText(
  template: MessageTemplate,
  params: SendTimeParams
): string {
  const body = renderTemplateBody(template.body_text ?? '', params.body ?? []);
  const header =
    template.header_type === 'text'
      ? (params.headerText ?? template.header_content ?? '')
      : '';
  return header ? `${header}\n\n${body}` : body;
}

export interface CampaignInboxEntry {
  accountId: string;
  contactId: string;
  channelId: string;
  wamid: string;
  text: string;
  templateName: string;
  sentAt: string;
}

export class CampaignInboxLogger {
  private buffer: CampaignInboxEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(private readonly db: SupabaseClient) {}

  record(entry: CampaignInboxEntry): void {
    this.buffer.push(entry);
    // Bounded: if the database lags far behind, drop the oldest — the
    // reply-time backfill still puts them in the thread.
    if (this.buffer.length > MAX_BUFFER)
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.flushing) await this.flushing;
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0);
    this.flushing = this.write(batch)
      .catch((err) =>
        console.error(
          '[campaign-inbox] could not add campaign messages to the inbox:',
          err instanceof Error ? err.message : err
        )
      )
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
  }

  private async write(batch: CampaignInboxEntry[]): Promise<void> {
    const byChannel = new Map<string, CampaignInboxEntry[]>();
    for (const e of batch) {
      const list = byChannel.get(e.channelId) ?? [];
      list.push(e);
      byChannel.set(e.channelId, list);
    }
    for (const [channelId, entries] of byChannel) {
      for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = entries.slice(i, i + CHUNK);
        const { data: convs, error } = await this.db
          .from('conversations')
          .select('id, contact_id')
          .eq('account_id', chunk[0].accountId)
          .eq('whatsapp_config_id', channelId)
          .in('contact_id', [...new Set(chunk.map((e) => e.contactId))]);
        if (error) throw new Error(error.message);
        const convByContact = new Map(
          (convs ?? []).map((c) => [c.contact_id as string, c.id as string])
        );
        const rows = chunk
          .filter((e) => convByContact.has(e.contactId))
          .map((e) =>
            messageRow(
              convByContact.get(e.contactId)!,
              e.wamid,
              e.text,
              e.templateName,
              e.sentAt,
              'sent'
            )
          );
        if (!rows.length) continue;
        const { error: insErr } = await this.db
          .from('messages')
          .upsert(rows, {
            onConflict: 'conversation_id,message_id',
            ignoreDuplicates: true,
          });
        if (insErr) throw new Error(insErr.message);
        // Thread previews: newest campaign message per conversation.
        const latest = new Map<string, { text: string; at: string }>();
        for (const r of rows)
          latest.set(r.conversation_id, {
            text: r.content_text,
            at: r.created_at,
          });
        const updates = [...latest.entries()];
        for (let j = 0; j < updates.length; j += 20) {
          await Promise.all(
            updates.slice(j, j + 20).map(([id, v]) =>
              this.db
                .from('conversations')
                .update({
                  last_message_text: v.text,
                  last_message_at: v.at,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', id)
                // Only move the preview forward in time.
                .or(`last_message_at.is.null,last_message_at.lt.${v.at}`)
            )
          );
        }
      }
    }
  }
}

function messageRow(
  conversationId: string,
  wamid: string,
  text: string,
  templateName: string,
  at: string,
  status: 'sent' | 'delivered' | 'read' | 'failed'
) {
  return {
    conversation_id: conversationId,
    sender_type: 'bot' as const,
    content_type: 'template' as const,
    content_text: text,
    template_name: templateName,
    message_id: wamid,
    status,
    created_at: at,
  };
}

const RECIPIENT_TO_MESSAGE_STATUS: Record<
  string,
  'sent' | 'delivered' | 'read'
> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  replied: 'read',
};

/**
 * Before an inbound message is stored: put the campaign messages this
 * contact received from this number (last 30 days) into the thread, at
 * their send time. Best-effort — never throws.
 */
export async function backfillCampaignMessages(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    conversationId: string;
    channelId: string | null;
  }
): Promise<number> {
  try {
    if (!args.channelId) return 0;
    const since = new Date(
      Date.now() - BACKFILL_DAYS * 86_400_000
    ).toISOString();
    const { data: recs } = await db
      .from('broadcast_recipients')
      .select(
        'broadcast_id, status, sent_at, whatsapp_message_id, template_name, template_language, row_data, broadcasts!inner(account_id, config)'
      )
      .eq('contact_id', args.contactId)
      .eq('whatsapp_config_id', args.channelId)
      .eq('broadcasts.account_id', args.accountId)
      .not('whatsapp_message_id', 'is', null)
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(5);
    if (!recs?.length) return 0;

    const wamids = recs.map((r) => r.whatsapp_message_id as string);
    const { data: have } = await db
      .from('messages')
      .select('message_id')
      .eq('conversation_id', args.conversationId)
      .in('message_id', wamids);
    const present = new Set((have ?? []).map((m) => m.message_id as string));
    const missing = recs.filter(
      (r) => !present.has(r.whatsapp_message_id as string)
    );
    if (!missing.length) return 0;

    const names = [
      ...new Set(missing.map((r) => r.template_name).filter(Boolean)),
    ] as string[];
    const { data: templates } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', args.accountId)
      .in('name', names.length ? names : ['—']);

    const rows = missing.map((r) => {
      const template = (templates ?? []).find(
        (t) =>
          t.name === r.template_name &&
          (t.language ?? 'en_US') === (r.template_language ?? t.language)
      ) as MessageTemplate | undefined;
      const bc = (
        Array.isArray(r.broadcasts) ? r.broadcasts[0] : r.broadcasts
      ) as { config?: AdvancedCampaignConfig } | null;
      const key = `${r.template_name}:${r.template_language ?? template?.language ?? 'en_US'}`;
      let text = r.template_name ? `[${r.template_name}]` : '';
      if (template) {
        try {
          const params = resolveSendParams(
            template,
            bc?.config?.mappings?.[key],
            (r.row_data ?? {}) as Record<string, string>
          );
          text = campaignMessageText(template, params);
        } catch {
          text = template.body_text ?? text;
        }
      }
      return messageRow(
        args.conversationId,
        r.whatsapp_message_id as string,
        text,
        r.template_name ?? '',
        r.sent_at as string,
        RECIPIENT_TO_MESSAGE_STATUS[r.status as string] ?? 'sent'
      );
    });
    const { error } = await db
      .from('messages')
      .upsert(rows, {
        onConflict: 'conversation_id,message_id',
        ignoreDuplicates: true,
      });
    if (error) {
      console.error('[campaign-inbox] backfill failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.error(
      '[campaign-inbox] backfill failed:',
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}
