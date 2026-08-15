'use client';

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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { FacebookConfig as FacebookConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'zernio_api_error' | null;

/**
 * Facebook's counterpart to `InstagramConfig`, minus the provider
 * toggle — Facebook has no direct-Meta path in wacrm (see migration
 * 041's comment for why), so this is always the Zernio form.
 */
export function FacebookConfig() {
  const t = useTranslations('Settings.facebook');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [config, setConfig] = useState<FacebookConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const loadedAccountIdRef = useRef<string | null>(null);

  const [zernioAccountId, setZernioAccountId] = useState('');
  const [zernioApiKey, setZernioApiKey] = useState('');
  const [zernioApiKeyEdited, setZernioApiKeyEdited] = useState(false);
  const [showZernioApiKey, setShowZernioApiKey] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/facebook/webhook/zernio` : '';

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('facebook_config')
        .select('*')
        .eq('account_id', acctId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load Facebook config row:', error);
      }

      if (data) {
        setConfig(data);
        setZernioAccountId(data.zernio_account_id || '');
        setZernioApiKey(data.zernio_api_key ? MASKED_TOKEN : '');
        setZernioApiKeyEdited(false);
      } else {
        setConfig(null);
        setZernioAccountId('');
        setZernioApiKey('');
        setZernioApiKeyEdited(false);
      }

      if (data) {
        try {
          const res = await fetch('/api/facebook/config', { method: 'GET' });
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(
              payload.needs_reset
                ? 'token_corrupted'
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
      toast.error('Failed to load Facebook configuration');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

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
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!zernioAccountId.trim()) {
      toast.error('Zernio Facebook Page ID is required');
      return;
    }
    if (!config && (!zernioApiKey.trim() || !zernioApiKeyEdited)) {
      toast.error('Zernio API Key is required for initial setup');
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        zernio_account_id: zernioAccountId.trim(),
      };

      if (zernioApiKeyEdited && zernioApiKey !== MASKED_TOKEN && zernioApiKey.trim()) {
        payload.zernio_api_key = zernioApiKey.trim();
      } else if (config) {
        toast.error('Please re-enter the Zernio API Key to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/facebook/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

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
          ? `Connected — ${data.account_info.username} can now send and receive DMs via Zernio.`
          : 'Zernio connected. Add the webhook in your Zernio dashboard to start receiving events.',
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
      const res = await fetch('/api/facebook/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.account_info?.username
            ? `Connected to ${payload.account_info.username}`
            : 'API connection successful'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(
          payload.needs_reset
            ? 'token_corrupted'
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
    if (!confirm('This will delete the current Facebook config so you can re-enter it. Continue?')) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch('/api/facebook/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }

      toast.success('Configuration cleared. You can now re-enter your credentials.');
      setConfig(null);
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

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
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
            <Alert className="bg-amber-950/40 border-amber-600/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <AlertTitle className="text-amber-200 mb-1">
                    Stored key can&apos;t be decrypted
                  </AlertTitle>
                  <AlertDescription className="text-amber-100/80 text-sm">
                    {statusMessage}
                  </AlertDescription>
                  <Button
                    onClick={handleReset}
                    disabled={resetting}
                    size="sm"
                    className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
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
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {connectionStatus === 'connected' ? t('credentialsValid') : t('notConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {connectionStatus === 'connected'
                ? t('connectedDesc')
                : statusMessage || t('notConnectedDesc')}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('apiCredentialsTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">{t('apiCredentialsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('zernioAccountId')}</Label>
                <Input
                  placeholder={t('zernioAccountIdPlaceholder')}
                  value={zernioAccountId}
                  onChange={(e) => setZernioAccountId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">{t('zernioAccountIdHint')}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('zernioApiKey')}</Label>
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showZernioApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {config && !zernioApiKeyEdited && (
                  <p className="text-xs text-muted-foreground">{t('tokenHidden')}</p>
                )}
                <p className="text-xs text-muted-foreground">{t('zernioApiKeyHint')}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('webhookTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">{t('webhookDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('webhookUrl')}</Label>
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
                    className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('webhookSecretLabel')}</Label>
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
                        className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-amber-400">{t('webhookSecretGenerated')}</p>
                  </>
                ) : (
                  config && <p className="text-xs text-muted-foreground">{t('webhookSecretAlreadySet')}</p>
                )}
              </div>
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
                className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
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
              <CardTitle className="text-foreground text-base">{t('setupInstructions')}</CardTitle>
              <CardDescription className="text-muted-foreground">{t('setupInstructionsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      {t('step1')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step1_1')}</li>
                      <li>{t('step1_2')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      {t('step2')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step2_1') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step2_2') }} />
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      {t('step3')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_1') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_2') }} />
                      <li>{t('step3_3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href="https://docs.zernio.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {t('zernioDocs')}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
