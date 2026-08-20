'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarDays,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
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
import { readResponseJson } from '@/lib/http/response-json';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

/**
 * Unlike every other Settings connection panel (WhatsApp/Instagram/
 * Facebook — all "paste your token" forms), this one is a real OAuth
 * redirect: "Connect" sends the browser to
 * GET /api/google-calendar/oauth/start, which bounces it to Google's
 * consent screen and back to
 * GET /api/google-calendar/oauth/callback, which redirects here again
 * with `?connected=1` or `?error=...` — read once on mount to show the
 * right toast, then stripped from the URL so a refresh doesn't re-fire it.
 */
export function GoogleCalendarConfig() {
  const t = useTranslations('Settings.googleCalendar');
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('unknown');
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const loadedAccountIdRef = useRef<string | null>(null);
  const consumedRedirectRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/google-calendar/config');
      const payload = await readResponseJson<{
        connected?: boolean;
        calendar_email?: string | null;
        message?: string;
      }>(res);
      if (payload.connected) {
        setStatus('connected');
        setCalendarEmail(payload.calendar_email ?? null);
        setStatusMessage('');
      } else {
        setStatus('disconnected');
        setCalendarEmail(null);
        setStatusMessage(payload.message || '');
      }
    } catch (err) {
      console.error('[google-calendar] status fetch failed:', err);
      setStatus('disconnected');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchStatus();
  }, [authLoading, profileLoading, user, accountId, fetchStatus]);

  // Reflect the OAuth callback's redirect result once, then clean the
  // URL so refreshing this tab doesn't replay the same toast.
  useEffect(() => {
    if (consumedRedirectRef.current) return;
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (!connected && !error) return;
    consumedRedirectRef.current = true;

    if (connected) {
      toast.success(t('toastConnected'));
      fetchStatus();
    } else if (error) {
      toast.error(t('toastConnectFailed', { error }));
    }
    router.replace(`${pathname}?tab=google-calendar`);
  }, [searchParams, router, pathname, t, fetchStatus]);

  async function handleDisconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    try {
      setDisconnecting(true);
      const res = await fetch('/api/google-calendar/config', {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await readResponseJson<{ error?: string }>(res).catch(
          (): { error?: string } => ({})
        );
        toast.error(data.error || t('toastDisconnectFailed'));
        return;
      }
      toast.success(t('toastDisconnected'));
      setStatus('disconnected');
      setCalendarEmail(null);
    } catch (err) {
      console.error('[google-calendar] disconnect failed:', err);
      toast.error(t('toastDisconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {status === 'disconnected' && statusMessage && (
            <Alert className="border-amber-600/40 bg-amber-950/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
                <div className="flex-1">
                  <AlertTitle className="mb-1 text-amber-200">
                    {t('connectionIssue')}
                  </AlertTitle>
                  <AlertDescription className="text-sm text-amber-100/80">
                    {statusMessage}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          )}

          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <CalendarDays className="text-primary size-4" />
                {t('cardTitle')}
              </CardTitle>
              <CardDescription>
                {status === 'connected' ? (
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    {calendarEmail
                      ? t('connectedAs', { email: calendarEmail })
                      : t('connected')}
                  </span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <XCircle className="size-3.5" />
                    {t('notConnected')}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status === 'connected' ? (
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="border-border text-foreground hover:bg-muted"
                >
                  {disconnecting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t('disconnecting')}
                    </>
                  ) : (
                    t('disconnect')
                  )}
                </Button>
              ) : (
                <a href="/api/google-calendar/oauth/start">
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    {t('connect')}
                  </Button>
                </a>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border bg-card h-fit">
          <CardHeader>
            <CardTitle className="text-foreground text-sm">
              {t('aboutTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-3 text-sm">
            <p>{t('aboutBody')}</p>
            <a
              href="https://calendar.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 hover:underline"
            >
              {t('aboutLink')}
              <ExternalLink className="size-3" />
            </a>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
