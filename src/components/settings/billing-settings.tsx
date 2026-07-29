'use client';

import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Settings → Faturamento. Placeholder-only — see
 * src/lib/billing/README.md for what actually plugs in here once
 * Asaas billing is wired up. `organizations.billing_status` exists
 * in the schema (migration 044) but nothing reads it for access
 * control yet, so there is deliberately no plan/payment UI here, only
 * this "coming soon, still free" notice.
 *
 * No support-contact link here on purpose — this deployment doesn't
 * have a real support address configured anywhere yet, and a
 * fabricated one would be worse than none.
 */
export function BillingSettings() {
  const t = useTranslations('Settings.billing');

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-5 text-muted-foreground" />
            {t('comingSoonTitle')}
          </CardTitle>
          <CardDescription>{t('comingSoonDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('freeUntilThen')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
