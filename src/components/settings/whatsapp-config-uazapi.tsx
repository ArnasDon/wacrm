'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, LogOut, QrCode, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

type UazapiStatus = 'disconnected' | 'connecting' | 'connected' | 'hibernated' | 'unknown';

interface StatusResponse {
  status: UazapiStatus;
  qrcode?: string;
  paircode?: string;
  pairedPhone?: string;
}

const QR_POLL_INTERVAL_MS = 3000;
// uazapi QR codes expire after ~2 minutes — refresh a little early so
// the user never stares at a dead code.
const QR_REFRESH_MS = 100_000;

/**
 * QR-pairing screen for the uazapi provider. Rendered by
 * WhatsAppProviderPanel once an instance already exists for this
 * account (creation happens one level up, in the provider picker) —
 * this component only ever calls connect/status/disconnect.
 */
export function WhatsAppConfigUazapi({ onSwitchedProvider }: { onSwitchedProvider: () => void }) {
  const t = useTranslations('Settings.whatsappUazapi');

  const [status, setStatus] = useState<UazapiStatus>('unknown');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairedPhone, setPairedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (qrRefreshRef.current) clearTimeout(qrRefreshRef.current);
    pollRef.current = null;
    qrRefreshRef.current = null;
  }, []);

  const fetchStatus = useCallback(async (): Promise<StatusResponse | null> => {
    try {
      const res = await fetch('/api/uazapi/instance/status');
      if (!res.ok) return null;
      return (await res.json()) as StatusResponse;
    } catch {
      return null;
    }
  }, []);

  const startConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await fetch('/api/uazapi/instance/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastConnectFailed'));
        return;
      }
      setStatus(data.status);
      setQrCode(data.qrcode ?? null);
      if (data.status === 'connected') {
        setPairedPhone(data.pairedPhone ?? null);
      }
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setConnecting(false);
    }
  }, [t]);

  // Poll status while connecting; stop once connected. Also refreshes
  // the QR code before it expires so a slow scanner never hits a dead
  // code.
  useEffect(() => {
    if (status !== 'connecting') return;
    pollRef.current = setInterval(async () => {
      const data = await fetchStatus();
      if (!data) return;
      setStatus(data.status);
      if (data.status === 'connected') {
        setPairedPhone(data.pairedPhone ?? null);
        clearTimers();
        toast.success(t('toastConnected'));
      }
    }, QR_POLL_INTERVAL_MS);
    qrRefreshRef.current = setTimeout(() => {
      void startConnect();
    }, QR_REFRESH_MS);
    return clearTimers;
  }, [status, fetchStatus, clearTimers, startConnect, t]);

  useEffect(() => {
    (async () => {
      const data = await fetchStatus();
      setLoading(false);
      if (!data) return;
      setStatus(data.status);
      if (data.status === 'connected') setPairedPhone(data.pairedPhone ?? null);
      if (data.status === 'connecting') setQrCode(data.qrcode ?? null);
    })();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/uazapi/instance/disconnect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastDisconnectFailed'));
        return;
      }
      clearTimers();
      setStatus('disconnected');
      setQrCode(null);
      setPairedPhone(null);
      toast.success(t('toastDisconnected'));
    } catch {
      toast.error(t('toastNetworkError'));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSwitchProvider = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/uazapi/instance', { method: 'DELETE' });
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

  if (loading) {
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

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {status === 'connected' ? (
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
      ) : status === 'connecting' && qrCode ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('scanTitle')}</CardTitle>
            <CardDescription>{t('scanDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URI, not an optimizable remote image */}
            <img
              src={qrCode}
              alt={t('qrAlt')}
              className="size-56 rounded-lg border border-border bg-white p-2"
            />
            <p className="text-xs text-muted-foreground">{t('qrExpiryHint')}</p>
            <Button variant="outline" onClick={startConnect} disabled={connecting}>
              <RotateCcw className="size-4" />
              {t('refreshQrBtn')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="size-5" />
              {t('connectTitle')}
            </CardTitle>
            <CardDescription>{t('connectDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Alert className="bg-amber-950/40 border-amber-600/40">
              <AlertTitle className="text-amber-200">{t('banRiskTitle')}</AlertTitle>
              <AlertDescription className="text-amber-100/80 text-xs leading-relaxed">
                {t('banRiskDesc')}
              </AlertDescription>
            </Alert>
            <Button onClick={startConnect} disabled={connecting} className="self-start">
              {connecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('connecting')}
                </>
              ) : (
                <>
                  <QrCode className="size-4" />
                  {t('connectBtn')}
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={handleSwitchProvider}
              disabled={disconnecting}
              className="self-start text-muted-foreground"
            >
              {t('switchProviderBtn')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
