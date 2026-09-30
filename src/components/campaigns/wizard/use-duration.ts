'use client';

import { useTranslations } from 'next-intl';

/** Seconds → "under a minute" / "12 minutes" / "2 h 5 min". */
export function useDuration() {
  const t = useTranslations('Campaigns.wizard.duration');
  return (seconds: number) => {
    if (seconds < 60) return t('underMinute');
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return t('minutes', { count: minutes });
    return t('hours', {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    });
  };
}
