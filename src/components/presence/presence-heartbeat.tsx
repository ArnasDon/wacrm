'use client';

import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  HEARTBEAT_MS,
  IDLE_AFTER_MS,
  type StoredPresence,
} from '@/lib/presence';

/**
 * PresenceHeartbeat — headless. Mount ONCE per signed-in dashboard tab
 * (in the dashboard shell, below the auth gate). Reports this tab's
 * presence to the `member_presence` table via the `touch_presence` RPC
 * roughly every HEARTBEAT_MS.
 *
 * The client only ever reports 'online' or 'away':
 *   - 'away'   when the tab is hidden, or no user input for IDLE_AFTER_MS
 *   - 'online' otherwise
 * It keeps heartbeating while away (so the row stays fresh, i.e. not
 * offline). When the tab closes the beats simply stop and viewers derive
 * 'offline' from staleness — no unreliable unload write needed.
 */
export function PresenceHeartbeat() {
  const { accountId } = useAuth();

  // 0 = "never recorded"; set on mount so we don't read the clock during
  // render (impure). Until the effect runs the tab counts as active.
  const lastActivityRef = useRef<number>(0);

  useEffect(() => {
    // Hold off until the account is known. Beating during the brief
    // window on a fresh signup — authed but profile/account row not yet
    // created — would make touch_presence raise "No account for caller"
    // and log a spurious error. The effect re-runs once accountId lands.
    if (!accountId) return;

    const supabase = createClient();
    let cancelled = false;
    let lastBeatAt = 0;
    lastActivityRef.current = Date.now();

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    const currentStatus = (): StoredPresence => {
      if (typeof document !== 'undefined' && document.hidden) return 'away';
      if (Date.now() - lastActivityRef.current > IDLE_AFTER_MS) return 'away';
      return 'online';
    };

    const beat = async () => {
      if (cancelled) return;
      // Coalesce bursts: a tab refocus fires visibilitychange AND focus
      // together, so skip a beat within 1s of the last to avoid two RPCs
      // in the same frame. The 30s interval is never affected.
      const t = Date.now();
      if (t - lastBeatAt < 1_000) return;
      lastBeatAt = t;
      const { error } = await supabase.rpc('touch_presence', {
        p_status: currentStatus(),
      });
      if (error && !cancelled) {
        // Non-fatal: presence is best-effort. Log once per failure so a
        // misconfigured RPC is visible without spamming.
        console.error(
          '[PresenceHeartbeat] touch_presence failed:',
          error.message
        );
      }
    };

    // Activity listeners. `passive` so we never block scroll/input.
    const activityEvents: (keyof DocumentEventMap)[] = [
      'mousemove',
      'keydown',
      'pointerdown',
      'scroll',
    ];
    activityEvents.forEach((e) =>
      document.addEventListener(e, markActive, { passive: true })
    );

    // Returning to the tab should beat immediately so a member flips
    // back to online without a 30s wait. The debounce in beat() absorbs
    // the visibilitychange + focus double-fire.
    const onReturn = () => {
      if (!document.hidden) markActive();
      void beat();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);

    void beat();
    const interval = setInterval(() => void beat(), HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      activityEvents.forEach((e) =>
        document.removeEventListener(e, markActive)
      );
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [accountId]);

  return null;
}
