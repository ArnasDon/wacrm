'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Zap, Copy, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_KEY = '••••••••••••••••••••';

/**
 * Telnyx config (voz + SMS). owner-only (RLS).
 * Guarda la API key encriptada vía POST /api/telnyx/config, que valida
 * la key contra GET /v2/phone_numbers antes de persistir (Fase 1).
 * La Call Control App / Messaging Profile se crean en el dashboard de
 * Telnyx y se registran aquí por id; la compra de números también va
 * por el dashboard (source of truth).
 */
export function TelnyxConfig() {
  const t = useTranslations('Settings.telnyx');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [defaultFromNumber, setDefaultFromNumber] = useState('');
  const [callControlAppId, setCallControlAppId] = useState('');
  const [messagingProfileId, setMessagingProfileId] = useState('');
  // Entrante (migración 057) — sin estos dos el webhook no puede construir
  // la pata B hacia el softphone y las llamadas no llegan al navegador.
  const [credentialConnectionId, setCredentialConnectionId] = useState('');
  const [agentSipUri, setAgentSipUri] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/telnyx/webhook` : '';

  const fetchConfig = useCallback(
    async (acctId: string) => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('telnyx_config')
          .select('*')
          .eq('account_id', acctId)
          .maybeSingle();
        if (error) console.error('Failed to load telnyx config:', error);
        if (data) {
          setConfig(data);
          setDefaultFromNumber((data.default_from_number as string) || '');
          setCallControlAppId((data.call_control_app_id as string) || '');
          setMessagingProfileId((data.messaging_profile_id as string) || '');
          setCredentialConnectionId((data.credential_connection_id as string) || '');
          setAgentSipUri((data.agent_sip_uri as string) || '');
          setApiKey(MASKED_KEY);
          setKeyEdited(false);
        } else {
          setConfig(null);
          setDefaultFromNumber('');
          setCallControlAppId('');
          setMessagingProfileId('');
          setCredentialConnectionId('');
          setAgentSipUri('');
          setApiKey('');
          setKeyEdited(false);
        }
      } catch (err) {
        console.error('fetchConfig error:', err);
        toast.error('Failed to load Telnyx configuration');
      } finally {
        setLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      // Guard raro (dashboard exige auth); mismo patrón que whatsapp-config.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!config && (!apiKey.trim() || !keyEdited)) {
      toast.error(t('apiKeyRequired'));
      return;
    }
    const payload: Record<string, unknown> = {};
    if (apiKey !== MASKED_KEY && apiKey.trim()) payload.api_key = apiKey.trim();
    if (defaultFromNumber.trim()) payload.default_from_number = defaultFromNumber.trim();
    if (callControlAppId.trim()) payload.call_control_app_id = callControlAppId.trim();
    if (messagingProfileId.trim()) payload.messaging_profile_id = messagingProfileId.trim();
    if (credentialConnectionId.trim())
      payload.credential_connection_id = credentialConnectionId.trim();
    if (agentSipUri.trim()) payload.agent_sip_uri = agentSipUri.trim();

    try {
      setSaving(true);
      const res = await fetch('/api/telnyx/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('saveError'));
        return;
      }
      toast.success(t('saved'));
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success(t('copied'));
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

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-primary" />
              <AlertTitle className="text-foreground mb-0">
                {config ? t('configured') : t('notConfigured')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {t('statusDesc')}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('credentialsTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('credentialsDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('apiKey')}</Label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="KEY…"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (apiKey === MASKED_KEY) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {config && !keyEdited && (
                  <p className="text-xs text-muted-foreground">{t('keyHidden')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('fromNumber')}</Label>
                <Input
                  placeholder="+15550000001"
                  value={defaultFromNumber}
                  onChange={(e) => setDefaultFromNumber(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('callControlAppId')}</Label>
                <Input
                  placeholder="uuid"
                  value={callControlAppId}
                  onChange={(e) => setCallControlAppId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('messagingProfileId')}</Label>
                <Input
                  placeholder="uuid"
                  value={messagingProfileId}
                  onChange={(e) => setMessagingProfileId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('inboundTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('inboundDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('credentialConnectionId')}
                </Label>
                <Input
                  placeholder="uuid"
                  value={credentialConnectionId}
                  onChange={(e) => setCredentialConnectionId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t('credentialConnectionIdHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('agentSipUri')}</Label>
                <Input
                  placeholder="sip:gencred-xxxx@sip.telnyx.com"
                  value={agentSipUri}
                  onChange={(e) => setAgentSipUri(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono"
                />
                <p className="text-xs text-muted-foreground">{t('agentSipUriHint')}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('webhookTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('webhookDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
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
          </div>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">{t('setupTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('setupDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <ol className="list-decimal list-inside space-y-2">
                <li>{t('setup1')}</li>
                <li>{t('setup2')}</li>
                <li>{t('setup3')}</li>
                <li>{t('setup4')}</li>
              </ol>
              <a
                href="https://developers.telnyx.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                {t('telnyxDocs')}
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
