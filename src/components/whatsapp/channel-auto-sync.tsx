'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { requestChannelSync } from '@/lib/whatsapp/channel-sync-client';

/**
 * ChannelAutoSync — headless. Mounted once in the dashboard shell: on
 * every page change, and when the tab comes back into view, it syncs all
 * WhatsApp channels with Meta in the background (quality, messaging
 * tier, throughput, status, names, phone number…). Throttled per tab and
 * on the server, so navigating around costs nothing extra.
 */
export function ChannelAutoSync() {
  const { accountId } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (!accountId) return;
    void requestChannelSync();
  }, [accountId, pathname]);

  useEffect(() => {
    if (!accountId) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void requestChannelSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [accountId]);

  return null;
}
