'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PlugZap, QrCode } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsAppConfig } from './whatsapp-config';
import { WhatsAppConfigUazapi } from './whatsapp-config-uazapi';
import { WhatsAppConfigZapi } from './whatsapp-config-zapi';
import { UazapiPlatformCredentialsForm } from './uazapi-platform-credentials-form';

type Provider = 'meta' | 'uazapi' | 'zapi' | null;

/**
 * Top of the WhatsApp settings section. Resolves which provider (if
 * any) the account has configured and renders the matching UI:
 *   - no config yet    → the picker below
 *   - provider='meta'  → the existing WhatsAppConfig form, untouched
 *   - provider='uazapi' → the uazapi QR-pairing screen
 *   - provider='zapi'   → the Z-API credentials form + QR-pairing screen
 *
 * Switching providers always goes through an explicit disconnect
 * (each provider screen's own "switch" button, or the link rendered
 * next to the Meta form here) so the account never has two live
 * credential sets — see migration 037/040's mutual-exclusivity CHECK.
 */
export function WhatsAppProviderPanel() {
  const t = useTranslations('Settings.whatsappProvider');
  const { isOwner } = useAuth();
  const [provider, setProvider] = useState<Provider>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(false);

  const loadProvider = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/provider');
      const data = await res.json();
      setProvider(res.ok ? ((data.provider as Provider) ?? null) : null);
    } catch {
      setProvider(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProvider();
  }, [loadProvider]);

  const handlePickUazapi = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/uazapi/instance', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastCreateFailed'));
        return;
      }
      setProvider('uazapi');
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setCreating(false);
    }
  };

  const handleSwitchFromMeta = async () => {
    if (typeof window !== 'undefined' && !window.confirm(t('switchConfirm'))) return;
    setSwitching(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastDisconnectFailed'));
        return;
      }
      await loadProvider();
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setSwitching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  // Owner-only, platform-wide uazapi credentials — reachable no matter
  // which provider this account currently has, so the owner can edit
  // or remove them later (e.g. after a wrong Admin Token causes a 502
  // on instance creation) without having to disconnect anything first.
  const platformCredentialsSection = isOwner ? (
    <div className="mt-6 border-t border-border pt-6">
      <UazapiPlatformCredentialsForm />
    </div>
  ) : null;

  if (provider === 'meta') {
    return (
      <div className="flex flex-col gap-3">
        <WhatsAppConfig />
        <button
          type="button"
          onClick={handleSwitchFromMeta}
          disabled={switching}
          className="self-start text-xs text-muted-foreground underline decoration-dotted hover:text-foreground disabled:opacity-50"
        >
          {t('switchToUazapiLink')}
        </button>
        {platformCredentialsSection}
      </div>
    );
  }

  if (provider === 'uazapi') {
    return (
      <div>
        <WhatsAppConfigUazapi onSwitchedProvider={loadProvider} />
        {platformCredentialsSection}
      </div>
    );
  }

  if (provider === 'zapi') {
    return (
      <div>
        <WhatsAppConfigZapi onSwitchedProvider={loadProvider} />
        {platformCredentialsSection}
      </div>
    );
  }

  return (
    <div>
      <SettingsPanelHead title={t('pickerTitle')} description={t('pickerDesc')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="size-5" />
              {t('metaCardTitle')}
            </CardTitle>
            <CardDescription>{t('metaCardDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button onClick={() => setProvider('meta')} className="w-full">
              {t('metaCardBtn')}
            </Button>
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="size-5" />
              {t('uazapiCardTitle')}
            </CardTitle>
            <CardDescription>{t('uazapiCardDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button onClick={handlePickUazapi} disabled={creating} className="w-full">
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('uazapiCardBtn')
              )}
            </Button>
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="size-5" />
              {t('zapiCardTitle')}
            </CardTitle>
            <CardDescription>{t('zapiCardDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button onClick={() => setProvider('zapi')} className="w-full">
              {t('zapiCardBtn')}
            </Button>
          </CardContent>
        </Card>
      </div>
      {platformCredentialsSection}
    </div>
  );
}
