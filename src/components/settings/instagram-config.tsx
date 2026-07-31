'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  RotateCcw,
  AlertTriangle,
  MessageCircle,
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

const MASKED_TOKEN = '••••••••••••••••';

interface InstagramConfigData {
  id: string;
  ig_user_id: string;
  ig_username: string | null;
  status: string;
  connected_at: string | null;
  subscribed_at: string | null;
  last_webhook_at: string | null;
}

export function InstagramConfig() {
  const t = useTranslations('Settings.instagram');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<InstagramConfigData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const loadedAccountIdRef = useRef<string | null>(null);

  const [igUserId, setIgUserId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/instagram/config', { method: 'GET' });
      const data = await res.json();

      if (data.connected && data.config) {
        setConfig(data.config);
        setIsConnected(true);
        setIgUserId(data.config.ig_user_id || '');
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
      } else {
        setConfig(null);
        setIsConnected(false);
        setIgUserId('');
        setAccessToken('');
        setVerifyToken('');
        setTokenEdited(false);
        setStatusMessage(data.message || '');
      }
    } catch (err) {
      console.error('[instagram-config] fetchConfig error:', err);
      setIsConnected(false);
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
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!igUserId.trim()) {
      toast.error(t('igUserIdRequired'));
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error(t('accessTokenRequired'));
      return;
    }
    if (tokenEdited && accessToken === MASKED_TOKEN) {
      toast.error(t('accessTokenReEnter'));
      return;
    }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        ig_user_id: igUserId.trim(),
        verify_token: verifyToken.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else {
        toast.error(t('saveAccessToken'));
        setSaving(false);
        return;
      }

      const res = await fetch('/api/instagram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('saveError'));
        setSaving(false);
        return;
      }

      toast.success(
        data.ig_username
          ? t('saveSuccess', { ig_username: data.ig_username })
          : t('saveSuccessGeneric')
      );

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('[instagram-config] Save error:', err);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/instagram/config', { method: 'GET' });
      const data = await res.json();

      if (data.connected) {
        setIsConnected(true);
        toast.success(
          data.config?.ig_username
            ? t('testSuccess', { ig_username: data.config.ig_username })
            : t('testSuccessGeneric')
        );
      } else {
        setIsConnected(false);
        setStatusMessage(data.message || '');
        toast.error(data.message || t('testError'));
      }
    } catch (err) {
      console.error('[instagram-config] Test error:', err);
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('resetConfirm'))) return;

    try {
      setResetting(true);
      const res = await fetch('/api/instagram/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('resetError'));
        return;
      }

      toast.success(t('resetSuccess'));
      setConfig(null);
      setIgUserId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setIsConnected(false);
      setStatusMessage('');
    } catch (err) {
      console.error('[instagram-config] Reset error:', err);
      toast.error(t('resetError'));
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title={t('title')}
          description={t('description')}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Main config form */}
        <div className="space-y-6">
          {/* Connection Status */}
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {isConnected ? t('statusConnected') : t('statusNotConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {isConnected
                ? config?.ig_username
                  ? t('statusConnectedDesc', { username: config.ig_username })
                  : t('statusGenericConnected')
                : statusMessage || t('statusNotConnectedDesc')}
            </AlertDescription>
          </Alert>

          {/* Webhook URL display */}
          {isConnected && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground text-base">{t('webhookUrl')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('webhookUrlDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('callbackUrl')}</Label>
                  <Input
                    readOnly
                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/instagram/webhook`}
                    className="bg-muted border-border text-muted-foreground font-mono text-sm"
                    onClick={(e) => {
                      (e.target as HTMLInputElement).select();
                      navigator.clipboard.writeText((e.target as HTMLInputElement).value);
                      toast.success(t('webhookCopied'));
                    }}
                  />
                  <p className="text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: t.raw('webhookHint') }} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* API Credentials */}
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('apiCredentials')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('apiCredentialsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('igUserId')}</Label>
                <Input
                  placeholder={t('igUserIdPlaceholder')}
                  value={igUserId}
                  onChange={(e) => setIgUserId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: t.raw('igUserIdHint') }} />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('accessToken')}
                  <span className="ml-1 text-muted-foreground">{t('accessTokenHint')}</span>
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
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {config && !tokenEdited && (
                  <p className="text-xs text-muted-foreground">
                    {t('accessTokenHidden')}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('verifyToken')}</Label>
                <Input
                  placeholder={t('verifyTokenPlaceholder')}
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t('verifyTokenHint')}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
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
              ) : config ? (
                t('updateConfig')
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
                  <MessageCircle className="size-4" />
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

        {/* Setup Instructions Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">{t('setupInstructions')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('setupInstructionsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{t('step1')}</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step1_1') }} />
                  <li>{t('step1_2')}</li>
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step1_3') }} />
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{t('step2')}</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step2_1') }} />
                  <li>{t('step2_2')}</li>
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step2_3') }} />
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{t('step3')}</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step3_1') }} />
                  <li>{t('step3_2')}</li>
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step3_3') }} />
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step3_4') }} />
                  <li>{t('step3_5')}</li>
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step3_6') }} />
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium text-foreground">{t('step4')}</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step4_1') }} />
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step4_2') }} />
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step4_3') }} />
                  <li dangerouslySetInnerHTML={{ __html: t.raw('step4_4') }} />
                </ul>
              </div>

<div className="pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">
                  <strong>{t('howItWorks')}</strong> <span dangerouslySetInnerHTML={{ __html: t.raw('howItWorksDesc') }} />
                </p>
                <a
                  href="https://developers.facebook.com/docs/instagram-api/guides/messaging"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {t('metaDocs')}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
