'use client';

import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Persistent, unmissable indicator that this account sends WhatsApp
 * traffic through `DemoWhatsAppService` rather than the real Meta
 * Cloud API (§3, driven by the explicit Demo Mode toggle in Settings
 * → WhatsApp, §15). Every "delivery" while this is on is simulated —
 * nothing reaches a real customer — and that must never be something
 * an operator discovers by accident (cf. `AccountAccessAlert`, which
 * exists for the identical reason on the opposite failure mode:
 * silent, invisible state that changes what the app is actually
 * doing).
 *
 * Deliberately not dismissible and rendered above every page (wired
 * into `DashboardShell`, not any one screen) — the whole point is
 * that it can't be missed or permanently closed while the setting is
 * still on. Renders nothing once account context has resolved and
 * Demo Mode is off; renders nothing while still loading, to avoid a
 * flash before the real value is known.
 */
export function DemoModeBanner() {
  const { account, accountStatus } = useAuth();
  const t = useTranslations('DemoMode');

  if (accountStatus !== 'ready' || !account?.demo_mode_enabled) return null;

  return (
    <Alert className="border-primary/50 mb-4">
      <FlaskConical />
      <AlertTitle>{t('bannerTitle')}</AlertTitle>
      <AlertDescription>{t('bannerBody')}</AlertDescription>
    </Alert>
  );
}
