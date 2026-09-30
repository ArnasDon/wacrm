// Publishing side of the three Kafka flows. Every publisher returns
// false (never throws) when Kafka is off or unreachable, so callers can
// fall back to the in-process path and nothing is lost.

import { kafkaEnabled, topics } from './config';
import { getProducer } from './client';

/** One recipient of a campaign, routed to a channel (the message key). */
export interface CampaignSendMessage {
  v: 1;
  broadcastId: string;
  recipientId: string;
  channelId: string;
  /** Re-routes so far (template ran out / channel stopped / throttled). */
  attempt: number;
}

/** A template's status changed at Meta (paused, disabled, approved…). */
export interface TemplateStatusEvent {
  v: 1;
  wabaId: string | null;
  templateId: string | null;
  name: string | null;
  language: string | null;
  /** Meta's event: APPROVED, PAUSED, DISABLED, REJECTED, … */
  event: string;
  reason: string | null;
  at: string;
}

async function send(
  topic: string,
  messages: { key: string; value: string }[]
): Promise<boolean> {
  if (!kafkaEnabled() || messages.length === 0) return false;
  try {
    const producer = await getProducer();
    await producer.send({ topic, acks: -1, messages });
    return true;
  } catch (err) {
    console.error(
      `[kafka] publish to ${topic} failed:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Ordering key for a Meta webhook: the number plus the contact it's
 * about. Events for one contact stay in order (one partition, handled in
 * sequence); different contacts spread over all partitions and are
 * handled in parallel. Keying by the number alone put every status of a
 * campaign on one partition, processed one at a time.
 */
export function webhookOrderingKey(body: unknown): string {
  const entry = (
    body as {
      entry?: {
        id?: string;
        changes?: {
          value?: {
            metadata?: { phone_number_id?: string };
            statuses?: { recipient_id?: string }[];
            messages?: { from?: string }[];
          };
        }[];
      }[];
    }
  )?.entry?.[0];
  const value = entry?.changes?.[0]?.value;
  const number = value?.metadata?.phone_number_id ?? entry?.id ?? 'unknown';
  const contact =
    value?.statuses?.[0]?.recipient_id ?? value?.messages?.[0]?.from;
  return contact ? `${number}:${contact}` : number;
}

/** A verified Meta webhook payload (see webhookOrderingKey). */
export function publishWebhookEvent(body: unknown): Promise<boolean> {
  return send(topics().webhookEvents, [
    {
      key: webhookOrderingKey(body),
      value: JSON.stringify({
        v: 1,
        receivedAt: new Date().toISOString(),
        body,
      }),
    },
  ]);
}

/** Campaign recipients, keyed by channel: one partition paces one channel. */
export async function publishCampaignSends(
  messages: CampaignSendMessage[]
): Promise<boolean> {
  const topic = topics().campaignSends;
  for (let i = 0; i < messages.length; i += 500) {
    const ok = await send(
      topic,
      messages
        .slice(i, i + 500)
        .map((m) => ({ key: m.channelId, value: JSON.stringify(m) }))
    );
    if (!ok) return false;
  }
  return true;
}

export function publishTemplateStatus(
  event: TemplateStatusEvent
): Promise<boolean> {
  return send(topics().templateStatus, [
    {
      key:
        event.templateId ?? `${event.wabaId}:${event.name}:${event.language}`,
      value: JSON.stringify(event),
    },
  ]);
}

/** Failed webhook payloads, for inspection / replay. */
export function publishWebhookDeadLetter(
  raw: string,
  error: string
): Promise<boolean> {
  return send(topics().webhookDeadLetter, [
    {
      key: 'dlq',
      value: JSON.stringify({ error, raw, at: new Date().toISOString() }),
    },
  ]);
}
