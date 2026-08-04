'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';

// Custom feature (not part of the upstream wacrm template): lets a
// user turn this device (e.g. an iPhone with the app added to the
// Home Screen) into a push-notification target for new inbound
// WhatsApp messages. See src/lib/push/send.ts for the server side and
// public/sw.js for the service worker that renders the notification.

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Status = 'checking' | 'unsupported' | 'denied' | 'enabled' | 'disabled';

export function PushNotificationsCard() {
  const t = useTranslations('PushNotifications');
  const [status, setStatus] = useState<Status>('checking');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        setStatus('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? 'enabled' : 'disabled');
      } catch {
        if (!cancelled) setStatus('disabled');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        toast.error(t('genericError'));
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      const json = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        }),
      });
      if (!res.ok) throw new Error('subscribe failed');

      setStatus('enabled');
      toast.success(t('enabledToast'));
    } catch {
      toast.error(t('genericError'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus('disabled');
      toast.success(t('disabledToast'));
    } catch {
      toast.error(t('genericError'));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('testError'));
        return;
      }
      toast.success(t('testSuccess'));
    } catch {
      toast.error(t('testError'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Bell className="size-4 text-primary" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {status === 'checking' && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}

        {status === 'unsupported' && (
          <p className="text-sm text-muted-foreground">{t('notSupported')}</p>
        )}

        {status === 'denied' && (
          <p className="text-sm text-muted-foreground">{t('permissionDenied')}</p>
        )}

        {status === 'disabled' && (
          <Button type="button" onClick={enable} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Bell className="size-4" />
            )}
            {t('enableBtn')}
          </Button>
        )}

        {status === 'enabled' && (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Bell className="size-3" />
              {t('enabledBadge')}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={sendTest}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {t('testBtn')}
            </Button>
            <Button type="button" variant="ghost" onClick={disable} disabled={busy}>
              <BellOff className="size-4" />
              {t('disableBtn')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
