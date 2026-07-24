'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Megaphone, RefreshCw, Trash2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';

interface AdAccount {
  id: string;
  platform: 'meta' | 'google' | 'other';
  external_id: string;
  name: string;
  currency: string;
  status: 'connected' | 'disconnected' | 'error';
  last_error: string | null;
  last_synced_at: string | null;
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
                      {a.last_synced_at &&
                        ` · ${t('lastSynced', { time: new Date(a.last_synced_at).toLocaleString() })}`}
                    </p>
                    {a.status === 'error' && a.last_error && (
                      <p className="mt-0.5 truncate text-xs text-destructive">{a.last_error}</p>
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
    </section>
  );
}
