// Background WhatsApp channel sync, browser side.
//
// Every page change (ChannelAutoSync in the dashboard shell) and the
// Channels page ask for a sync; this module turns those into at most one
// POST /api/whatsapp/channels/sync per MIN_INTERVAL_MS per tab, one at a
// time, and shares the result: anything showing channels subscribes and
// updates when fresh data arrives. The server skips channels read from
// Meta in the last couple of minutes, so browsing never floods Meta.
// "Sync now" passes force: true and always goes through.

import type { Channel } from '@/components/whatsapp/channel-types';

export interface ChannelSyncState {
  syncing: boolean;
  /** ms epoch of the last completed sync in this tab. */
  lastSync: number | null;
  channels: Channel[] | null;
  failed: { id: string; error: string }[];
  error: string | null;
}

const MIN_INTERVAL_MS = 30_000;

let state: ChannelSyncState = {
  syncing: false,
  lastSync: null,
  channels: null,
  failed: [],
  error: null,
};
let inFlight: Promise<ChannelSyncState> | null = null;
let lastRequest = 0;
const listeners = new Set<() => void>();

function set(next: Partial<ChannelSyncState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function getChannelSyncState(): ChannelSyncState {
  return state;
}

export function subscribeChannelSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Sync all channels with Meta in the background. Throttled per tab
 * unless `force`; never throws.
 */
export function requestChannelSync(
  opts: { force?: boolean } = {}
): Promise<ChannelSyncState> {
  if (inFlight) return inFlight;
  if (!opts.force && Date.now() - lastRequest < MIN_INTERVAL_MS)
    return Promise.resolve(state);
  lastRequest = Date.now();
  set({ syncing: true, error: null });
  inFlight = (async () => {
    try {
      const res = await fetch('/api/whatsapp/channels/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: !!opts.force }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        set({
          syncing: false,
          lastSync: Date.now(),
          channels: (body.channels ?? []) as Channel[],
          failed: body.failed ?? [],
        });
      } else {
        set({
          syncing: false,
          error:
            (body && typeof body.error === 'string' && body.error) ||
            `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      set({
        syncing: false,
        error: err instanceof Error ? err.message : 'Sync failed',
      });
    }
    return state;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
