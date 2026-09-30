// ============================================================
// Keep each channel's Meta throughput tier current before a campaign
// sends: a STANDARD number sends 80 msg/s, a HIGH one 1 000 msg/s
// (channelMaxRate). Meta upgrades numbers on its own, so the level saved
// when the channel was connected can be out of date — read it from Meta
// right before sending and save it if it changed.
//
// Best-effort: one small Graph call per channel (3 s timeout, cached 10
// min per number); on any failure the saved level is used. Skipped when
// the Graph API is pointed at a local mock (META_GRAPH_BASE_URL).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';

// `throughput` needs a newer Graph version than the rest of meta-api.ts
// (same as getPhoneNumberDetails).
const GRAPH = 'https://graph.facebook.com/v23.0';
const TIMEOUT_MS = 3_000;
const CACHE_MS = 10 * 60_000;

const g = globalThis as unknown as {
  __wacrmThroughputChecked?: Map<string, number>;
};

async function fetchLevel(
  phoneNumberId: string,
  accessToken: string
): Promise<string | null> {
  if (!/^\d+$/.test(phoneNumberId)) return null;
  const res = await fetch(`${GRAPH}/${phoneNumberId}?fields=throughput`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { throughput?: { level?: string } };
  return body.throughput?.level ?? null;
}

/**
 * Refresh `whatsapp_config.throughput_level` for a campaign's channels.
 * Never throws.
 */
export async function refreshCampaignThroughput(
  db: SupabaseClient,
  accountId: string,
  channelIds: string[]
): Promise<void> {
  if (process.env.META_GRAPH_BASE_URL || !channelIds.length) return;
  try {
    const checked = (g.__wacrmThroughputChecked ??= new Map());
    const { data: rows } = await db
      .from('whatsapp_config')
      .select('id, phone_number_id, access_token, throughput_level')
      .eq('account_id', accountId)
      .in('id', channelIds);
    await Promise.all(
      (rows ?? []).map(async (row) => {
        const last = checked.get(row.id);
        if (last && Date.now() - last < CACHE_MS) return;
        checked.set(row.id, Date.now());
        try {
          const level = await fetchLevel(
            row.phone_number_id,
            decrypt(row.access_token)
          );
          if (level && level !== row.throughput_level) {
            await db
              .from('whatsapp_config')
              .update({ throughput_level: level })
              .eq('id', row.id);
            console.info(
              `[campaign] channel ${row.id}: Meta throughput ${row.throughput_level ?? 'unknown'} → ${level}`
            );
          }
        } catch {
          // Meta slow or unreachable: keep the saved level.
        }
      })
    );
  } catch (err) {
    console.warn(
      '[campaign] could not refresh throughput levels:',
      err instanceof Error ? err.message : err
    );
  }
}
