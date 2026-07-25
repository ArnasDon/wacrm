'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Megaphone,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';

interface AdAccount {
  id: string;
  platform: 'meta' | 'google' | 'other';
  external_id: string;
  name: string;
  currency: string;
  timezone: string | null;
  status: 'connected' | 'disconnected' | 'error';
  last_error: string | null;
  last_synced_at: string | null;
}

/** The operator's own zone, to compare against the ad account's. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

/**
 * One numbered step of a setup guide — same accordion shape
 * WhatsAppConfig already uses for its own onboarding, so both
 * integrations read the same way.
 */
function SetupStep({
  number,
  title,
  lines,
}: {
  number: number;
  title: string;
  lines: string[];
}) {
  return (
    <AccordionItem className="border-border">
      <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
        <span className="flex items-center gap-2 text-left">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {number}
          </span>
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="text-muted-foreground">
        <ol className="list-inside list-decimal space-y-1 text-sm">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * Connect a Meta Ads account so the /campaigns page can show spend
 * and cost per lead. Same shape as WhatsAppConfig: a form that POSTs
 * to a dedicated API route (which verifies the token against Meta
 * before storing anything, then encrypts it — the token never touches
 * a client-writable table directly).
 */
export function AdsSettings() {
  const { canEditSettings } = useAuth();
  const t = useTranslations('Settings.ads');

  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [externalId, setExternalId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [activatingGoogle, setActivatingGoogle] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/ads/accounts');
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.adAccounts ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleConnect() {
    if (!externalId.trim() || !accessToken.trim()) return;
    setConnecting(true);
    const res = await fetch('/api/ads/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'meta',
        externalId: externalId.trim(),
        accessToken: accessToken.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || t('connectFailed'));
      setConnecting(false);
      return;
    }
    toast.success(t('connected', { name: data.adAccount.name }));
    setExternalId('');
    setAccessToken('');
    setConnecting(false);
    fetchAccounts();
  }

  /**
   * "Activate Google Ads" — no credential involved. It only creates the
   * placeholder row so Google shows up here as a tracked platform; the
   * actual work (campaign, tracked link, spend) happens on /campaigns,
   * which is what the guide below walks through.
   */
  async function handleActivateGoogle() {
    setActivatingGoogle(true);
    const res = await fetch('/api/ads/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'google' }),
    });
    const data = await res.json().catch(() => ({}));
    setActivatingGoogle(false);
    if (!res.ok) {
      toast.error(data.error || t('googleActivateFailed'));
      return;
    }
    toast.success(t('googleActivated'));
    fetchAccounts();
  }

  async function handleSyncNow() {
    setSyncingId('all');
    const res = await fetch('/api/ads/sync', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setSyncingId(null);
    if (!res.ok) {
      toast.error(data.error || t('syncFailed'));
      return;
    }
    const failed = (data.results ?? []).filter((r: { error: string | null }) => r.error);
    if (failed.length > 0) {
      toast.error(t('syncPartial', { count: failed.length }));
    } else {
      toast.success(t('syncSuccess'));
    }
    fetchAccounts();
  }

  async function handleDisconnect(id: string) {
    setRemovingId(id);
    const res = await fetch(`/api/ads/accounts/${id}`, { method: 'DELETE' });
    setRemovingId(null);
    if (!res.ok) {
      toast.error(t('disconnectFailed'));
      return;
    }
    toast.success(t('disconnected'));
    fetchAccounts();
  }

  const hasGoogle = accounts.some((a) => a.platform === 'google');
  const localZone = browserTimezone();

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Megaphone className="size-4 text-primary" />
            {t('connectedAccounts')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('connectedAccountsDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('loading')}
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noAccounts')}</p>
          ) : (
            <div className="space-y-3">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {a.name}
                      </span>
                      <Badge
                        variant={a.status === 'connected' ? 'default' : 'destructive'}
                        className="shrink-0 text-[10px]"
                      >
                        {t(`status.${a.status}`)}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.external_id} · {a.currency}
                      {a.timezone && ` · ${a.timezone}`}
                      {a.last_synced_at &&
                        ` · ${t('lastSynced', { time: new Date(a.last_synced_at).toLocaleString() })}`}
                    </p>
                    {a.status === 'error' && a.last_error && (
                      <p className="mt-0.5 truncate text-xs text-destructive">{a.last_error}</p>
                    )}
                    {/* Meta reports each day's spend in the ad account's
                        timezone, but this page's date range is computed in
                        the browser's. When they differ, a day's spend can
                        look shifted — say so rather than leaving the
                        operator to wonder why the numbers seem off by one. */}
                    {a.timezone && localZone && a.timezone !== localZone && (
                      <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-500">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        {t('timezoneMismatch', { adTimezone: a.timezone, localTimezone: localZone })}
                      </p>
                    )}
                  </div>
                  {canEditSettings && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={removingId === a.id}
                      onClick={() => handleDisconnect(a.id)}
                      aria-label={t('disconnect')}
                    >
                      {removingId === a.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEditSettings && accounts.length > 0 && (
            <Button
              variant="outline"
              onClick={handleSyncNow}
              disabled={syncingId === 'all'}
              className="border-border text-foreground"
            >
              {syncingId === 'all' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t('syncNow')}
            </Button>
          )}
        </CardContent>
      </Card>

      {canEditSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('connectMeta')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('connectMetaDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('adAccountIdLabel')}</Label>
              <Input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="act_1234567890"
                className="bg-muted border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('adAccountIdHint')}</p>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t('accessTokenLabel')}</Label>
              <Input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="EAAG..."
                className="bg-muted border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('accessTokenHint')}</p>
            </div>
            <Button
              onClick={handleConnect}
              disabled={connecting || !externalId.trim() || !accessToken.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('connect')}
            </Button>
          </CardContent>
        </Card>
      )}

      {canEditSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('connectGoogle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('connectGoogleDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasGoogle ? (
              <p className="text-sm text-muted-foreground">{t('googleAlreadyActive')}</p>
            ) : (
              <Button
                variant="outline"
                onClick={handleActivateGoogle}
                disabled={activatingGoogle}
                className="border-border text-foreground"
              >
                {activatingGoogle ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('activateGoogle')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Setup guides. Same numbered-accordion shape as WhatsApp's own
          onboarding, so an operator who set that up already knows how to
          read this. Kept in the app rather than only in the repo docs:
          this is the screen you are on when you need it. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">{t('setupTitle')}</CardTitle>
          <CardDescription className="text-muted-foreground">{t('setupDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t('metaGuideTitle')}</p>
            <Accordion>
              <SetupStep
                number={1}
                title={t('metaStep1')}
                lines={[t('metaStep1_1'), t('metaStep1_2'), t('metaStep1_3')]}
              />
              <SetupStep
                number={2}
                title={t('metaStep2')}
                lines={[t('metaStep2_1'), t('metaStep2_2'), t('metaStep2_3')]}
              />
              <SetupStep
                number={3}
                title={t('metaStep3')}
                lines={[t('metaStep3_1'), t('metaStep3_2')]}
              />
              <SetupStep
                number={4}
                title={t('metaStep4')}
                lines={[t('metaStep4_1'), t('metaStep4_2'), t('metaStep4_3')]}
              />
            </Accordion>
            <div className="mt-3">
              <a
                href="https://developers.facebook.com/docs/marketing-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary/80"
              >
                <ExternalLink className="size-3.5" />
                {t('metaDocs')}
              </a>
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <p className="mb-1 text-sm font-medium text-foreground">{t('googleGuideTitle')}</p>
            <p className="mb-2 text-xs text-muted-foreground">{t('googleGuideWhyManual')}</p>
            <Accordion>
              <SetupStep number={1} title={t('googleStep1')} lines={[t('googleStep1_1')]} />
              <SetupStep
                number={2}
                title={t('googleStep2')}
                lines={[t('googleStep2_1'), t('googleStep2_2')]}
              />
              <SetupStep
                number={3}
                title={t('googleStep3')}
                lines={[t('googleStep3_1'), t('googleStep3_2'), t('googleStep3_3')]}
              />
              <SetupStep
                number={4}
                title={t('googleStep4')}
                lines={[t('googleStep4_1'), t('googleStep4_2')]}
              />
              <SetupStep
                number={5}
                title={t('googleStep5')}
                lines={[t('googleStep5_1'), t('googleStep5_2')]}
              />
            </Accordion>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
