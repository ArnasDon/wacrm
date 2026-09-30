// ============================================================
// Kafka consumers — the worker side of the three flows.
//
//   webhook.events   group "<prefix>webhook-processors"
//                    processWebhook() per payload; 3 tries with backoff,
//                    then the payload goes to webhook.events.dlq and the
//                    partition moves on (no poison-message stall).
//   campaign.sends   group "<prefix>campaign-senders"
//                    handleCampaignSend() per recipient. Partitions run in
//                    parallel; inside one (one channel) messages are sent
//                    a few at a time, paced to the campaign's speed.
//   template.status  a group PER PROCESS, so every process hears every
//                    change and drops paused templates at once.
//
// Started in-process by instrumentation.ts, or standalone with
// `npm run worker:kafka` (src/workers/kafka-worker.ts).
// ============================================================

import { hostname } from 'node:os';
import type { Consumer, EachBatchPayload } from 'kafkajs';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { kafkaSettings, topics } from './config';
import { ensureTopics, getKafka } from './client';
import {
  publishWebhookDeadLetter,
  type CampaignSendMessage,
  type TemplateStatusEvent,
  webhookOrderingKey,
} from './producers';

/**
 * Messages handed to the sender at once per partition. Big enough to keep
 * a 1 000 msg/s channel's in-flight window full, small enough to commit
 * offsets (and heartbeat) every second or two.
 */
const SEND_CHUNK = 500;
/**
 * Chunks sent at the same time per partition. The next chunk starts while
 * the previous one's slowest requests finish, so a channel never idles at
 * chunk boundaries. Offsets are still committed in order.
 */
const CHUNKS_IN_FLIGHT = 3;
/** How long a batch waits for its last sends before fetching the next. */
const TAIL_WAIT_MS = 250;

/**
 * kafkajs restarts a crashed consumer only for "retriable" errors by
 * default; always restart instead — a worker that silently stops
 * consuming is worse than one that retries.
 */
const RESTART_ALWAYS = {
  retries: 10,
  restartOnFailure: async (err: Error) => {
    console.error('[kafka] consumer crashed, restarting:', err.message);
    return true;
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Webhooks taken from a batch at a time, and contacts handled at once. */
const WEBHOOK_CHUNK = 200;
const WEBHOOK_CONCURRENCY = 20;

/** Run `fn` over `items`, at most `limit` at a time. */
async function runLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) await fn(items[next++]);
    }
  );
  await Promise.all(lanes);
}

/**
 * Longest one webhook may take. Messages on a partition are handled in
 * order, so a single webhook that never finishes (a request with no
 * reply) would otherwise hold up every webhook behind it — delivery
 * statuses, replies, template updates — indefinitely.
 */
const WEBHOOK_TIMEOUT_MS = 60_000;

class WebhookTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new WebhookTimeout(`timed out after ${ms / 1000} s`)),
      ms
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export interface WorkerHandle {
  stop: () => Promise<void>;
}

const g = globalThis as unknown as {
  __wacrmKafkaWorkers?: Promise<WorkerHandle>;
};

export interface WorkerOptions {
  webhooks?: boolean;
  campaigns?: boolean;
  templateStatus?: boolean;
}

/** Start the consumers once per process. */
export function startKafkaWorkers(
  opts: WorkerOptions = {}
): Promise<WorkerHandle> {
  g.__wacrmKafkaWorkers ??= start({
    webhooks: true,
    campaigns: true,
    templateStatus: true,
    ...opts,
  }).catch((err) => {
    g.__wacrmKafkaWorkers = undefined;
    throw err;
  });
  return g.__wacrmKafkaWorkers;
}

async function start(opts: Required<WorkerOptions>): Promise<WorkerHandle> {
  const settings = kafkaSettings();
  if (!settings) throw new Error('Kafka is not configured (KAFKA_BROKERS)');
  await ensureTopics();
  const kafka = await getKafka();
  const t = topics(settings.topicPrefix);
  const consumers: Consumer[] = [];

  if (opts.webhooks) {
    const { processWebhook } = await import('@/lib/whatsapp/webhook-processor');
    const consumer = kafka.consumer({
      groupId: `${settings.topicPrefix}webhook-processors`,
      retry: RESTART_ALWAYS,
    });
    await consumer.connect();
    await consumer.subscribe({ topic: t.webhookEvents, fromBeginning: false });
    // One webhook, with retries; never throws. A webhook that times out
    // may have partly run, so it isn't retried — it's parked in the DLQ.
    const handleOne = async (raw: string) => {
      let lastError = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { body } = JSON.parse(raw) as {
            body: Parameters<typeof processWebhook>[0];
          };
          await withTimeout(processWebhook(body), WEBHOOK_TIMEOUT_MS);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (
            lastError.startsWith('Unexpected token') ||
            lastError.includes('JSON') ||
            err instanceof WebhookTimeout
          )
            break;
          await sleep(500 * attempt);
        }
      }
      console.error('[kafka] webhook event failed, sent to DLQ:', lastError);
      await withTimeout(publishWebhookDeadLetter(raw, lastError), 10_000).catch(
        (err) =>
          console.error(
            '[kafka] could not write to the DLQ:',
            err instanceof Error ? err.message : err
          )
      );
    };

    await consumer.run({
      partitionsConsumedConcurrently: Math.min(settings.partitions, 6),
      eachBatchAutoResolve: false,
      // Batches, not one message at a time: webhooks for different
      // contacts run in parallel (WEBHOOK_CONCURRENCY), each contact's in
      // order. Offsets are resolved per chunk once all of it is done, and
      // a rebalance (isStale) stops the batch cleanly — the unfinished
      // part is redelivered to the new owner.
      eachBatch: async ({
        batch,
        resolveOffset,
        heartbeat,
        isRunning,
        isStale,
      }: EachBatchPayload) => {
        // Keep the session alive while a slow chunk runs.
        const beat = setInterval(() => void heartbeat().catch(() => {}), 3_000);
        try {
          const msgs = batch.messages;
          for (let i = 0; i < msgs.length; i += WEBHOOK_CHUNK) {
            if (!isRunning() || isStale()) return;
            const chunk = msgs.slice(i, i + WEBHOOK_CHUNK);
            const byContact = new Map<string, string[]>();
            for (const m of chunk) {
              const raw = m.value?.toString() ?? '';
              let key = m.key?.toString() ?? '';
              try {
                key = webhookOrderingKey(JSON.parse(raw).body);
              } catch {
                // malformed: handled (and DLQ'd) by handleOne
              }
              const list = byContact.get(key) ?? [];
              list.push(raw);
              byContact.set(key, list);
            }
            await runLimited(
              [...byContact.values()],
              WEBHOOK_CONCURRENCY,
              async (list) => {
                for (const raw of list) await handleOne(raw);
              }
            );
            if (!isRunning() || isStale()) return;
            resolveOffset(chunk[chunk.length - 1].offset);
            await heartbeat().catch(() => {});
          }
        } finally {
          clearInterval(beat);
        }
      },
    });
    consumers.push(consumer);
  }

  if (opts.templateStatus) {
    const { emitTemplateStatusLocal } =
      await import('@/lib/campaigns/template-status-bus');
    const consumer = kafka.consumer({
      groupId: `${settings.topicPrefix}template-status-${hostname()}-${process.pid}`,
      retry: RESTART_ALWAYS,
    });
    await consumer.connect();
    await consumer.subscribe({ topic: t.templateStatus, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          emitTemplateStatusLocal(
            JSON.parse(message.value?.toString() ?? '') as TemplateStatusEvent
          );
        } catch {
          // malformed event — nothing to do
        }
      },
    });
    consumers.push(consumer);
  }

  if (opts.campaigns) {
    const { handleCampaignSendBatch } =
      await import('@/lib/campaigns/kafka-sender');
    const db = supabaseAdmin();
    const consumer = kafka.consumer({
      groupId: `${settings.topicPrefix}campaign-senders`,
      // Sends are paced, so a chunk can take a few seconds.
      sessionTimeout: 60_000,
      heartbeatInterval: 5_000,
      // Enough per fetch to keep a 1 000 msg/s channel busy.
      maxBytesPerPartition: 4 * 1024 * 1024,
      retry: RESTART_ALWAYS,
    });
    await consumer.connect();
    await consumer.subscribe({ topic: t.campaignSends, fromBeginning: false });
    await consumer.run({
      partitionsConsumedConcurrently: settings.partitions,
      eachBatchAutoResolve: false,
      eachBatch: async ({
        batch,
        resolveOffset,
        heartbeat,
        isRunning,
        isStale,
      }: EachBatchPayload) => {
        const messages = batch.messages;
        const sendChunk = async (chunk: typeof messages) => {
          const parsed: CampaignSendMessage[] = [];
          for (const m of chunk) {
            try {
              parsed.push(
                JSON.parse(m.value?.toString() ?? '') as CampaignSendMessage
              );
            } catch {
              // malformed — skip it
            }
          }
          // The chunk is sent concurrently (each channel's sender paces
          // and bounds it). Infrastructure errors retry here rather than
          // crash the consumer; claims keep retries from double-sending.
          for (let attempt = 1; parsed.length; attempt++) {
            try {
              await handleCampaignSendBatch(db, parsed);
              break;
            } catch (err) {
              console.error(
                '[kafka] campaign batch error:',
                err instanceof Error ? err.message : err
              );
              if (attempt >= 5) break; // stays pending; re-dispatch recovers it
              await sleep(1000 * attempt);
              await heartbeat();
            }
          }
        };

        // Up to CHUNKS_IN_FLIGHT chunks at once; offsets resolve in order,
        // each only after its chunk (and every one before it) is done.
        const window: { last: string; done: Promise<void> }[] = [];
        const settleOldest = async () => {
          const oldest = window.shift()!;
          await oldest.done;
          if (isRunning() && !isStale()) resolveOffset(oldest.last);
          await heartbeat().catch(() => {});
        };
        for (let i = 0; i < messages.length; i += SEND_CHUNK) {
          if (!isRunning() || isStale()) break;
          const chunk = messages.slice(i, i + SEND_CHUNK);
          window.push({
            last: chunk[chunk.length - 1].offset,
            done: sendChunk(chunk),
          });
          if (window.length >= CHUNKS_IN_FLIGHT) await settleOldest();
        }
        // Don't hold the partition for the batch's slowest sends (a Meta
        // retry can back off for seconds): messages published after this
        // fetch would wait behind them and the channel would sit idle.
        // Chunks still sending after TAIL_WAIT_MS are left unresolved; the
        // next fetch returns them again and their claims (claimed_at) make
        // them skip, while the original sends finish and write results.
        const tailUntil = Date.now() + TAIL_WAIT_MS;
        while (window.length) {
          const left = tailUntil - Date.now();
          if (left <= 0) break;
          const finished = await Promise.race([
            window[0].done.then(() => true),
            sleep(left).then(() => false),
          ]);
          if (!finished) break;
          await settleOldest();
        }
      },
    });
    consumers.push(consumer);
  }

  console.info(
    `[kafka] workers running: ${[
      opts.webhooks && 'webhooks',
      opts.campaigns && 'campaigns',
      opts.templateStatus && 'template-status',
    ]
      .filter(Boolean)
      .join(', ')}`
  );

  return {
    stop: async () => {
      await Promise.allSettled(consumers.map((c) => c.disconnect()));
      g.__wacrmKafkaWorkers = undefined;
    },
  };
}
