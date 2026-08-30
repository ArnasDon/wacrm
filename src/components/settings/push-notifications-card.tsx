'use client';

// Deliberately hardcoded Spanish — same call as google-sheets-config.tsx:
// keeps this self-contained rather than threading a Settings block
// through en/ko/es.json.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
  type PushState,
} from '@/lib/push/client';
import { readResponseJson } from '@/lib/http/response-json';

export function PushNotificationsCard() {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    setState(await getPushState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Nothing to show if the browser can't do push at all, or the server
  // has no VAPID keys configured.
  if (state === 'unsupported' || state === 'unconfigured') return null;

  const enabled = state === 'on';

  const onToggle = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        // Permission MUST be requested from a user gesture — this click is one.
        const perm =
          Notification.permission === 'granted'
            ? 'granted'
            : await Notification.requestPermission();
        if (perm !== 'granted') {
          toast.error(
            perm === 'denied'
              ? 'Bloqueaste las notificaciones para este sitio. Habilitalas en los ajustes del navegador.'
              : 'Permiso de notificaciones no concedido.',
          );
          await refresh();
          return;
        }
        const ok = await subscribeToPush();
        if (!ok) {
          toast.error('No se pudo activar. Probá recargar la página.');
        } else {
          toast.success('Notificaciones push activadas en este dispositivo.');
        }
      } else {
        await unsubscribeFromPush();
        toast.success('Notificaciones push desactivadas en este dispositivo.');
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (res.ok) {
        toast.success('Enviada. Debería llegar a este dispositivo en unos segundos.');
      } else {
        const data = await readResponseJson<{ error?: string }>(res);
        toast.error(data?.error ?? 'No se pudo enviar la prueba.');
      }
    } catch {
      toast.error('No se pudo enviar la prueba.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          Notificaciones push
        </CardTitle>
        <CardDescription>
          Recibí un aviso en este dispositivo cuando te asignen una conversación o
          entre un mensaje — aunque tengas la app cerrada. Se configura por dispositivo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {enabled ? 'Activadas en este dispositivo' : 'Desactivadas'}
            </p>
            {state === 'denied' && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                El navegador tiene las notificaciones bloqueadas para este sitio.
                Cambialo en los ajustes del sitio y volvé a intentar.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(busy || state === 'loading') && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            <Switch
              checked={enabled}
              disabled={busy || state === 'loading' || state === 'denied'}
              onCheckedChange={onToggle}
              aria-label="Activar notificaciones push"
            />
          </div>
        </div>

        {enabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={sendTest}
            disabled={testing}
          >
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Enviar prueba
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
