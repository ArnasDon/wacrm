'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RotateCcw,
  Unplug,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type ConnectionState = 'unknown' | 'not_created' | 'not_logged_in' | 'connected';

interface InstanceStatusResponse {
  connected?: boolean;
  loggedIn?: boolean;
  instance_name?: string;
  base_url?: string;
  connected_at?: string;
  reason?: string;
  message?: string;
}

/**
 * Uazapi connection panel — the counterpart to Meta's credential form
 * (`whatsapp-config.tsx`). An account can have both connected at once
 * (migration 029); this panel only manages the Uazapi row.
 *
 * wacrm never drives the WhatsApp session lifecycle for Uazapi — no
 * instance creation, no QR/pairing flow, no disconnect call. The
 * instance is created AND logged into WhatsApp entirely in the Uazapi
 * panel; this form only attaches to its token so wacrm can send
 * through it and receive inbound events via webhook.
 */
export function UazapiConfig() {
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();
  const t = useTranslations('uazapiConfig');

  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [state, setState] = useState<ConnectionState>('unknown');
  const [instanceName, setInstanceName] = useState<string>('');
  const [instanceBaseUrl, setInstanceBaseUrl] = useState<string>('');
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [tokenInput, setTokenInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [instanceNameInput, setInstanceNameInput] = useState('');
  const [attaching, setAttaching] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<InstanceStatusResponse | null> => {
    try {
      const res = await fetch('/api/uazapi/instance', { cache: 'no-store' });
      return (await res.json()) as InstanceStatusResponse;
    } catch (err) {
      console.error('[uazapi-config] status fetch failed:', err);
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const data = await fetchStatus();
    if (!data) return;

    setInstanceName(data.instance_name || '');
    setInstanceBaseUrl(data.base_url || '');
    setConnectedAt(data.connected_at || null);

    if (data.connected && data.loggedIn) {
      setState('connected');
      setErrorMessage('');
    } else if (data.reason === 'no_config' || data.reason === 'no_account') {
      setState('not_created');
    } else {
      // Token is attached but Uazapi reports the WhatsApp session as
      // not logged in (or the status check itself failed) — the fix
      // lives in the Uazapi panel, not here.
      setState('not_logged_in');
      if (data.message) setErrorMessage(data.message);
    }
  }, [fetchStatus]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;

    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [authLoading, profileLoading, user?.id, accountId, refresh]);

  async function handleAttach() {
    if (!tokenInput.trim()) {
      toast.error(t('errors.tokenRequired'));
      return;
    }
    setAttaching(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/uazapi/instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_token: tokenInput.trim(),
          base_url: baseUrlInput.trim() || undefined,
          instance_name: instanceNameInput.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || t('errors.attachFailed'));
        toast.error(data.error || t('errors.attachFailed'));
        return;
      }

      if (!data.webhook_configured) {
        toast.warning(t('toasts.webhookNotConfigured'), { duration: 10000 });
      } else {
        toast.success(
          data.connected
            ? t('toasts.attachedAndConnected')
            : t('toasts.attachedNotLoggedIn'),
        );
      }

      setTokenInput('');
      await refresh();
    } catch (err) {
      console.error('[uazapi-config] attach failed:', err);
      setErrorMessage(t('errors.serverUnreachable'));
      toast.error(t('errors.serverUnreachable'));
    } finally {
      setAttaching(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('confirmDetach'))) {
      return;
    }
    setDisconnecting(true);
    try {
      const res = await fetch('/api/uazapi/instance', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('errors.detachFailed'));
        return;
      }
      toast.success(t('toasts.detached'));
      setState('not_created');
      setInstanceName('');
      setInstanceBaseUrl('');
      setConnectedAt(null);
    } catch (err) {
      console.error('[uazapi-config] detach failed:', err);
      toast.error(t('errors.detachFailedGeneric'));
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <KeyRound className="size-4" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === 'connected' && (
          <Alert className="border-emerald-500/35 bg-emerald-500/10">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle className="text-emerald-700 dark:text-emerald-300 mb-0">
                {instanceName
                  ? t('connected.titleWithName', { name: instanceName })
                  : t('connected.title')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-1">
              {t('connected.description')}
            </AlertDescription>
            <dl className="mt-3 grid gap-1.5 border-t border-emerald-500/20 pt-3 text-xs">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{t('fields.instance')}</dt>
                <dd className="font-mono text-foreground">{instanceName || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{t('fields.server')}</dt>
                <dd className="font-mono text-foreground break-all">{instanceBaseUrl || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{t('fields.connectedSince')}</dt>
                <dd className="text-foreground">
                  {connectedAt ? new Date(connectedAt).toLocaleString() : '—'}
                </dd>
              </div>
            </dl>
          </Alert>
        )}

        {state === 'not_logged_in' && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-amber-700 dark:text-amber-300 mb-0">
                {t('notLoggedIn.title')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-1">
              {errorMessage || t('notLoggedIn.description')}
            </AlertDescription>
            <dl className="mt-3 grid gap-1.5 border-t border-amber-500/20 pt-3 text-xs">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{t('fields.instance')}</dt>
                <dd className="font-mono text-foreground">{instanceName || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{t('fields.server')}</dt>
                <dd className="font-mono text-foreground break-all">{instanceBaseUrl || '—'}</dd>
              </div>
            </dl>
          </Alert>
        )}

        {state === 'not_created' && (
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              <XCircle className="size-4 text-muted-foreground" />
              <AlertTitle className="text-foreground mb-0">{t('notCreated.title')}</AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {errorMessage || t('notCreated.description')}
            </AlertDescription>
          </Alert>
        )}

        {state === 'connected' ? (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {disconnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('detaching')}
                </>
              ) : (
                <>
                  <Unplug className="size-4" />
                  {t('detach')}
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            {state === 'not_logged_in' && (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={refresh}
                  className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <RotateCcw className="size-4" />
                  {t('refreshStatus')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                >
                  {disconnecting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t('detaching')}
                    </>
                  ) : (
                    <>
                      <Unplug className="size-4" />
                      {t('detach')}
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="space-y-3 rounded-lg border border-border bg-card/60 p-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('form.tokenLabel')}</Label>
                <Input
                  type="password"
                  placeholder={t('form.tokenPlaceholder')}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t.rich('form.tokenHint', {
                    a: (chunks) => (
                      <a
                        href="https://uazapi.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('form.baseUrlLabel')} <span className="text-muted-foreground">{t('form.optional')}</span>
                </Label>
                <Input
                  placeholder="https://nuvtex.uazapi.com"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t.rich('form.baseUrlHint', {
                    code: (chunks) => <code className="text-foreground">{chunks}</code>,
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('form.instanceNameLabel')} <span className="text-muted-foreground">{t('form.optional')}</span>
                </Label>
                <Input
                  placeholder={t('form.instanceNamePlaceholder')}
                  value={instanceNameInput}
                  onChange={(e) => setInstanceNameInput(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <Button
                onClick={handleAttach}
                disabled={attaching}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {attaching ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('verifying')}
                  </>
                ) : (
                  <>
                    <KeyRound className="size-4" />
                    {t('attachInstance')}
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
