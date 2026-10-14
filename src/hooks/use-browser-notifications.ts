'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRealtime } from './use-realtime';
import type { Message } from '@/types';
import {
  DEFAULT_NOTIFICATION_LABELS,
  buildNotificationContent,
  conversationHref,
  getNotificationPermission,
  pickContactDisplayName,
  readBrowserNotifyPref,
  shouldNotifyForMessage,
  subscribeBrowserNotifyPref,
  viewedConversationFromLocation,
  type NotificationLabels,
} from '@/lib/notifications/browser-notify';

const serverSnapshot = () => false;

/**
 * The device-scoped "browser notifications" opt-in, kept in sync with
 * localStorage across this tab (settings toggle) and other tabs.
 */
export function useBrowserNotifyPref(): boolean {
  return useSyncExternalStore(
    subscribeBrowserNotifyPref,
    readBrowserNotifyPref,
    serverSnapshot
  );
}

/**
 * Desktop notifications for new inbound customer messages. Mount ONCE
 * per signed-in dashboard tab (the dashboard shell does this via
 * <BrowserNotificationsListener />) so alerts fire on any page.
 *
 * Polls the local inbox API, ignoring the first snapshot so an existing
 * backlog does not produce alerts.
 *
 * Fires only while a dashboard tab is open — there is no service worker
 * or Web Push here, so a closed browser stays quiet.
 */
export function useBrowserNotifications(): void {
  const enabled = useBrowserNotifyPref();
  const router = useRouter();
  const t = useTranslations('Settings.browserNotifications.labels');

  // Translated labels, read inside the async Realtime callback. Kept in
  // a ref (assigned in an effect, not during render) so a locale change
  // doesn't tear down and re-open the channel.
  const labelsRef = useRef<NotificationLabels>(DEFAULT_NOTIFICATION_LABELS);
  useEffect(() => {
    labelsRef.current = {
      fallbackTitle: t('fallbackTitle'),
      image: t('image'),
      audio: t('audio'),
      video: t('video'),
      document: t('document'),
      location: t('location'),
      template: t('template'),
    };
  });

  // Message ids already handled, for replay dedupe. Survives re-renders,
  // pruned by shouldNotifyForMessage.
  const seenRef = useRef<Map<string, number>>(new Map());
  const notifyRef = useRef<((msg: Message) => Promise<void>) | null>(null);
  useRealtime({
    channelName: 'browser-notifications',
    enabled,
    pollWhenHidden: true,
    onMessageEvent: (event) => {
      if (
        event.eventType !== 'INSERT' ||
        getNotificationPermission() !== 'granted'
      )
        return;
      const msg = event.new;
      if (
        shouldNotifyForMessage(msg, {
          documentVisible: document.visibilityState === 'visible',
          viewingConversationId: viewedConversationFromLocation(
            window.location.pathname,
            window.location.search
          ),
          seen: seenRef.current,
        })
      )
        void notifyRef.current?.(msg);
    },
  });

  useEffect(() => {
    if (!enabled) return;
    if (getNotificationPermission() === 'unsupported') return;

    let cancelled = false;

    const notify = async (msg: Message) => {
      // One small select to put the contact's name in the title. A
      // failure here just means the generic fallback title.
      const response = await fetch(
        '/api/inbox/conversations/' + encodeURIComponent(msg.conversation_id),
        { cache: 'no-store' }
      ).catch(() => null);
      const data = response?.ok
        ? await response.json().catch(() => null)
        : null;
      if (cancelled) return;
      const contact = data?.conversation?.contact;
      const { title, body } = buildNotificationContent(
        msg,
        pickContactDisplayName(contact),
        labelsRef.current
      );

      try {
        const notification = new Notification(title, {
          body,
          // One alert per conversation: a second message from the same
          // customer replaces the first instead of stacking.
          tag: msg.conversation_id,
          icon: '/icon',
        });
        notification.onclick = () => {
          window.focus();
          router.push(conversationHref(msg.conversation_id));
          notification.close();
        };
      } catch (err) {
        // Some browsers throw from the constructor (e.g. Android Chrome
        // requires a service worker). Non-fatal.
        console.error('[useBrowserNotifications] failed to show:', err);
      }
    };

    notifyRef.current = notify;
    return () => {
      cancelled = true;
      notifyRef.current = null;
    };
  }, [enabled, router]);
}
