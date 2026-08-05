'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Zap, ExternalLink } from 'lucide-react';
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
 * Email config (Resend). owner-only (RLS).
 * Guarda la API key encriptada vía POST /api/email/config. El dominio
 * debe verificarse en Resend (SPF/DKIM/DMARC) ANTES de apagar GHL
 * (paso OBLIGATORIO de setup, ver DAD §11).
 */
export function EmailConfig() {
  const t = useTranslations('Settings.email');
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(
    async (acctId: string) => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('email_config')
          .select('*')
          .eq('account_id', acctId)
          .maybeSingle();
        if (error) console.error('Failed to load email config:', error);
        if (data) {
          setConfig(data);
          setFromEmail((data.from_email as string) || '');
          setReplyTo((data.reply_to as string) || '');
          setApiKey(MASKED_KEY);
          setKeyEdited(false);
        } else {
          setConfig(null);
          setFromEmail('');
          setReplyTo('');
          setApiKey('');
          setKeyEdited(false);
        }
      } catch (err) {
        console.error('fetchConfig error:', err);
        toast.error('Failed to load Email configuration');
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
    if (!fromEmail.trim()) {
      toast.error(t('fromEmailRequired'));
      return;
    }
    const payload: Record<string, unknown> = { from_email: fromEmail.trim() };
    if (apiKey !== MASKED_KEY && apiKey.trim()) payload.api_key = apiKey.trim();
    if (replyTo.trim()) payload.reply_to = replyTo.trim();

    try {
      setSaving(true);
      const res = await fetch('/api/email/config', {
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
                    placeholder="re_…"
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
                <Label className="text-muted-foreground">{t('fromEmail')}</Label>
                <Input
                  placeholder="Mi Pyme <hola@midominio.com>"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('replyTo')}
                  <span className="ml-1 text-muted-foreground">{t('optional')}</span>
                </Label>
                <Input
                  placeholder="no-reply@midominio.com"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
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
              </ol>
              <a
                href="https://resend.com/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                {t('resendDocs')}
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
