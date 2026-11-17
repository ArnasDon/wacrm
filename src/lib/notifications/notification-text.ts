import type { Notification } from '@/types';
import type { Translate } from '@/lib/i18n/translate';

/** Localize system notifications without rewriting stored text or personal names. */
export function notificationText(
  notification: Pick<Notification, 'type' | 'title' | 'body'>,
  names: { actor?: string | null; contact?: string | null },
  t: Translate
): { title: string; body: string | undefined } {
  if (notification.type !== 'conversation_assigned') {
    return { title: notification.title, body: notification.body };
  }
  return {
    title: t('assignedTitle'),
    body: t('assignedBody', {
      actor: names.actor || t('unknownActor'),
      contact: names.contact || t('unknownContact'),
    }),
  };
}
