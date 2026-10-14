'use client';
import { useEffect, useState } from 'react';
import { useAuth } from './use-auth';
import { startPolling } from '@/lib/api/polling';
export function useLocalPolling<T>(
  path: string,
  enabled = true,
  interval = 10000
) {
  const { accountId, user } = useAuth();
  const key = `${user?.id ?? ''}:${accountId ?? ''}:${path}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data: T } | null>(
    null
  );
  useEffect(() => {
    if (!enabled || !accountId) return;
    const polling = startPolling(
      async (signal) => {
        const response = await fetch(path, { cache: 'no-store', signal });
        if (!response.ok) throw new Error('Unable to refresh.');
        return (await response.json()) as T;
      },
      (data) => setSnapshot({ key, data }),
      () => {},
      interval,
      () => !document.hidden
    );
    const onFocus = () => polling.refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      polling.stop();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [path, enabled, interval, accountId, key]);
  return enabled && snapshot?.key === key ? snapshot.data : null;
}
