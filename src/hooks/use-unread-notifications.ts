'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry.
 *
 * RLS on `notifications` already scopes every read to `auth.uid() =
 * user_id`, so no explicit filter is needed here — same pattern as
 * `useTotalUnread` for conversations.
 */
export function useUnreadNotifications(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      // head:true skips fetching rows — we only need the `count`
      // supabase-js returns alongside the (empty) response body.
      const { count: unreadCount, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .is('read_at', null);
      if (cancelled || error) return;
      setCount(unreadCount ?? 0);
    })();

    const channel = supabase
      .channel('notifications-unread-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Notification;
            if (!row.read_at) setCount((n) => n + 1);
          } else if (payload.eventType === 'UPDATE') {
            // Updates here only ever set read_at (marking a notification
            // read). Derive purely from the new row so we don't rely on
            // payload.old columns, which require REPLICA IDENTITY FULL.
            const newRow = payload.new as Notification;
            if (newRow.read_at) setCount((n) => Math.max(0, n - 1));
          } else if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Notification>;
            if (!oldRow.read_at) setCount((n) => Math.max(0, n - 1));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
