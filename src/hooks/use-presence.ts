'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  derivePresence,
  type PresenceRow,
  type StoredPresence,
} from '@/lib/presence';
import { useLocalPolling } from './use-local-polling';
export function usePresence(enabled = true) {
  const data = useLocalPolling<{
    presence: {
      user_id: string;
      status: StoredPresence;
      last_seen_at: string;
    }[];
  }>('/api/presence', enabled, 10000);
  const rows = useMemo(
    () =>
      new Map(
        (data?.presence ?? []).map((row) => [
          row.user_id,
          { status: row.status, last_seen_at: row.last_seen_at },
        ])
      ),
    [data]
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, [enabled]);
  const getRow = useCallback(
    (userId: string): PresenceRow | undefined => rows.get(userId),
    [rows]
  );
  const getPresence = useCallback(
    (userId: string) => {
      const row = rows.get(userId);
      return derivePresence(row?.status, row?.last_seen_at, now);
    },
    [rows, now]
  );
  return { getRow, getPresence, now };
}
