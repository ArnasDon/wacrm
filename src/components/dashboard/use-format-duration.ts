'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { splitDuration } from '@/lib/dashboard/overview'

export function useFormatDuration() {
  const t = useTranslations('Dashboard.overview.duration')
  return useCallback(
    (minutes: number) => {
      const { unit, value, remainder } = splitDuration(minutes)
      if (unit === 'seconds') return t('seconds', { value })
      if (unit === 'minutes') return t('minutes', { value })
      if (unit === 'hours') return remainder ? t('hours', { value, remainder }) : t('hoursOnly', { value })
      return remainder ? t('days', { value, remainder }) : t('daysOnly', { value })
    },
    [t],
  )
}
