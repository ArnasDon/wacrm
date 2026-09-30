import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { CHANNEL_PUBLIC_COLUMNS } from '@/lib/whatsapp/channels';
import { inspectChannel } from '@/lib/whatsapp/channel-connect';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * A channel read from Meta more recently than this isn't asked again
 * (CHANNEL_SYNC_FRESH_SECONDS, default 120): pages sync on every
 * navigation, and this keeps that from turning into Meta traffic.
 */
const FRESH_MS =
  (Number(process.env.CHANNEL_SYNC_FRESH_SECONDS) > 0
    ? Number(process.env.CHANNEL_SYNC_FRESH_SECONDS)
    : 120) * 1000;
/** Channels read from Meta at once. */
const CONCURRENCY = 4;

const g = globalThis as unknown as {
  __wacrmChannelSync?: Map<string, Promise<SyncResult>>;
};

interface SyncResult {
  synced: number;
  skipped: number;
  failed: { id: string; error: string }[];
}

/**
 * POST /api/whatsapp/channels/sync   body: { force?: boolean }
 *
 * Re-reads every channel of the account from Meta — quality, messaging
 * tier, throughput, names, status — exactly like each row's refresh
 * button, so the Channels page is current without refreshing one by one.
 * Every page calls it in the background (ChannelAutoSync).
 *
 * Channels synced in the last 2 minutes are skipped (unless force), and
 * concurrent calls for one account share a single run, so reloading the
 * page doesn't hit Meta each time. Only Meta's own data is written, so
 * any member may trigger it. One channel failing (expired token…) is
 * reported and doesn't stop the others. Returns the refreshed list.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('viewer');
    const body = (await request.json().catch(() => null)) ?? {};
    const force = body.force === true;

    const runs = (g.__wacrmChannelSync ??= new Map());
    let run = runs.get(accountId);
    if (!run) {
      run = syncAccount(accountId, force).finally(() => runs.delete(accountId));
      runs.set(accountId, run);
    }
    const result = await run;

    const { data: channels } = await supabaseAdmin()
      .from('whatsapp_config')
      .select(CHANNEL_PUBLIC_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });
    return NextResponse.json({ ...result, channels: channels ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function syncAccount(
  accountId: string,
  force: boolean
): Promise<SyncResult> {
  const db = supabaseAdmin();
  const { data: rows } = await db
    .from('whatsapp_config')
    .select('id, phone_number_id, waba_id, access_token, meta_synced_at')
    .eq('account_id', accountId);

  const result: SyncResult = { synced: 0, skipped: 0, failed: [] };
  const due = (rows ?? []).filter((r) => {
    const fresh =
      !force &&
      r.meta_synced_at &&
      Date.now() - Date.parse(r.meta_synced_at) < FRESH_MS;
    if (fresh || !r.waba_id) result.skipped++;
    return !fresh && !!r.waba_id;
  });

  let next = 0;
  const lane = async () => {
    while (next < due.length) {
      const row = due[next++];
      try {
        const accessToken = decrypt(row.access_token);
        const inspected = await inspectChannel({
          wabaId: row.waba_id,
          phoneNumberId: row.phone_number_id,
          accessToken,
        });
        if ('response' in inspected) {
          const err = await inspected.response.json().catch(() => ({}));
          result.failed.push({ id: row.id, error: err?.error ?? 'Meta error' });
          continue;
        }
        const now = new Date().toISOString();
        const { error } = await db
          .from('whatsapp_config')
          .update({
            ...inspected.snapshot,
            meta_synced_at: now,
            updated_at: now,
          })
          .eq('id', row.id)
          .eq('account_id', accountId);
        if (error) result.failed.push({ id: row.id, error: 'Could not save' });
        else result.synced++;
      } catch (err) {
        result.failed.push({
          id: row.id,
          error: err instanceof Error ? err.message : 'Sync failed',
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, due.length) }, lane)
  );
  return result;
}
