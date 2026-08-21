'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, QrCode, RotateCcw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import type { BaileysStatusConexao } from '@/types';

const POLL_INTERVAL_MS = 3_000;

interface StatusResponse {
  status: BaileysStatusConexao;
  updatedAt: string | null;
  qrDataUrl: string | null;
}

export function BaileysConfig() {
  const t = useTranslations('Settings.envios');

  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState(false);
  // True from the moment "Parear" is clicked until the connection
  // actually opens. Needed because the DB row's status_conexao is
  // still 'desconectado' for a brief moment after POST .../parear
  // returns — the socket write happens async inside Baileys'
  // 'connection.update' event, not before the request resolves — so
  // gating polling on `data.status === 'pareando'` alone would never
  // start it: the very first status read after clicking is still
  // 'desconectado', so the poll effect below never had anything to
  // turn it on.
  const [pairingActive, setPairingActive] = useState(false);
  const [data, setData] = useState<StatusResponse | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/envios/baileys/status');
      if (!res.ok) return;
      const json = (await res.json()) as StatusResponse;
      setData(json);
      if (json.status === 'conectado') setPairingActive(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    const shouldPoll = pairingActive || data?.status === 'pareando';
    if (shouldPoll) {
      if (!pollTimer.current) pollTimer.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    } else if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [pairingActive, data?.status]);

  async function handlePair() {
    setPairing(true);
    try {
      const res = await fetch('/api/envios/baileys/parear', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? t('pairFailed'));
      setPairingActive(true);
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pairFailed'));
    } finally {
      setPairing(false);
    }
  }

  const status = data?.status ?? 'desconectado';

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {status === 'conectado' ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : (
              <XCircle className="h-4 w-4 text-muted-foreground" />
            )}
            {t(`status.${status}`)}
          </CardTitle>
          <CardDescription>
            {status === 'desconectado' ? t('disconnectedHint') : status === 'pareando' ? t('pairingHint') : t('connectedHint')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              {data?.qrDataUrl && status === 'pareando' && (
                <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.qrDataUrl} alt="QR pairing" className="h-56 w-56" />
                </div>
              )}

              <Button
                onClick={handlePair}
                disabled={pairing}
                variant={status === 'conectado' ? 'outline' : 'default'}
                className={status === 'conectado' ? 'border-border' : 'bg-primary text-primary-foreground hover:bg-primary/90'}
              >
                {pairing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : status === 'conectado' ? (
                  <RotateCcw className="h-4 w-4" />
                ) : (
                  <QrCode className="h-4 w-4" />
                )}
                {status === 'conectado' ? t('reconnect') : t('pair')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">{t('licenseNotice')}</p>
    </div>
  );
}
