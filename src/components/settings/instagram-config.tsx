'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { InstagramConfig as InstagramConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type Provider = 'meta' | 'zernio';
type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason =
  'token_corrupted' | 'meta_api_error' | 'zernio_api_error' | null;

/**
 * Instagram's counterpart to `WhatsAppConfig` (whatsapp-config.tsx).
 * Structurally identical (same load/save/test/reset lifecycle, same
 * account-scoped fetch pattern) minus WhatsApp-only concepts that have
 * no Instagram equivalent: the 2FA PIN + /register step, and the
 * separate "Registration status" banner — an Instagram access token
 * being valid IS the connection being live, there's no second
 * subscription step to track.
 *
 * Supports two providers, picked by the segmented control at the top:
 *   - 'meta': the original direct-to-Meta path, requiring Meta
 *     Business Verification.
 *   - 'zernio': routes through zernio.com instead, for accounts that
 *     can't complete that verification (e.g. informal businesses).
 * Only one provider's credentials are stored at a time — saving one
 * clears the other's fields server-side (see the config route).
 */
export function InstagramConfig() {
  const t = useTranslations('Settings.instagram');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<InstagramConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const loadedAccountIdRef = useRef<string | null>(null);

  const [provider, setProvider] = useState<Provider>('meta');

  const [igAccountId, setIgAccountId] = useState('');
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const [zernioAccountId, setZernioAccountId] = useState('');
  const [zernioApiKey, setZernioApiKey] = useState('');
  const [zernioApiKeyEdited, setZernioApiKeyEdited] = useState(false);
  const [showZernioApiKey, setShowZernioApiKey] = useState(false);
  // Only ever populated right after a fresh save that generated a new
  // one — the server never returns an existing secret (see the config
  // route's "shown once" comment), so this resets to null on load.
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/instagram/webhook${provider === 'zernio' ? '/zernio' : ''}`
      : '';

  const fetchConfig = useCallback(
    async (acctId: string) => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('instagram_config')
          .select('*')
          .eq('account_id', acctId)
          .maybeSingle();

        if (error) {
          console.error('Failed to load Instagram config row:', error);
        }

        if (data) {
          setConfig(data);
          setProvider(data.provider === 'zernio' ? 'zernio' : 'meta');
          setIgAccountId(data.ig_account_id || '');
          setPageId(data.page_id || '');
          setAccessToken(MASKED_TOKEN);
          setVerifyToken('');
          setTokenEdited(false);
          setZernioAccountId(data.zernio_account_id || '');
          setZernioApiKey(data.zernio_api_key ? MASKED_TOKEN : '');
          setZernioApiKeyEdited(false);
        } else {
          setConfig(null);
          setIgAccountId('');
          setPageId('');
          setAccessToken('');
          setVerifyToken('');
          setTokenEdited(false);
          setZernioAccountId('');
          setZernioApiKey('');
          setZernioApiKeyEdited(false);
        }

        if (data) {
          try {
            const res = await fetch('/api/instagram/config', { method: 'GET' });
            const payload = await readResponseJson(res);

            if (payload.connected) {
              setConnectionStatus('connected');
              setResetReason(null);
              setStatusMessage('');
            } else {
              setConnectionStatus('disconnected');
              setResetReason(
                payload.needs_reset
                  ? 'token_corrupted'
                  : payload.reason === 'meta_api_error'
                    ? 'meta_api_error'
                    : payload.reason === 'zernio_api_error'
                      ? 'zernio_api_error'
                      : null
              );
              setStatusMessage(payload.message || '');
            }
          } catch (err) {
            console.error('Health check failed:', err);
            setConnectionStatus('disconnected');
          }
        } else {
          setConnectionStatus('disconnected');
          setResetReason(null);
          setStatusMessage('');
        }
      } catch (err) {
        console.error('fetchConfig error:', err);
        toast.error('Failed to load Instagram configuration');
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user, accountId, fetchConfig]);

  async function handleSave() {
    if (provider === 'zernio') {
      await handleSaveZernio();
    } else {
      await handleSaveMeta();
    }
  }

  async function handleSaveMeta() {
    if (!igAccountId.trim()) {
      toast.error('Instagram Business Account ID is required');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error('Access Token is required for initial setup');
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        provider: 'meta',
        ig_account_id: igAccountId.trim(),
        page_id: pageId.trim() || null,
        verify_token: verifyToken.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        toast.error('Please re-enter the Access Token to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/instagram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await readResponseJson(res);

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        setSaving(false);
        return;
      }

      toast.success(
        data.account_info?.username
          ? `Connected — @${data.account_info.username} can now send and receive DMs.`
          : 'Instagram connected. Events will start flowing within a minute.'
      );

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveZernio() {
    if (!zernioAccountId.trim()) {
      toast.error('Zernio Instagram Account ID is required');
      return;
    }
    if (!config && (!zernioApiKey.trim() || !zernioApiKeyEdited)) {
      toast.error('Zernio API Key is required for initial setup');
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        provider: 'zernio',
        zernio_account_id: zernioAccountId.trim(),
      };

      if (
        zernioApiKeyEdited &&
        zernioApiKey !== MASKED_TOKEN &&
        zernioApiKey.trim()
      ) {
        payload.zernio_api_key = zernioApiKey.trim();
      } else if (config) {
        toast.error('Please re-enter the Zernio API Key to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/instagram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await readResponseJson(res);

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        setSaving(false);
        return;
      }

      if (data.webhook_secret) {
        setWebhookSecret(data.webhook_secret);
      }

      toast.success(
        data.account_info?.username
          ? `Connected — @${data.account_info.username} can now send and receive DMs via Zernio.`
          : 'Zernio connected. Add the webhook in your Zernio dashboard to start receiving events.'
      );

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/instagram/config', { method: 'GET' });
      const payload = await readResponseJson(res);

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.account_info?.username
            ? `Connected to @${payload.account_info.username}`
            : 'API connection successful'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(
          payload.needs_reset
            ? 'token_corrupted'
            : payload.reason === 'meta_api_error'
              ? 'meta_api_error'
              : payload.reason === 'zernio_api_error'
                ? 'zernio_api_error'
                : null
        );
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed. Check network and try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (
      !confirm(
        'This will delete the current Instagram config so you can re-enter it. Continue?'
      )
    ) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch('/api/instagram/config', { method: 'DELETE' });
      const data = await readResponseJson(res);

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }

      toast.success(
        'Configuration cleared. You can now re-enter your credentials.'
      );
      setConfig(null);
      setIgAccountId('');
      setPageId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setZernioAccountId('');
      setZernioApiKey('');
      setZernioApiKeyEdited(false);
      setWebhookSecret(null);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  function handleCopyWebhookSecret() {
    if (!webhookSecret) return;
    navigator.clipboard.writeText(webhookSecret);
    toast.success('Webhook secret copied to clipboard');
  }

  function handleProviderChange(next: Provider) {
    if (next === provider) return;
    setProvider(next);
    setWebhookSecret(null);
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

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {showResetBanner && (
            <Alert className="border-amber-600/40 bg-amber-950/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
                <div className="flex-1">
                  <AlertTitle className="mb-1 text-amber-200">
                    Stored token can&apos;t be decrypted
                  </AlertTitle>
                  <AlertDescription className="text-sm text-amber-100/80">
                    {statusMessage}
                  </AlertDescription>
                  <Button
                    onClick={handleReset}
                    disabled={resetting}
                    size="sm"
                    className="mt-3 bg-amber-600 text-white hover:bg-amber-700"
                  >
                    {resetting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        {t('resetting')}
                      </>
                    ) : (
                      <>
                        <RotateCcw className="size-4" />
                        {t('resetConfig')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Alert>
          )}

          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="text-primary size-4" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {connectionStatus === 'connected'
                  ? t('credentialsValid')
                  : t('notConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {connectionStatus === 'connected'
                ? provider === 'zernio'
                  ? t('zernioConnectedDesc')
                  : t('connectedDesc')
                : statusMessage || t('notConnectedDesc')}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">
                {t('providerSectionTitle')}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('providerSectionDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleProviderChange('meta')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    provider === 'meta'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="text-foreground font-medium">
                    {t('providerMeta')}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {t('providerMetaDesc')}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleProviderChange('zernio')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    provider === 'zernio'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="text-foreground font-medium">
                    {t('providerZernio')}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {t('providerZernioDesc')}
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">
                {t('apiCredentialsTitle')}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {provider === 'zernio'
                  ? t('zernioApiCredentialsDesc')
                  : t('apiCredentialsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {provider === 'meta' ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('igAccountId')}
                    </Label>
                    <Input
                      placeholder="e.g. 17841400000000000"
                      value={igAccountId}
                      onChange={(e) => setIgAccountId(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('pageId')}{' '}
                      <span className="text-muted-foreground ml-1">
                        {t('pageIdOptional')}
                      </span>
                    </Label>
                    <Input
                      placeholder="e.g. 100234567890456"
                      value={pageId}
                      onChange={(e) => setPageId(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('accessToken')}
                    </Label>
                    <div className="relative">
                      <Input
                        type={showToken ? 'text' : 'password'}
                        placeholder={t('accessTokenPlaceholder')}
                        value={accessToken}
                        onChange={(e) => {
                          setAccessToken(e.target.value);
                          setTokenEdited(true);
                        }}
                        onFocus={() => {
                          if (accessToken === MASKED_TOKEN) {
                            setAccessToken('');
                            setTokenEdited(true);
                          }
                        }}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 transition-colors"
                      >
                        {showToken ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    {config && !tokenEdited && (
                      <p className="text-muted-foreground text-xs">
                        {t('tokenHidden')}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('webhookVerifyToken')}
                    </Label>
                    <Input
                      placeholder={t('webhookVerifyTokenPlaceholder')}
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                    <p className="text-muted-foreground text-xs">
                      {t('webhookVerifyTokenHint')}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('zernioAccountId')}
                    </Label>
                    <Input
                      placeholder={t('zernioAccountIdPlaceholder')}
                      value={zernioAccountId}
                      onChange={(e) => setZernioAccountId(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                    <p className="text-muted-foreground text-xs">
                      {t('zernioAccountIdHint')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-muted-foreground">
                      {t('zernioApiKey')}
                    </Label>
                    <div className="relative">
                      <Input
                        type={showZernioApiKey ? 'text' : 'password'}
                        placeholder={t('zernioApiKeyPlaceholder')}
                        value={zernioApiKey}
                        onChange={(e) => {
                          setZernioApiKey(e.target.value);
                          setZernioApiKeyEdited(true);
                        }}
                        onFocus={() => {
                          if (zernioApiKey === MASKED_TOKEN) {
                            setZernioApiKey('');
                            setZernioApiKeyEdited(true);
                          }
                        }}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowZernioApiKey(!showZernioApiKey)}
                        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 transition-colors"
                      >
                        {showZernioApiKey ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    {config && !zernioApiKeyEdited && (
                      <p className="text-muted-foreground text-xs">
                        {t('tokenHidden')}
                      </p>
                    )}
                    <p className="text-muted-foreground text-xs">
                      {t('zernioApiKeyHint')}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">
                {t('webhookTitle')}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {provider === 'zernio'
                  ? t('zernioWebhookDesc')
                  : t('webhookDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('webhookUrl')}
                </Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="bg-muted border-border text-muted-foreground font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyWebhookUrl}
                    className="border-border text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              {provider === 'zernio' && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">
                    {t('webhookSecretLabel')}
                  </Label>
                  {webhookSecret ? (
                    <>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={webhookSecret}
                          className="bg-muted border-border text-muted-foreground font-mono text-sm"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleCopyWebhookSecret}
                          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
                        >
                          <Copy className="size-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-amber-400">
                        {t('webhookSecretGenerated')}
                      </p>
                    </>
                  ) : (
                    config && (
                      <p className="text-muted-foreground text-xs">
                        {t('webhookSecretAlreadySet')}
                      </p>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('saveConfig')
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !config}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {testing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('testing')}
                </>
              ) : (
                <>
                  <Zap className="size-4" />
                  {t('testConnection')}
                </>
              )}
            </Button>
            {config && (
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={resetting}
                className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
              >
                {resetting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('resetting')}
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-4" />
                    {t('resetConfig')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">
                {t('setupInstructions')}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('setupInstructionsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {provider === 'meta' ? (
                <Accordion>
                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                          1
                        </span>
                        {t('step1')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li>{t('step1_1')}</li>
                        <li>{t('step1_2')}</li>
                        <li>{t('step1_3')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                          2
                        </span>
                        {t('step2')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li
                          dangerouslySetInnerHTML={{ __html: t.raw('step2_1') }}
                        />
                        <li
                          dangerouslySetInnerHTML={{ __html: t.raw('step2_2') }}
                        />
                      </ol>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                          3
                        </span>
                        {t('step3')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li
                          dangerouslySetInnerHTML={{ __html: t.raw('step3_1') }}
                        />
                        <li
                          dangerouslySetInnerHTML={{ __html: t.raw('step3_2') }}
                        />
                        <li>{t('step3_3')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ) : (
                <Accordion>
                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                          1
                        </span>
                        {t('zernioStep1')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li>{t('zernioStep1_1')}</li>
                        <li>{t('zernioStep1_2')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                          2
                        </span>
                        {t('zernioStep2')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li
                          dangerouslySetInnerHTML={{
                            __html: t.raw('zernioStep2_1'),
                          }}
                        />
                        <li
                          dangerouslySetInnerHTML={{
                            __html: t.raw('zernioStep2_2'),
                          }}
                        />
                      </ol>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem className="border-border">
                    <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                          3
                        </span>
                        {t('zernioStep3')}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        <li
                          dangerouslySetInnerHTML={{
                            __html: t.raw('zernioStep3_1'),
                          }}
                        />
                        <li
                          dangerouslySetInnerHTML={{
                            __html: t.raw('zernioStep3_2'),
                          }}
                        />
                        <li>{t('zernioStep3_3')}</li>
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}

              <div className="border-border mt-4 border-t pt-4">
                <a
                  href={
                    provider === 'zernio'
                      ? 'https://docs.zernio.com'
                      : 'https://developers.facebook.com/docs/messenger-platform/instagram'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {provider === 'zernio' ? t('zernioDocs') : t('metaDocs')}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
