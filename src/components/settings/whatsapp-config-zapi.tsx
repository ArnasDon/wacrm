'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, LogOut, QrCode } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

type ZapiStatus = 'disconnected' | 'connected';
type Phase = 'loading' | 'credentials' | 'pairing' | 'connected';

interface StatusResponse {
  status: ZapiStatus;
  qrCode?: string | null;
  pairedPhone?: string | null;
}

// Z-API invalidates its QR code roughly every 20 seconds (per its own
// docs), much shorter-lived than uazapi's ~2 minutes — polling status
// (which fetches a fresh QR alongside it) on the same cadence covers
// both concerns with one timer, unlike the uazapi screen's separate
// QR-refresh timer.
const POLL_INTERVAL_MS = 10_000;

/**
 * Z-API is bring-your-own-instance: the account owner creates their
 * own instance in Z-API's dashboard and pastes Instance ID + Token
 * (+ optional Client-Token) here — there's no "create instance" step
 * this CRM performs on their behalf, unlike uazapi's reseller model.
 * This component therefore has one more phase than
 * WhatsAppConfigUazapi: a credentials form shown until the account
 * has actually saved something, then the same QR-pairing/status
 * screen shape.
 */
export function WhatsAppConfigZapi({ onSwitchedProvider }: { onSwitchedProvider: () => void }) {
  const t = useTranslations('Settings.whatsappZapi');

  const [phase, setPhase] = useState<Phase>('loading');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairedPhone, setPairedPhone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [instanceId, setInstanceId] = useState('');
  const [token, setToken] = useState('');
  const [clientToken, setClientToken] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const fetchStatus = useCallback(async (): Promise<StatusResponse | null> => {
    try {
      const res = await fetch('/api/z-api/instance/status');
      if (!res.ok) return null;
      return (await res.json()) as StatusResponse;
    } catch {
      return null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const data = await fetchStatus();
    if (!data) {
      setPhase('credentials');
      return;
    }
    if (data.status === 'connected') {
      setPairedPhone(data.pairedPhone ?? null);
      setPhase('connected');
      clearTimers();
    } else {
      setQrCode(data.qrCode ?? null);
      setPhase('pairing');
    }
  }, [fetchStatus, clearTimers]);

  useEffect(() => {
    void refreshStatus();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'pairing') return;
    pollRef.current = setInterval(async () => {
      const data = await fetchStatus();
      if (!data) return;
      if (data.status === 'connected') {
        setPairedPhone(data.pairedPhone ?? null);
        setPhase('connected');
        clearTimers();
        toast.success(t('toastConnected'));
      } else {
        setQrCode(data.qrCode ?? null);
      }
    }, POLL_INTERVAL_MS);
    return clearTimers;
  }, [phase, fetchStatus, clearTimers, t]);

  const handleSaveCredentials = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/z-api/instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId,
          token,
          clientToken: clientToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastSaveFailed'));
        return;
      }
      toast.success(t('toastSaved'));
      await refreshStatus();
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/z-api/instance/disconnect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastDisconnectFailed'));
        return;
      }
      clearTimers();
      setPairedPhone(null);
      toast.success(t('toastDisconnected'));
      await refreshStatus();
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSwitchProvider = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/z-api/instance', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastDisconnectFailed'));
        return;
      }
      clearTimers();
      onSwitchedProvider();
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setDisconnecting(false);
    }
  };

  if (phase === 'loading') {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      </div>
    );
  }

  if (phase === 'credentials') {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Card>
          <CardHeader>
            <CardTitle>{t('credentialsTitle')}</CardTitle>
            <CardDescription>{t('credentialsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Alert className="bg-amber-950/40 border-amber-600/40">
              <AlertTitle className="text-amber-200">{t('banRiskTitle')}</AlertTitle>
              <AlertDescription className="text-amber-100/80 text-xs leading-relaxed">
                {t('banRiskDesc')}
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zapi-instance-id">{t('instanceIdLabel')}</Label>
              <Input
                id="zapi-instance-id"
                placeholder={t('instanceIdPlaceholder')}
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zapi-token">{t('tokenLabel')}</Label>
              <Input
                id="zapi-token"
                type="password"
                placeholder={t('tokenPlaceholder')}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zapi-client-token">{t('clientTokenLabel')}</Label>
              <Input
                id="zapi-client-token"
                type="password"
                placeholder={t('clientTokenPlaceholder')}
                value={clientToken}
                onChange={(e) => setClientToken(e.target.value)}
              />
            </div>
            <Button
              onClick={handleSaveCredentials}
              disabled={saving || !instanceId || !token}
              className="self-start"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('saveBtn')
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === 'connected') {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-400" />
              {t('connectedTitle')}
            </CardTitle>
            <CardDescription>
              {pairedPhone ? t('connectedDesc', { phone: pairedPhone }) : t('connectedDescNoPhone')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
              <LogOut className="size-4" />
              {disconnecting ? t('disconnecting') : t('disconnectBtn')}
            </Button>
            <Button variant="ghost" onClick={handleSwitchProvider} disabled={disconnecting}>
              {t('switchProviderBtn')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // phase === 'pairing'
  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="size-5" />
            {t('scanTitle')}
          </CardTitle>
          <CardDescription>{t('scanDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {qrCode ? (
            // eslint-disable-next-line @next/next/no-img-element -- base64 data URI, not an optimizable remote image
            <img
              src={qrCode}
              alt={t('qrAlt')}
              className="size-56 rounded-lg border border-border bg-white p-2"
            />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('loadingQr')}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('qrExpiryHint')}</p>
          <Button
            variant="ghost"
            onClick={handleSwitchProvider}
            disabled={disconnecting}
            className="text-muted-foreground"
          >
            {t('switchProviderBtn')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
