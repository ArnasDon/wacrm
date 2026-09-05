'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const QR_WINDOW_SECONDS = 120;
const POLL_INTERVAL_MS = 3000;

const STATUS_LABEL_KEYS = {
  connected: 'uazapiStatusConnected',
  connecting: 'uazapiStatusConnecting',
  hibernated: 'uazapiStatusHibernated',
  banned: 'uazapiStatusBanned',
  disconnected: 'uazapiStatusDisconnected',
} as const;

type StatusLabelKey =
  (typeof STATUS_LABEL_KEYS)[keyof typeof STATUS_LABEL_KEYS];

/** Map a raw connection status to the i18n key for its badge label. */
export function uazapiStatusLabelKey(status: string | null): StatusLabelKey {
  if (status && status in STATUS_LABEL_KEYS) {
    return STATUS_LABEL_KEYS[status as keyof typeof STATUS_LABEL_KEYS];
  }
  return STATUS_LABEL_KEYS.disconnected;
}

/** `mm:ss` for the QR countdown. Clamps at zero. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** UAZAPI hands back a data URI already; tolerate a bare base64 string. */
export function qrImageSrc(raw: string): string {
  return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
}

export type UazapiView =
  'absent' | 'qr' | 'qr_expired' | 'connected' | 'needs_action';

/** Which block the card renders, derived from the row + local QR state. */
export function deriveUazapiView(opts: {
  hasRow: boolean;
  status: string | null;
  hasQr: boolean;
  qrActive: boolean;
}): UazapiView {
  if (opts.hasQr) return opts.qrActive ? 'qr' : 'qr_expired';
  if (opts.status === 'connected') return 'connected';
  if (opts.hasRow) return 'needs_action';
  return 'absent';
}

export function UazapiConnectionCard({
  connections,
  onChanged,
}: {
  connections: ConnectionDTO[];
  onChanged: () => void;
}) {
  const t = useTranslations('Settings.whatsapp');
  const { canEditSettings } = useAuth();

  const row = connections.find((c) => c.provider === 'uazapi');

  // `localId` bridges the gap between POST /connections (which returns
  // the new id) and the parent refetching its `connections` prop — we
  // show the QR straight away without waiting for that round trip.
  const [localId, setLocalId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const effectiveId = row?.id ?? localId;
  const secondsLeft = deadline
    ? Math.max(0, Math.ceil((deadline - now) / 1000))
    : 0;
  const qrActive = qr !== null && deadline !== null && secondsLeft > 0;

  // Countdown ticker + status poll. Both live only for the length of
  // the connect window: when `deadline` clears (scan succeeds, the
  // countdown hits zero, or the card unmounts) the cleanup stops both
  // intervals.
  useEffect(() => {
    if (!deadline || !effectiveId) return;

    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/whatsapp/connections/${effectiveId}/status`
          );
          if (!res.ok) return;
          const data = (await res.json()) as {
            status?: string;
            qrcode?: string | null;
          };
          if (data.qrcode) {
            const next = data.qrcode;
            setQr((prev) => (next !== prev ? next : prev));
          }
          if (data.status === 'connected') {
            setQr(null);
            setDeadline(null);
            setLocalId(null);
            onChanged();
          }
        } catch {
          // A transient poll failure must not tear down the QR the user
          // is mid-scan on, and a toast every few seconds would be worse
          // than the blip. User-initiated calls below still surface
          // errors.
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [deadline, effectiveId, onChanged]);

  // Retire the connect window the instant the countdown reaches zero so
  // the effect above tears down; the expired QR stays on screen behind a
  // "generate a new one" button.
  useEffect(() => {
    if (deadline && now >= deadline) setDeadline(null);
  }, [deadline, now]);

  const runAction = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      try {
        await fn();
      } catch {
        toast.error(t('uazapiActionFailed'));
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  const requestQr = useCallback(async (id: string) => {
    const res = await fetch(`/api/whatsapp/connections/${id}/connect`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('connect failed');
    const data = (await res.json()) as {
      qrcode?: string | null;
      expiresInSeconds?: number;
    };
    const secs =
      typeof data.expiresInSeconds === 'number'
        ? data.expiresInSeconds
        : QR_WINDOW_SECONDS;
    setQr(data.qrcode ?? null);
    setNow(Date.now());
    setDeadline(Date.now() + secs * 1000);
  }, []);

  const clearLocalState = useCallback(() => {
    setQr(null);
    setDeadline(null);
    setLocalId(null);
  }, []);

  function handleConnect() {
    void runAction(async () => {
      const res = await fetch('/api/whatsapp/connections', { method: 'POST' });
      if (!res.ok) throw new Error('create failed');
      const body = (await res.json()) as { data?: { id?: string } };
      const id = body.data?.id;
      if (!id) throw new Error('missing id');
      setLocalId(id);
      await requestQr(id);
    });
  }

  function handleReconnect() {
    if (!effectiveId) return;
    const id = effectiveId;
    void runAction(() => requestQr(id));
  }

  function handleDisconnect() {
    if (!effectiveId) return;
    const id = effectiveId;
    void runAction(async () => {
      const res = await fetch(`/api/whatsapp/connections/${id}/disconnect`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('disconnect failed');
      clearLocalState();
      onChanged();
    });
  }

  function handleRemove() {
    if (!effectiveId) return;
    const id = effectiveId;
    void runAction(async () => {
      const res = await fetch(`/api/whatsapp/connections/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('remove failed');
      clearLocalState();
      onChanged();
    });
  }

  const view = deriveUazapiView({
    hasRow: Boolean(row) || Boolean(localId),
    status: row?.status ?? null,
    hasQr: qr !== null,
    qrActive,
  });
  const disabled = !canEditSettings || busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">
          {t('uazapiCardTitle')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('uazapiCardDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle className="mb-0">
            {t('uazapiUnofficialWarning')}
          </AlertTitle>
        </Alert>

        {view === 'absent' && (
          <Button onClick={handleConnect} disabled={disabled}>
            {busy ? <Loader2 className="animate-spin" /> : <QrCode />}
            {t('uazapiConnect')}
          </Button>
        )}

        {(view === 'qr' || view === 'qr_expired') && qr && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrImageSrc(qr)}
              alt={t('uazapiCardTitle')}
              className="border-border size-56 rounded-lg border bg-white p-2"
            />
            {view === 'qr' ? (
              <>
                <p className="text-muted-foreground text-sm">
                  {t('uazapiScanHint')}
                </p>
                <p className="text-foreground flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="size-4 animate-spin" />
                  {t('uazapiConnecting')} · {formatCountdown(secondsLeft)}
                </p>
              </>
            ) : (
              <>
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertDescription>{t('uazapiQrExpired')}</AlertDescription>
                </Alert>
                <Button onClick={handleReconnect} disabled={disabled}>
                  {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {t('uazapiNewQr')}
                </Button>
              </>
            )}
          </div>
        )}

        {view === 'connected' && (
          <div className="space-y-3">
            <div className="text-foreground flex items-center gap-2 text-sm">
              <CheckCircle2 className="text-primary size-4" />
              <span className="font-medium">
                {t('uazapiConnectedAs', {
                  name: row?.profile_name ?? '—',
                  phone: row?.display_phone ?? '—',
                })}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!effectiveId) return;
                  const id = effectiveId;
                  void runAction(async () => {
                    const res = await fetch(
                      `/api/whatsapp/connections/${id}/reconfigure-webhook`,
                      { method: 'POST' }
                    );
                    if (!res.ok) throw new Error('reconfigure failed');
                    onChanged();
                  });
                }}
                disabled={disabled}
              >
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t('uazapiReconfigureWebhook')}
              </Button>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={disabled}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Power />}
                {t('uazapiDisconnect')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleRemove}
                disabled={disabled}
              >
                <Trash2 />
                {t('uazapiRemove')}
              </Button>
            </div>
          </div>
        )}

        {view === 'needs_action' && (
          <div className="space-y-3">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Smartphone className="size-4" />
              <span className="font-medium">
                {t(uazapiStatusLabelKey(row?.status ?? null))}
              </span>
            </div>
            {row?.last_connection_error && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{row.last_connection_error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleReconnect} disabled={disabled}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t('uazapiReconnect')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleRemove}
                disabled={disabled}
              >
                <Trash2 />
                {t('uazapiRemove')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
