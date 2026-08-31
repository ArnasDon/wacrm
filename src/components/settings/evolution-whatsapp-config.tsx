'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, QrCode, Unplug, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const QR_POLL_INTERVAL_MS = 2000;
// Evolution Go generates the QR asynchronously right after
// /instance/connect — the reference integration polls up to 20x
// before giving up. At 2s/poll that's the same ~40s ceiling.
const QR_MAX_POLLS = 20;

interface EvolutionWhatsAppConfigProps {
  config: WhatsAppConfigType | null;
  /** Re-fetches the parent's config row (after connect/disconnect). */
  onChanged: () => void;
}

export function EvolutionWhatsAppConfig({ config, onChanged }: EvolutionWhatsAppConfigProps) {
  const t = useTranslations('Settings.whatsapp.evolution');

  const isEvolutionConfig = config?.provider === 'evolution';
  const isConnected = isEvolutionConfig && config?.status === 'connected';

  const [apiUrl, setApiUrl] = useState(config?.evolution_api_url || '');
  const [adminToken, setAdminToken] = useState('');
  const [instanceName, setInstanceName] = useState(config?.evolution_instance_name || '');
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [qrOpen, setQrOpen] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrTimedOut, setQrTimedOut] = useState(false);
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollQr = useCallback(async () => {
    pollCountRef.current += 1;
    try {
      const res = await fetch('/api/whatsapp/evolution/qr');
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('qrPollError'));
        stopPolling();
        return;
      }
      if (payload.connected) {
        stopPolling();
        setQrOpen(false);
        toast.success(t('connectedToast'));
        onChanged();
        return;
      }
      if (payload.base64) setQrImage(payload.base64);
      if (payload.code) setQrCode(payload.code);
      if (pollCountRef.current >= QR_MAX_POLLS) {
        stopPolling();
        setQrTimedOut(true);
      }
    } catch (err) {
      console.error('[evolution] QR poll failed:', err);
    }
  }, [onChanged, stopPolling, t]);

  function startPolling() {
    pollCountRef.current = 0;
    setQrTimedOut(false);
    setQrImage(null);
    setQrCode(null);
    stopPolling();
    pollQr();
    pollTimerRef.current = setInterval(pollQr, QR_POLL_INTERVAL_MS);
  }

  async function handleConnect() {
    if (!apiUrl.trim() || !adminToken.trim() || !instanceName.trim()) {
      toast.error(t('validationRequired'));
      return;
    }
    try {
      setSaving(true);
      const res = await fetch('/api/whatsapp/evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: apiUrl.trim(),
          admin_token: adminToken.trim(),
          instance_name: instanceName.trim(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('connectError'));
        return;
      }
      // Deliberately NOT calling onChanged() here: it refreshes the
      // parent's config, which flips its `loading` state true and
      // unmounts this component (killing the qrOpen state we're about
      // to set) while the fetch is in flight — the QR modal would
      // flash open and immediately disappear. The parent already gets
      // refreshed once the poll below confirms an actual connection.
      setQrOpen(true);
      startPolling();
    } catch (err) {
      console.error('[evolution] connect failed:', err);
      toast.error(t('connectError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    try {
      setDisconnecting(true);
      const res = await fetch('/api/whatsapp/evolution', { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json();
        toast.error(payload.error || t('disconnectError'));
        return;
      }
      toast.success(t('disconnectedToast'));
      setAdminToken('');
      onChanged();
    } catch (err) {
      console.error('[evolution] disconnect failed:', err);
      toast.error(t('disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-foreground">{t('title')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('description')}
              </CardDescription>
            </div>
            {isEvolutionConfig && (
              <Badge variant={isConnected ? 'default' : 'secondary'} className="gap-1">
                {isConnected ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                {isConnected ? t('statusConnected') : t('statusDisconnected')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="evo-api-url">{t('apiUrlLabel')}</Label>
            <Input
              id="evo-api-url"
              placeholder="http://192.168.1.40:8080"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              disabled={isConnected}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="evo-instance-name">{t('instanceNameLabel')}</Label>
            <Input
              id="evo-instance-name"
              placeholder="wacrm"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              disabled={isConnected}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="evo-admin-token">{t('adminTokenLabel')}</Label>
            <Input
              id="evo-admin-token"
              type="password"
              placeholder={isEvolutionConfig ? t('adminTokenPlaceholderSaved') : ''}
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              disabled={isConnected}
            />
            <p className="text-xs text-muted-foreground">{t('adminTokenHint')}</p>
          </div>

          {isConnected ? (
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="gap-2"
            >
              {disconnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              {t('disconnectButton')}
            </Button>
          ) : (
            <Button onClick={handleConnect} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <QrCode className="size-4" />
              )}
              {t('connectButton')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={qrOpen}
        onOpenChange={(open) => {
          setQrOpen(open);
          if (!open) stopPolling();
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('qrTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('qrDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrImage ? (
              <img
                src={qrImage.startsWith('data:') ? qrImage : `data:image/png;base64,${qrImage}`}
                alt={t('qrTitle')}
                className="size-56 rounded-lg border border-border"
              />
            ) : qrCode ? (
              // Evolution Go can return a pairing code with no base64
              // image (some instance states). Show it as copyable text
              // rather than blocking on an image that may never arrive.
              <p className="break-all rounded-lg border border-border p-3 text-center font-mono text-sm">
                {qrCode}
              </p>
            ) : qrTimedOut ? (
              <p className="text-sm text-destructive">{t('qrTimeout')}</p>
            ) : (
              <div className="flex size-56 items-center justify-center rounded-lg border border-border">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            )}
            {qrTimedOut && (
              <Button variant="outline" size="sm" onClick={startPolling}>
                {t('qrRetry')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
