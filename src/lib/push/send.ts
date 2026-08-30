import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getVapidConfig } from './vapid';

export interface PushPayload {
  title: string;
  body?: string;
  /** In-app path to open on click, e.g. `/inbox?c=<id>`. */
  url?: string;
  /** Collapses repeat notifications for the same thing (we use the
   *  notification row id) so a phone shows one, not a stack. */
  tag?: string;
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const cfg = getVapidConfig();
  if (!cfg) return false;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  vapidReady = true;
  return true;
}

/** A push endpoint that returns one of these is permanently gone — the
 *  browser uninstalled, cleared data, or the subscription expired. */
const DEAD_STATUS = new Set([404, 410]);
const MAX_FAILURES = 5;

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number | null;
}

/**
 * Fan a payload out to every push subscription `userId` has (phone +
 * laptop + …). Prunes subscriptions the push service reports as gone,
 * and drops ones that have failed `MAX_FAILURES` times in a row. Never
 * throws — a push failure must not break whatever triggered it.
 *
 * Pass the service-role client for cross-user sends (the fanout route);
 * the RLS client works for "send to myself" (the test route).
 */
export async function sendPushToUser(
  db: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!ensureVapid()) return { sent: 0, pruned: 0 };

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('user_id', userId);

  if (error || !subs || subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  const bump: { id: string; next: number }[] = [];
  let sent = 0;

  await Promise.allSettled(
    (subs as SubRow[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60, urgency: 'high' },
        );
        sent += 1;
        if ((s.failure_count ?? 0) > 0) {
          await db
            .from('push_subscriptions')
            .update({ failure_count: 0, last_seen_at: new Date().toISOString() })
            .eq('id', s.id);
        }
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        const next = (s.failure_count ?? 0) + 1;
        if ((status && DEAD_STATUS.has(status)) || next >= MAX_FAILURES) {
          dead.push(s.id);
        } else {
          bump.push({ id: s.id, next });
        }
      }
    }),
  );

  if (dead.length > 0) {
    await db.from('push_subscriptions').delete().in('id', dead);
  }
  await Promise.allSettled(
    bump.map((b) =>
      db.from('push_subscriptions').update({ failure_count: b.next }).eq('id', b.id),
    ),
  );

  return { sent, pruned: dead.length };
}
