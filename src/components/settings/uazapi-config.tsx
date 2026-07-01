'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
      toast.error('Instance token is required.');
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
        setErrorMessage(data.error || 'Failed to attach instance');
        toast.error(data.error || 'Failed to attach instance');
        return;
      }

      if (!data.webhook_configured) {
        toast.warning(
          'Instance attached, but the webhook could not be configured automatically — set NEXT_PUBLIC_SITE_URL and try again to receive inbound messages.',
          { duration: 10000 },
        );
      } else {
        toast.success(
          data.connected
            ? 'Instance attached and connected.'
            : 'Instance attached. It is not logged into WhatsApp yet — log in via the Uazapi panel.',
        );
      }

      setTokenInput('');
      await refresh();
    } catch (err) {
      console.error('[uazapi-config] attach failed:', err);
      setErrorMessage('Failed to reach the server.');
      toast.error('Failed to reach the server.');
    } finally {
      setAttaching(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Detach this Uazapi instance from wacrm? Your WhatsApp session in Uazapi stays untouched — you can re-attach the same token any time.')) {
      return;
    }
    setDisconnecting(true);
    try {
      const res = await fetch('/api/uazapi/instance', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to detach');
        return;
      }
      toast.success('Uazapi instance detached.');
      setState('not_created');
      setInstanceName('');
      setInstanceBaseUrl('');
      setConnectedAt(null);
    } catch (err) {
      console.error('[uazapi-config] detach failed:', err);
      toast.error('Failed to detach.');
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
          Uazapi connection
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Connect a second WhatsApp number via Uazapi (unofficial API). Create the
          instance and log it into WhatsApp directly in your Uazapi panel first — wacrm
          only attaches to its token to send messages and receive inbound events via
          webhook. Runs alongside your Meta connection above; each conversation sticks
          to whichever provider it started on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === 'connected' && (
          <Alert className="border-emerald-500/35 bg-emerald-500/10">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle className="text-emerald-700 dark:text-emerald-300 mb-0">
                Connected{instanceName ? ` — ${instanceName}` : ''}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-1">
              WhatsApp session is active. Uazapi is the default provider for new
              conversations on this account.
            </AlertDescription>
            <dl className="mt-3 grid gap-1.5 border-t border-emerald-500/20 pt-3 text-xs">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Instance</dt>
                <dd className="font-mono text-foreground">{instanceName || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Server</dt>
                <dd className="font-mono text-foreground break-all">{instanceBaseUrl || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Connected since</dt>
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
                Token attached, but not logged into WhatsApp
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-1">
              {errorMessage ||
                'wacrm saved this token, but Uazapi reports the WhatsApp session isn’t connected. Log the instance into WhatsApp in the Uazapi panel, then click "Refresh status".'}
            </AlertDescription>
            <dl className="mt-3 grid gap-1.5 border-t border-amber-500/20 pt-3 text-xs">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Instance</dt>
                <dd className="font-mono text-foreground">{instanceName || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Server</dt>
                <dd className="font-mono text-foreground break-all">{instanceBaseUrl || '—'}</dd>
              </div>
            </dl>
          </Alert>
        )}

        {state === 'not_created' && (
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              <XCircle className="size-4 text-muted-foreground" />
              <AlertTitle className="text-foreground mb-0">Not connected</AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {errorMessage || 'Paste your Uazapi instance token below to attach it.'}
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
                  Detaching…
                </>
              ) : (
                <>
                  <Unplug className="size-4" />
                  Detach
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
                  Refresh status
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
                      Detaching…
                    </>
                  ) : (
                    <>
                      <Unplug className="size-4" />
                      Detach
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="space-y-3 rounded-lg border border-border bg-card/60 p-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Instance token</Label>
                <Input
                  type="password"
                  placeholder="Paste your Uazapi instance token"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Create the instance and log it into WhatsApp in your{' '}
                  <a
                    href="https://uazapi.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80"
                  >
                    Uazapi panel
                  </a>{' '}
                  first, then copy its token here.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  Base URL <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  placeholder="https://nuvtex.uazapi.com"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use the server default (
                  <code className="text-foreground">https://nuvtex.uazapi.com</code>).
                  Override it if your instance lives on a different Uazapi server or
                  self-hosted URL.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  Instance name <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  placeholder="For your own reference"
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
                    Verifying…
                  </>
                ) : (
                  <>
                    <KeyRound className="size-4" />
                    Attach instance
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
